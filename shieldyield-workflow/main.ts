import {
  CronCapability,
  EVMClient,
  getNetwork,
  encodeCallMsg,
  bytesToHex,
  LAST_FINALIZED_BLOCK_NUMBER,
  handler,
  Runner,
  type Runtime,
  Report,
} from "@chainlink/cre-sdk";
import {
  type Address,
  encodeFunctionData,
  decodeFunctionResult,
  decodeAbiParameters,
  keccak256,
  toBytes,
  toHex,
  zeroAddress,
} from "viem";

import {
  readAllAdapters,
  fetchAllOffchainSignals,
  computeAllRiskScores,
  getThreatLevelLabel,
  detectAllAnomalies,
  getHighestSeverity,
} from "./monitors";
import type { ShieldConfig, AdapterApiConfig, OffchainApisConfig } from "./monitors/types";
import type { Anomaly } from "./monitors/anomaly-detector";

import {
  calculateOptimalAllocations,
  shouldRebalance,
  type PoolAllocation,
  type AdapterRiskInfo,
} from "./rebalancer";

import {
  executeWarningProtocol,
  executeCriticalProtocol,
} from "./shield";

import { RiskRegistry, ShieldVault } from "../contracts/abi";

// ========================================
// TYPE DEFINITIONS
// ========================================

type Addresses = {
  mockUSDC: string;
  faucet: string;
  riskRegistry: string;
  shieldVault: string;
  shieldBridge: string;
  aaveAdapter: string;
  compoundAdapter: string;
  morphoAdapter: string;
  yieldMaxAdapter: string;
};

type EvmConfig = {
  chainName: string;
  addresses: Addresses[];
};

type Config = {
  schedule: string;
  evms: EvmConfig[];
  offchainApis: OffchainApisConfig;
  shieldConfig: ShieldConfig;
};

// ========================================
// HELPER
// ========================================

function createEvmClient(chainName: string): EVMClient {
  const network = getNetwork({
    chainFamily: "evm",
    chainSelectorName: chainName,
    isTestnet: true,
  });

  if (!network) {
    throw new Error(`Network not found: ${chainName}`);
  }

  return new EVMClient(network.chainSelector.selector);
}

/** RiskScoreUpdated(address indexed protocol, uint8 oldScore, uint8 newScore, ThreatLevel threatLevel) */
const RISK_SCORE_UPDATED_SIG = keccak256(
  toBytes("RiskScoreUpdated(address,uint8,uint8,uint8)")
);

// Threat level enum values matching Solidity
const THREAT_LEVEL = {
  SAFE: 0,
  WATCH: 1,
  WARNING: 2,
  CRITICAL: 3,
} as const;

// ========================================
// WORKFLOW 1+2: SENTINEL SCAN + THREAT ASSESSMENT (CRON)
// ========================================

