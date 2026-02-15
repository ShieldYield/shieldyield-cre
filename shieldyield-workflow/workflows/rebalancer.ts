import {
    encodeCallMsg,
    bytesToHex,
    LAST_FINALIZED_BLOCK_NUMBER,
    type Runtime,
    Report,
} from "@chainlink/cre-sdk";
import {
    type Address,
    encodeFunctionData,
    decodeFunctionResult,
    decodeAbiParameters,
    zeroAddress,
} from "viem";

import { getThreatLevelLabel } from "../monitors";

import {
    calculateOptimalAllocations,
    shouldRebalance,
    type PoolAllocation,
    type AdapterRiskInfo,
} from "../rebalancer";

import { RiskRegistry, ShieldVault } from "../../contracts/abi";
import { createEvmClient, THREAT_LEVEL, type Config } from "../types/config";

// ========================================
// WORKFLOW 3: AI REBALANCER (LOG TRIGGER)
// ========================================

export const onRebalanceTrigger = (runtime: Runtime<Config>, triggerEvent: any): string => {
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
