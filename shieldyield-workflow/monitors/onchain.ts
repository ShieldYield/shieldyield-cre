import {
    EVMClient,
    getNetwork,
    encodeCallMsg,
    bytesToHex,
    LAST_FINALIZED_BLOCK_NUMBER,
    type Runtime,
} from "@chainlink/cre-sdk";
import {
    type Address,
    encodeFunctionData,
    decodeFunctionResult,
    zeroAddress,
} from "viem";

import {
    AaveAdapter,
    CompoundAdapter,
    MorphoAdapter,
    YieldMaxAdapter,
    RiskRegistry,
} from "../../contracts/abi";

import type { AdapterSnapshot, ProtocolRiskSnapshot } from "./types";

// ========================================
// HELPER: Buat EVMClient untuk chain tertentu
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
// FUNGSI: Baca snapshot satu adapter
// ========================================
export function readAdapterSnapshot(
    runtime: Runtime<any>,
    evmClient: EVMClient,
    adapterName: string,
    adapterAddress: string,
    abi: typeof AaveAdapter
): AdapterSnapshot {
    // --- 1. Call getCurrentAPY() ---
    const apyCallData = encodeFunctionData({
        abi,
        functionName: "getCurrentAPY",
    });

    const apyResult = evmClient
        .callContract(runtime, {
            call: encodeCallMsg({
                from: zeroAddress,
                to: adapterAddress as Address,
                data: apyCallData,
            }),
            blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
        })
        .result();

    const apy = decodeFunctionResult({
        abi,
        functionName: "getCurrentAPY",
        data: bytesToHex(apyResult.data),
    });

    // --- 2. Call isHealthy() ---
    const healthCallData = encodeFunctionData({
        abi,
        functionName: "isHealthy",
    });

    const healthResult = evmClient
        .callContract(runtime, {
            call: encodeCallMsg({
                from: zeroAddress,
                to: adapterAddress as Address,
                data: healthCallData,
            }),
            blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
        })
        .result();

    const isHealthy = decodeFunctionResult({
        abi,
        functionName: "isHealthy",
        data: bytesToHex(healthResult.data),
    });

    // --- 3. Call getBalanceBreakdown() → returns (principal, accruedYield, currentBalance) ---
    // We use currentBalance instead of calling getBalance() separately to save 1 call
    const breakdownCallData = encodeFunctionData({
        abi,
        functionName: "getBalanceBreakdown",
    });

    const breakdownResult = evmClient
        .callContract(runtime, {
            call: encodeCallMsg({
                from: zeroAddress,
                to: adapterAddress as Address,
                data: breakdownCallData,
            }),
            blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
        })
        .result();

    const breakdown = decodeFunctionResult({
        abi,
        functionName: "getBalanceBreakdown",
        data: bytesToHex(breakdownResult.data),
    });

    return {
        name: adapterName,
        address: adapterAddress,
        balance: (breakdown as any)[2] as bigint, // currentBalance from breakdown
        apy: apy as bigint,
        isHealthy: isHealthy as boolean,
        principal: (breakdown as any)[0] as bigint,
        accruedYield: (breakdown as any)[1] as bigint,
    };
}

// ========================================
// FUNGSI: Baca semua adapter untuk satu chain
// ========================================
export function readAllAdapters(
    runtime: Runtime<any>,
    chainName: string,
    addresses: {
        aaveAdapter?: string;
        compoundAdapter?: string;
        morphoAdapter?: string;
        yieldMaxAdapter?: string;
    }
): AdapterSnapshot[] {
    const evmClient = createEvmClient(chainName);

    const allAdapterConfigs = [
        { name: "AaveAdapter", address: addresses.aaveAdapter, abi: AaveAdapter },
        { name: "CompoundAdapter", address: addresses.compoundAdapter, abi: CompoundAdapter },
        { name: "MorphoAdapter", address: addresses.morphoAdapter, abi: MorphoAdapter },
        { name: "YieldMaxAdapter", address: addresses.yieldMaxAdapter, abi: YieldMaxAdapter },
    ];

    // Filter out adapters without addresses (supports multi-chain partial deployments)
    const adapterConfigs = allAdapterConfigs.filter(
        (cfg) => cfg.address && cfg.address.length > 0
    );

    if (adapterConfigs.length === 0) {
        runtime.log(`⏭️ No adapters configured on ${chainName}`);
        return [];
    }

    runtime.log(`Reading ${adapterConfigs.length} adapters on ${chainName}...`);
    const snapshots: AdapterSnapshot[] = [];

    for (const cfg of adapterConfigs) {
        try {
            const snapshot = readAdapterSnapshot(
                runtime, evmClient, cfg.name, cfg.address!, cfg.abi
            );
            snapshots.push(snapshot);
            runtime.log(
                `✅ ${cfg.name}: balance=${snapshot.balance}, apy=${snapshot.apy}, healthy=${snapshot.isHealthy}`
            );
        } catch (err) {
            runtime.log(`❌ Error reading ${cfg.name}: ${err}`);
        }
    }

    return snapshots;
}

// ========================================
// FUNGSI: Baca risk data dari RiskRegistry
// ========================================
export function readProtocolRisk(
    runtime: Runtime<any>,
    evmClient: EVMClient,
    registryAddress: string,
    protocolAddress: string
): ProtocolRiskSnapshot {
    const callData = encodeFunctionData({
        abi: RiskRegistry,
        functionName: "getProtocolRisk",
        args: [protocolAddress as Address],
    });

    const result = evmClient
        .callContract(runtime, {
            call: encodeCallMsg({
                from: zeroAddress,
                to: registryAddress as Address,
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

    return {
        address: protocolAddress,
        riskScore: Number(risk.riskScore),
        threatLevel: Number(risk.threatLevel),
        lastUpdated: risk.lastUpdated as bigint,
        isActive: risk.isActive as boolean,
    };
}

// ========================================
// FUNGSI: Baca risk semua adapter
// ========================================
export function readAllRisks(
    runtime: Runtime<any>,
    chainName: string,
    registryAddress: string,
    adapterAddresses: string[]
): ProtocolRiskSnapshot[] {
    const evmClient = createEvmClient(chainName);
    const risks: ProtocolRiskSnapshot[] = [];

    for (const addr of adapterAddresses) {
        try {
            const risk = readProtocolRisk(runtime, evmClient, registryAddress, addr);
            risks.push(risk);
            runtime.log(
                `📊 Risk for ${addr.slice(0, 10)}...: score=${risk.riskScore}, threat=${risk.threatLevel}`
            );
        } catch (err) {
            runtime.log(`❌ Error reading risk for ${addr}: ${err}`);
        }
    }

    return risks;
}