const onCronTrigger = (runtime: Runtime<Config>): string => {
  runtime.log("=".repeat(60));
  runtime.log("🛡️  WORKFLOW 1+2: SENTINEL SCAN + THREAT ASSESSMENT");
  runtime.log("Trigger: Cron (scheduled monitoring)");
  runtime.log("=".repeat(60));

  const allResults: any[] = [];

  for (const evm of runtime.config.evms) {
    runtime.log(`\nMonitoring chain: ${evm.chainName}`);

    const addresses = evm.addresses[0];
    const evmClient = createEvmClient(evm.chainName);

    // ---- STEP 1: Read On-Chain Adapter Data ----
    runtime.log("Reading on-chain adapter data...");
    const adapters = readAllAdapters(runtime, evm.chainName, {
      aaveAdapter: addresses.aaveAdapter,
      compoundAdapter: addresses.compoundAdapter,
      morphoAdapter: addresses.morphoAdapter,
      yieldMaxAdapter: addresses.yieldMaxAdapter,
    });

    // ---- STEP 2: Fetch Off-Chain Signals ----
    runtime.log("Fetching off-chain signals...");
    const apisConfig = runtime.config.offchainApis;
    const primaryAdapter = apisConfig.adapters[apisConfig.primaryProtocol];
    if (!primaryAdapter) {
      runtime.log(`ERROR: Primary protocol '${apisConfig.primaryProtocol}' not found in adapter config`);
      return JSON.stringify({ status: "error", error: "Invalid primaryProtocol config" });
    }
    const goPlusUrl = `https://api.gopluslabs.io/api/v1/token_security/${apisConfig.goPlusChainId}?contract_addresses=${primaryAdapter.goPlusTokenAddress}`;
    const teamWalletUrl = `https://api.arbiscan.io/api?module=account&action=balance&address=${primaryAdapter.teamWallet}&tag=latest&apikey=YourApiKeyToken`;

    runtime.log(`Using primary protocol: ${apisConfig.primaryProtocol}`);
    const offchain = fetchAllOffchainSignals(runtime, {
      defiLlamaSlug: primaryAdapter.defiLlamaSlug,
      githubUrl: primaryAdapter.github,
      goPlusUrl,
      teamWalletUrl,
    });

    // ---- STEP 3: Compute Risk Scores ----
    runtime.log("Computing risk scores...");
    const riskScores = computeAllRiskScores(adapters, [], offchain);

    for (const [name, { score, level }] of Object.entries(riskScores)) {
      runtime.log(`${name}: score=${score}/100, level=${level}`);
    }

    // ---- STEP 4: Anomaly Detection ----
    runtime.log("Running anomaly detection...");
    const anomalies = detectAllAnomalies(adapters, offchain);
    const highestSeverity = getHighestSeverity(anomalies);

    if (anomalies.length > 0) {
      runtime.log(`Anomalies detected: ${anomalies.length}`);
      for (const a of anomalies) {
        runtime.log(`  [${a.severity}] ${a.type}: ${a.message}`);
      }
    } else {
      runtime.log("No anomalies detected");
    }

    // ---- STEP 5: Write Risk Scores On-Chain (if significant change) ----
    const hasWarningOrCritical = Object.values(riskScores).some(
      (r) => r.level === "WARNING" || r.level === "CRITICAL"
    );

    if (hasWarningOrCritical) {
      runtime.log("WARNING/CRITICAL detected — updating on-chain risk scores...");

      // Build batch update arrays
      const protocols: Address[] = [];
      const scores: number[] = [];
      const reasons: string[] = [];

      const adapterNameToAddress: Record<string, string> = {
        AaveAdapter: addresses.aaveAdapter,
        CompoundAdapter: addresses.compoundAdapter,
        MorphoAdapter: addresses.morphoAdapter,
        YieldMaxAdapter: addresses.yieldMaxAdapter,
      };

      for (const [name, { score, level }] of Object.entries(riskScores)) {
        const addr = adapterNameToAddress[name];
        if (addr) {
          protocols.push(addr as Address);
          scores.push(score);

          // Build reason string from anomalies for this adapter
          const adapterAnomalies = anomalies.filter((a) => a.adapter === name);
          const reason =
            adapterAnomalies.length > 0
              ? adapterAnomalies.map((a) => `${a.type}: ${a.message}`).join("; ")
              : `Risk score: ${score}, Level: ${level}`;
          reasons.push(reason);
        }
      }

      try {
        // Write risk scores to RiskRegistry via batchUpdateRiskScores
        const txData = encodeFunctionData({
          abi: RiskRegistry,
          functionName: "batchUpdateRiskScores",
          args: [protocols, scores, reasons],
        });

        // CRE writeReport: pass encoded calldata via Report with rawReport
        evmClient
          .writeReport(runtime, {
            receiver: addresses.riskRegistry,
            report: new Report({ rawReport: txData }),
          })
          .result();

        runtime.log("Risk scores written on-chain successfully");
      } catch (err) {
        runtime.log(`Failed to write risk scores on-chain: ${err}`);
      }
    }

    allResults.push({
      chain: evm.chainName,
      adapters: adapters.map((a) => ({
        name: a.name,
        balance: a.balance.toString(),
        apy: a.apy.toString(),
        isHealthy: a.isHealthy,
      })),
      riskScores,
      anomalies: anomalies.map((a) => ({
        type: a.type,
        severity: a.severity,
        adapter: a.adapter,
        message: a.message,
      })),
      highestSeverity,
    });
  }

  return JSON.stringify({
    status: "monitoring_complete",
    timestamp: Date.now(),
    results: allResults,
  });
};

// ========================================
// WORKFLOW 3: AI REBALANCER (LOG TRIGGER)
// ========================================

