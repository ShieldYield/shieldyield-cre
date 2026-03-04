/**
 * sim-writer.ts
 * ─────────────────────────────────────────────────────────────
 * On-chain writes untuk simulasi daemon.
 * Menggantikan EVMClient.writeReport() dari CRE SDK dengan
 * viem walletClient.writeContract() yang menggunakan private key.
 *
 * Setiap fungsi mengembalikan txHash nyata yang bisa diverifikasi
 * di Arbiscan: https://sepolia.arbiscan.io/tx/<hash>
 *
 * File ini TERPISAH dari kode CRE asli (shield/shield-executor.ts).
 * ─────────────────────────────────────────────────────────────
 */

import {
    createWalletClient,
    createPublicClient,
    http,
    type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia } from "viem/chains";

import { RiskRegistry, ShieldVault } from "../../contracts/abi";

// ─────────────────────────────────────────────────
// CLIENT FACTORY
// ─────────────────────────────────────────────────

export function createSimClients(rpcUrl: string, privateKey: string) {
    const account   = privateKeyToAccount(privateKey as `0x${string}`);
    const transport = http(rpcUrl);

    return {
        wallet: createWalletClient({ account, chain: arbitrumSepolia, transport }),
        public: createPublicClient({ chain: arbitrumSepolia, transport }),
        account,
    };
}

export type SimClients = ReturnType<typeof createSimClients>;

// ─────────────────────────────────────────────────
// WRITE: batchUpdateRiskScores → RiskRegistry
// Setara dengan writeReport() di WF 1+2
// ─────────────────────────────────────────────────

export async function writeBatchRiskScores(
    clients: SimClients,
    registryAddress: string,
    protocols: Address[],
    scores: number[],     // uint8[] — nilai 0-100
    reasons: string[]
): Promise<string> {
    const hash = await clients.wallet.writeContract({
        address: registryAddress as Address,
        abi: RiskRegistry,
        functionName: "batchUpdateRiskScores",
        args: [protocols, scores, reasons],
    });

    // Tunggu transaksi dikonfirmasi sebelum return
    await clients.public.waitForTransactionReceipt({ hash });
    return hash;
}

// ─────────────────────────────────────────────────
// WRITE: partialWithdraw → ShieldVault
// Setara dengan writeReport() di WF 4 (WARNING level)
// ─────────────────────────────────────────────────

export async function writePartialWithdraw(
    clients: SimClients,
    shieldVaultAddress: string,
    adapterAddress: string,
    basisPoints: number,   // misalnya 3000 = 30%
    reason: string
): Promise<string> {
    const hash = await clients.wallet.writeContract({
        address: shieldVaultAddress as Address,
        abi: ShieldVault,
        functionName: "partialWithdraw",
        args: [adapterAddress as Address, BigInt(basisPoints), reason],
    });

    await clients.public.waitForTransactionReceipt({ hash });
    return hash;
}

// ─────────────────────────────────────────────────
// WRITE: emergencyWithdraw → ShieldVault
// Setara dengan writeReport() di WF 4 (CRITICAL level)
// ─────────────────────────────────────────────────

export async function writeEmergencyWithdraw(
    clients: SimClients,
    shieldVaultAddress: string,
    adapterAddress: string,
    reason: string
): Promise<string> {
    const hash = await clients.wallet.writeContract({
        address: shieldVaultAddress as Address,
        abi: ShieldVault,
        functionName: "emergencyWithdraw",
        args: [adapterAddress as Address, reason],
    });

    await clients.public.waitForTransactionReceipt({ hash });
    return hash;
}
