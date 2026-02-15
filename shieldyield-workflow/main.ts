import {
  CronCapability,
  EVMClient,
  getNetwork,
  handler,
  Runner,
} from "@chainlink/cre-sdk";
import { toHex, toBytes, type Address } from "viem";

import { type Config, RISK_SCORE_UPDATED_SIG } from "./types/config";
import { onCronTrigger } from "./workflows/sentinel-scan";
import { onRebalanceTrigger } from "./workflows/rebalancer";
import { onShieldTrigger } from "./workflows/shield-execute";

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