const onRebalanceTrigger = (runtime: Runtime<Config>, triggerEvent: any): string => {
  runtime.log("=".repeat(60));
  runtime.log("⚖️  WORKFLOW 3: AI REBALANCER");
  runtime.log("Trigger: RiskScoreUpdated event (on-chain)");
  runtime.log("=".repeat(60));

  const evm = runtime.config.evms[0];
  const addresses = evm.addresses[0];
  const evmClient = createEvmClient(evm.chainName);

  // Decode the trigger event to get threat level
  // RiskScoreUpdated(address indexed protocol, uint8 oldScore, uint8 newScore, uint8 threatLevel)
  let triggerThreatLevel: number = THREAT_LEVEL.SAFE;
  try {
    if (triggerEvent?.data) {
      const decoded = decodeAbiParameters(
        [
          { name: "oldScore", type: "uint8" },
          { name: "newScore", type: "uint8" },
          { name: "threatLevel", type: "uint8" },
        ],
        triggerEvent.data
      );
      triggerThreatLevel = Number(decoded[2]);
    }
  } catch {
    runtime.log("Could not decode trigger event data, proceeding with default");
  }

  // Only rebalance for SAFE → WATCH or WATCH → WARNING transitions (not CRITICAL)
  if (triggerThreatLevel >= THREAT_LEVEL.CRITICAL) {
    runtime.log("Threat is CRITICAL — skipping rebalance (Shield Execute will handle)");
    return JSON.stringify({ status: "skipped", reason: "CRITICAL handled by Shield Execute" });
  }

  try {
    // Step 1: Read current pool allocations from ShieldVault
    runtime.log("Reading pool allocations...");
    const allocCallData = encodeFunctionData({
      abi: ShieldVault,
      functionName: "getPoolAllocations",
    });

    const allocResult = evmClient
      .callContract(runtime, {
        call: encodeCallMsg({
          from: zeroAddress,
          to: addresses.shieldVault as Address,
          data: allocCallData,
        }),
        blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
      })
      .result();

    const poolsRaw = decodeFunctionResult({
      abi: ShieldVault,
      functionName: "getPoolAllocations",
      data: bytesToHex(allocResult.data),
    }) as any[];

    const pools: PoolAllocation[] = (poolsRaw as any).map((p: any) => ({
      adapter: p.adapter,
      tier: Number(p.tier),
      targetWeight: p.targetWeight,
      currentAmount: p.currentAmount,
      isActive: p.isActive,
    }));

    // Step 2: Read current risk scores for all adapters
    runtime.log("Reading risk scores for allocation calculation...");
    const adapterAddresses = [
      addresses.aaveAdapter,
      addresses.compoundAdapter,
      addresses.morphoAdapter,
      addresses.yieldMaxAdapter,
    ];

    const riskInfo: AdapterRiskInfo[] = [];
    for (const addr of adapterAddresses) {
      try {
        const callData = encodeFunctionData({
          abi: RiskRegistry,
          functionName: "getProtocolRisk",
          args: [addr as Address],
        });

        const result = evmClient
          .callContract(runtime, {
            call: encodeCallMsg({
              from: zeroAddress,
              to: addresses.riskRegistry as Address,
              data: callData,
            }),
            blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
          })
          .result();

        const risk = decodeFunctionResult({
          abi: RiskRegistry,
          functionName: "getProtocolRisk",
          data: bytesToHex(result.data),
        }) as any;

        riskInfo.push({
          address: addr,
          riskScore: Number(risk.riskScore),
          threatLevel: getThreatLevelLabel(Number(risk.riskScore)),
          apy: 0n, // APY read would require additional calls; use 0 for safety
        });
      } catch (err) {
        runtime.log(`Error reading risk for ${addr}: ${err}`);
      }
    }

    // Step 3: Calculate optimal allocations
    runtime.log("Calculating optimal allocations...");
    const optimal = calculateOptimalAllocations(
      pools,
      riskInfo,
      runtime.config.shieldConfig
    );

    for (const alloc of optimal) {
      runtime.log(`  ${alloc.adapter.slice(0, 10)}... → ${alloc.newWeight / 100}%`);
    }

    // Step 4: Execute rebalance if allocations changed significantly
    if (shouldRebalance(pools, optimal, runtime.config.shieldConfig.rebalanceThresholdScoreChange * 100)) {
      runtime.log("Significant allocation change detected — executing rebalance...");

      // Update pool weights first, then call rebalance()
      for (const alloc of optimal) {
        const updateData = encodeFunctionData({
          abi: ShieldVault,
          functionName: "updatePoolWeight",
          args: [alloc.adapter as Address, BigInt(alloc.newWeight)],
        });

        evmClient
          .writeReport(runtime, {
            receiver: addresses.shieldVault,
            report: new Report({ rawReport: updateData }),
          })
          .result();
      }

      // Trigger rebalance
      const rebalanceData = encodeFunctionData({
        abi: ShieldVault,
        functionName: "rebalance",
      });

      evmClient
        .writeReport(runtime, {
          receiver: addresses.shieldVault,
          report: new Report({ rawReport: rebalanceData }),
        })
        .result();

      runtime.log("Rebalance executed successfully");

      return JSON.stringify({
        status: "rebalanced",
        timestamp: Date.now(),
        newAllocations: optimal,
      });
    } else {
      runtime.log("Allocations within threshold — no rebalance needed");
      return JSON.stringify({
        status: "no_rebalance_needed",
        timestamp: Date.now(),
      });
    }
  } catch (err) {
    runtime.log(`Rebalancer error: ${err}`);
    return JSON.stringify({
      status: "error",
      error: String(err),
      timestamp: Date.now(),
    });
  }
};

// ========================================
// WORKFLOW 4: SHIELD EXECUTE (LOG TRIGGER)
// ========================================

