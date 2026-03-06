import {
    type Runtime,
} from "@chainlink/cre-sdk";
import {
    decodeAbiParameters,
    toHex,
} from "viem";

import {
    executeWarningProtocol,
    executeCriticalProtocol,
    executeCriticalBridgeProtocol,
} from "../shield";

import { THREAT_LEVEL, type Config } from "../types/config";

// Base Sepolia CCIP chain selector
const BASE_SEPOLIA_SELECTOR = 10344971235874465080n;

// ========================================
// WORKFLOW 4: SHIELD EXECUTE (LOG TRIGGER)
// ========================================

export const onShieldTrigger = (runtime: Runtime<Config>, triggerEvent: any): string => {
    runtime.log("=".repeat(60));
    runtime.log("🛡️  WORKFLOW 4: SHIELD EXECUTE (EMERGENCY PROTOCOL)");
    runtime.log("Trigger: RiskScoreUpdated event (WARNING/CRITICAL)");
    runtime.log("=".repeat(60));

    // Fix: We must select the Arbitrum Sepolia config (index 1) where our addresses are
    const evm = runtime.config.evms.find(e => e.chainName === "ethereum-testnet-sepolia-arbitrum-1") || runtime.config.evms[0];
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
            // Note: CRE SDK passes topics as Uint8Array!
            const addrHex = typeof triggerEvent.topics[1] === "string"
                ? triggerEvent.topics[1]
                : toHex(triggerEvent.topics[1]);
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
            addresses.shieldVault!,
            protocolAddress,
            `ShieldYield WARNING: Risk score ${newScore}/100 detected. Partial withdrawal to protect funds.`,
            shieldConfig
        );

        return JSON.stringify({
            status: "shield_activated",
            level: "WARNING",
            workflowId: "0xe1a46d08013e5749b754effd2bd197ceccfb18a0efdc9cacb8bded35b965910",
            timestamp: Date.now(),
            ...result,
        });
    }

    if (threatLevel >= THREAT_LEVEL.CRITICAL) {
        // CRITICAL step 1: Emergency withdraw from risky adapter on Arbitrum
        runtime.log("Executing CRITICAL protocol — EMERGENCY WITHDRAWAL...");
        const withdrawResult = executeCriticalProtocol(
            runtime,
            evm.chainName,
            addresses.shieldVault!,
            protocolAddress,
            `ShieldYield CRITICAL: Risk score ${newScore}/100. Emergency withdrawal to protect all funds.`
        );

        // CRITICAL step 2: CCIP bridge funds from Arbitrum → Base Sepolia
        // On Base: ShieldBridge.ccipReceive() → ShieldVault.depositFor() → Aave + Compound adapters
        const baseEvm = runtime.config.evms.find(e => e.chainName === "ethereum-testnet-sepolia-base-1");
        const baseAddresses = baseEvm?.addresses[0];

        if (addresses.shieldBridge && baseAddresses?.shieldVault && addresses.mockUSDC) {
            runtime.log("Initiating CCIP bridge: Arbitrum Sepolia → Base Sepolia...");
            runtime.log(`  Arb ShieldBridge: ${addresses.shieldBridge}`);
            runtime.log(`  Base safe haven (ShieldVault): ${baseAddresses.shieldVault}`);
            runtime.log(`  Base Aave adapter: ${baseAddresses.aaveAdapter}`);
            runtime.log(`  Base Compound adapter: ${baseAddresses.compoundAdapter}`);

            const bridgeResult = executeCriticalBridgeProtocol(
                runtime,
                evm.chainName,
                addresses.shieldBridge,
                addresses.mockUSDC,
                0n, // full balance — ShieldVault determines amount
                BASE_SEPOLIA_SELECTOR,
                `CCIP Emergency: Evacuating to Base Sepolia. Risk score ${newScore}/100.`
            );

            runtime.log(`CCIP bridge: ${bridgeResult.message}`);

            return JSON.stringify({
                status: "shield_activated",
                level: "CRITICAL",
                workflowId: "0xe1a46d08013e5749b754effd2bd197ceccfb18a0efdc9cacb8bded35b965910",
                timestamp: Date.now(),
                withdraw: withdrawResult,
                bridge: {
                    ...bridgeResult,
                    sourceChain: "Arbitrum Sepolia",
                    destinationChain: "Base Sepolia",
                    destinationVault: baseAddresses.shieldVault,
                    safeHavenAdapters: {
                        aave: baseAddresses.aaveAdapter,
                        compound: baseAddresses.compoundAdapter,
                    },
                },
            });
        }

        return JSON.stringify({
            status: "shield_activated",
            level: "CRITICAL",
            workflowId: "0xe1a46d08013e5749b754effd2bd197ceccfb18a0efdc9cacb8bded35b965910",
            timestamp: Date.now(),
            ...withdrawResult,
        });
    }

    return JSON.stringify({ status: "no_action" });
};
