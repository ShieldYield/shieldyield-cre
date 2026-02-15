import {
    type Runtime,
} from "@chainlink/cre-sdk";
import {
    decodeAbiParameters,
} from "viem";

import {
    executeWarningProtocol,
    executeCriticalProtocol,
} from "../shield";

import { THREAT_LEVEL, type Config } from "../types/config";

// ========================================
// WORKFLOW 4: SHIELD EXECUTE (LOG TRIGGER)
// ========================================

export const onShieldTrigger = (runtime: Runtime<Config>, triggerEvent: any): string => {
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