const onShieldTrigger = (runtime: Runtime<Config>, triggerEvent: any): string => {
  runtime.log("=".repeat(60));
  runtime.log("🛡️  WORKFLOW 4: SHIELD EXECUTE (EMERGENCY PROTOCOL)");
  runtime.log("Trigger: RiskScoreUpdated event (WARNING/CRITICAL)");
  runtime.log("=".repeat(60));

  const evm = runtime.config.evms[0];
  const addresses = evm.addresses[0];
  const shieldConfig = runtime.config.shieldConfig;

  // Decode the trigger event
  // RiskScoreUpdated(address indexed protocol, uint8 oldScore, uint8 newScore, uint8 threatLevel)
  let protocolAddress = "";
  let threatLevel = 0;
  let newScore = 0;

  try {
    if (triggerEvent?.topics && triggerEvent.topics.length >= 2) {
      // topics[0] = event sig, topics[1] = indexed protocol address
      const addrHex = triggerEvent.topics[1];
      protocolAddress = "0x" + addrHex.slice(-40);
    }

    if (triggerEvent?.data) {
      const decoded = decodeAbiParameters(
        [
          { name: "oldScore", type: "uint8" },
          { name: "newScore", type: "uint8" },
          { name: "threatLevel", type: "uint8" },
        ],
        triggerEvent.data
      );
      newScore = Number(decoded[1]);
      threatLevel = Number(decoded[2]);
    }
  } catch {
    runtime.log("Could not decode trigger event — proceeding with defaults");
  }

  const threatLabel = ["SAFE", "WATCH", "WARNING", "CRITICAL"][threatLevel] || "UNKNOWN";
  runtime.log(`Protocol: ${protocolAddress}, Score: ${newScore}, Level: ${threatLabel}`);

  // Only act on WARNING or CRITICAL
  if (threatLevel < THREAT_LEVEL.WARNING) {
    runtime.log(`Threat level ${threatLabel} below WARNING — no shield action needed`);
    return JSON.stringify({
      status: "no_action",
      reason: `Threat level ${threatLabel} does not require shield activation`,
    });
  }

  if (threatLevel === THREAT_LEVEL.WARNING) {
    // WARNING: Partial withdraw
    runtime.log("Executing WARNING protocol — partial withdrawal...");
    const result = executeWarningProtocol(
      runtime,
      evm.chainName,
      addresses.shieldVault,
      protocolAddress,
      `ShieldYield WARNING: Risk score ${newScore}/100 detected. Partial withdrawal to protect funds.`,
      shieldConfig
    );

    return JSON.stringify({
      status: "shield_activated",
      level: "WARNING",
      timestamp: Date.now(),
      ...result,
    });
  }

  if (threatLevel >= THREAT_LEVEL.CRITICAL) {
    // CRITICAL: Full emergency withdraw
    runtime.log("Executing CRITICAL protocol — EMERGENCY WITHDRAWAL...");
    const result = executeCriticalProtocol(
      runtime,
      evm.chainName,
      addresses.shieldVault,
      protocolAddress,
      `ShieldYield CRITICAL: Risk score ${newScore}/100. Emergency withdrawal to protect all funds.`
    );

    return JSON.stringify({
      status: "shield_activated",
      level: "CRITICAL",
      timestamp: Date.now(),
      ...result,
    });
  }

  return JSON.stringify({ status: "no_action" });
};

// ========================================
// WORKFLOW INIT
// ========================================

const initWorkflow = (config: Config) => {
  const cron = new CronCapability();

  const evm = config.evms[0];
  const addresses = evm.addresses[0];

  // Create EVMClient for log triggers
  const network = getNetwork({
    chainFamily: "evm",
    chainSelectorName: evm.chainName,
    isTestnet: true,
  });

  if (!network) {
    throw new Error(`Network not found: ${evm.chainName}`);
  }

  const evmClient = new EVMClient(network.chainSelector.selector);

  // Log trigger: listen for RiskScoreUpdated events on RiskRegistry
  const riskUpdateTrigger = evmClient.logTrigger({
    addresses: [toHex(toBytes(addresses.riskRegistry as Address, { size: 20 }))],
    topics: [{ values: [RISK_SCORE_UPDATED_SIG] }],
  });

  return [
    // Workflow 1+2: Sentinel Scan + Threat Assessment (Cron every 5 min)
    handler(cron.trigger({}), onCronTrigger),

    // Workflow 3: AI Rebalancer (triggered by on-chain RiskScoreUpdated event)
    handler(riskUpdateTrigger, onRebalanceTrigger),

    // Workflow 4: Shield Execute (triggered by on-chain RiskScoreUpdated event)
    handler(riskUpdateTrigger, onShieldTrigger),
  ];
};

export async function main() {
  const runner = await Runner.newRunner<Config>();
  await runner.run(initWorkflow);
}
