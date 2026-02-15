import {
    EVMClient,
    getNetwork,
    type Runtime,
    Report,
} from "@chainlink/cre-sdk";
import {
    type Address,
    encodeFunctionData,
} from "viem";

import { ShieldVault } from "../../contracts/abi";
import type { ShieldConfig } from "../monitors/types";

// ========================================
// TYPES
// ========================================

export interface ShieldAction {
    type: "PARTIAL_WITHDRAW" | "EMERGENCY_WITHDRAW" | "BRIDGE";
    adapter: string;
    reason: string;
    threatLevel: string;
}

export interface ShieldResult {
    actions: ShieldAction[];
    success: boolean;
    message: string;
}

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

// ========================================
// WARNING PROTOCOL: Partial Withdraw
// ========================================

/**
 * Execute WARNING level protocol:
 * - Partial withdraw (configurable %) from the risky adapter
 * - Funds stay in ShieldVault (contract moves to safe haven automatically)
 */
export function executeWarningProtocol(
    runtime: Runtime<any>,
    chainName: string,
    shieldVaultAddress: string,
    adapterAddress: string,
    reason: string,
    config: ShieldConfig
): ShieldResult {
    const evmClient = createEvmClient(chainName);

    const actions: ShieldAction[] = [];

    try {
        runtime.log(
            `ShieldExecutor: WARNING — partial withdraw ${config.warningWithdrawPercent / 100}% from ${adapterAddress}`
        );

        // Call ShieldVault.partialWithdraw(adapter, percentage, reason)
        const txData = encodeFunctionData({
            abi: ShieldVault,
            functionName: "partialWithdraw",
            args: [
                adapterAddress as Address,
                BigInt(config.warningWithdrawPercent),
                reason,
            ],
        });

        // CRE writeReport: pass encoded calldata via Report
        evmClient
            .writeReport(runtime, {
                receiver: shieldVaultAddress,
                report: new Report({ rawReport: txData }),
            })
            .result();

        actions.push({
            type: "PARTIAL_WITHDRAW",
            adapter: adapterAddress,
            reason,
            threatLevel: "WARNING",
        });

        return {
            actions,
            success: true,
            message: `Partial withdraw (${config.warningWithdrawPercent / 100}%) executed from ${adapterAddress}`,
        };
    } catch (err) {
        runtime.log(`ShieldExecutor: WARNING action failed — ${err}`);
        return {
            actions,
            success: false,
            message: `WARNING action failed: ${err}`,
        };
    }
}

// ========================================
// CRITICAL PROTOCOL: Emergency Withdraw
// ========================================

/**
 * Execute CRITICAL level protocol:
 * - Full emergency withdraw from the risky adapter
 * - ShieldVault contract automatically moves funds to safe haven
 */
export function executeCriticalProtocol(
    runtime: Runtime<any>,
    chainName: string,
    shieldVaultAddress: string,
    adapterAddress: string,
    reason: string
): ShieldResult {
    const evmClient = createEvmClient(chainName);

    const actions: ShieldAction[] = [];

    try {
        runtime.log(
            `ShieldExecutor: CRITICAL — emergency withdraw ALL from ${adapterAddress}`
        );

        // Call ShieldVault.emergencyWithdraw(adapter, reason)
        const txData = encodeFunctionData({
            abi: ShieldVault,
            functionName: "emergencyWithdraw",
            args: [adapterAddress as Address, reason],
        });

        // CRE writeReport: pass encoded calldata via Report
        evmClient
            .writeReport(runtime, {
                receiver: shieldVaultAddress,
                report: new Report({ rawReport: txData }),
            })
            .result();

        actions.push({
            type: "EMERGENCY_WITHDRAW",
            adapter: adapterAddress,
            reason,
            threatLevel: "CRITICAL",
        });

        return {
            actions,
            success: true,
            message: `Emergency withdraw executed from ${adapterAddress}. Funds moved to safe haven.`,
        };
    } catch (err) {
        runtime.log(`ShieldExecutor: CRITICAL action failed — ${err}`);
        return {
            actions,
            success: false,
            message: `CRITICAL action failed: ${err}`,
        };
    }
}
