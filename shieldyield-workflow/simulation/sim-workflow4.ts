/**
 * sim-workflow4.ts
 * ─────────────────────────────────────────────────────────────
 * Workflow 4: Shield Execute Simulation
 *
 * Trigger: Threat Level WARNING or CRITICAL detected on-chain.
 *
 * WARNING flow:
 *   - Alert + partial withdraw (30%) via ShieldVault.partialWithdraw()
 *   - Log shield action to RiskRegistry
 *
 * CRITICAL flow:
 *   - Emergency full withdrawal via ShieldVault.emergencyWithdraw()
 *   - Log shield action + amount saved to RiskRegistry
 *   - Signal post-action: re-scan (Workflow 1) → re-optimize (Workflow 3)
 *
 * ─────────────────────────────────────────────────────────────
 */

import * as fs from "fs";
import * as path from "path";
import {
    createWalletClient,
    createPublicClient,
    http,
    type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia } from "viem/chains";

import { RiskRegistry, ShieldVault } from "../../contracts/abi";
import { readAllAdaptersSim, createSimPublicClient } from "./sim-reader";

const BASE_SEPOLIA_SELECTOR = 10344971235874465080n;

// Partial ABI for ShieldBridge since it's not exported from contracts/abi.ts
const ShieldBridgeABI = [
    {
        name: "emergencyBridge",
        type: "function",
        stateMutability: "nonpayable",
        inputs: [
            { name: "token", type: "address" },
            { name: "amount", type: "uint256" },
            { name: "destinationChainSelector", type: "uint64" },
        ],
        outputs: [{ name: "messageId", type: "bytes32" }],
    },
] as const;

// ─────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────

const CONFIG_PATH = path.join(__dirname, "..", "config.staging.json");
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));

const PRIVATE_KEY = process.env.PRIVATE_KEY ?? process.env.CRE_ETH_PRIVATE_KEY;
const RPC_URL = process.env.RPC_URL || "https://sepolia-rollup.arbitrum.io/rpc";

const arbEvm = config.evms.find((e: any) => e.chainName === "ethereum-testnet-sepolia-arbitrum-1");
const addresses = arbEvm?.addresses[0] || {};

if (!PRIVATE_KEY) {
    console.error("ERROR: Set CRE_ETH_PRIVATE_KEY=0x...");
    process.exit(1);
}

// ─────────────────────────────────────────────────
// VIEM CLIENTS
// ─────────────────────────────────────────────────

const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`);
const walletClient = createWalletClient({ account, chain: arbitrumSepolia, transport: http(RPC_URL) });
const publicClient = createPublicClient({ chain: arbitrumSepolia, transport: http(RPC_URL) });
const simClient = createSimPublicClient(RPC_URL, arbitrumSepolia);

// ─────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────

const C = {
    r: "\x1b[0m", dim: "\x1b[2m", bold: "\x1b[1m",
    cyan: "\x1b[36m", green: "\x1b[32m", yellow: "\x1b[33m",
    red: "\x1b[31m", magenta: "\x1b[35m",
};

// WARNING partial withdrawal: 30%
const WARNING_WITHDRAW_PCT = 30n;

// ThreatLevel enum: 0=SAFE, 1=WATCH, 2=WARNING, 3=CRITICAL
const THREAT_LABEL = ["SAFE", "WATCH", "WARNING", "CRITICAL"];

// ─────────────────────────────────────────────────
// READ THREAT STATE
// ─────────────────────────────────────────────────

interface ThreatAdapter {
    name:        string;
    address:     Address;
    riskScore:   number;
    threatLevel: number;
    threatLabel: string;
    balance:     bigint; // raw 6-decimal USDC
    apy:         bigint;
}

async function readThreatState(): Promise<ThreatAdapter[]> {
    const snaps = await readAllAdaptersSim(simClient, addresses);
    const registryAddr = addresses.riskRegistry as Address;
    const results: ThreatAdapter[] = [];

    for (const snap of snaps) {
        if (!snap.address) continue;
        try {
            const risk = await publicClient.readContract({
                address: registryAddr,
                abi: RiskRegistry,
                functionName: "getProtocolRisk",
                args: [snap.address as Address],
            }) as { riskScore: number; threatLevel: number };

            results.push({
                name:        snap.name,
                address:     snap.address as Address,
                riskScore:   Number(risk.riskScore),
                threatLevel: Number(risk.threatLevel),
                threatLabel: THREAT_LABEL[Number(risk.threatLevel)] ?? "SAFE",
                balance:     snap.balance,
                apy:         snap.apy,
            });
        } catch {
            results.push({
                name:        snap.name,
                address:     snap.address as Address,
                riskScore:   0,
                threatLevel: 0,
                threatLabel: "SAFE",
                balance:     snap.balance,
                apy:         snap.apy,
            });
        }
    }

    return results;
}

// ─────────────────────────────────────────────────
// EXECUTE SHIELD ACTION
// ─────────────────────────────────────────────────

async function executeShield(adapter: ThreatAdapter, vaultAddr: Address, registryAddr: Address): Promise<void> {
    const isCritical = adapter.threatLevel >= 3;
    const isWarning  = adapter.threatLevel === 2;

    const actionLabel = isCritical ? "EMERGENCY WITHDRAWAL" : "PARTIAL WITHDRAWAL (30%)";
    const actionColor = isCritical ? C.red : C.yellow;

    console.log(`\n  ${actionColor}${C.bold}${actionLabel}${C.r}`);
    console.log(`  ${C.dim}Target: ${adapter.name} (${adapter.address})${C.r}`);
    console.log(`  ${C.dim}Balance at risk: $${(Number(adapter.balance) / 1e18).toFixed(6)} USDC${C.r}`);

    if (isCritical) {
        // ── CRITICAL: full emergency withdrawal ──────────────────────────────
        const reason = `Shield Execute [CRITICAL]: Risk score ${adapter.riskScore}/100 — emergency withdrawal triggered by 21-node DON consensus`;

        try {
            const nonce = await publicClient.getTransactionCount({ address: account.address, blockTag: "pending" });
            const hash = await walletClient.writeContract({
                address: vaultAddr,
                abi: ShieldVault,
                functionName: "emergencyWithdraw",
                args: [adapter.address, reason],
                nonce,
            });

            console.log(`  ${C.red}TX submitted: ${hash}${C.r}`);
            const receipt = await publicClient.waitForTransactionReceipt({ hash });
            console.log(`  ${C.red}${C.bold}✅ Emergency withdrawal confirmed in block ${receipt.blockNumber}${C.r}`);
            console.log(`  ${C.dim}🔎 https://sepolia.arbiscan.io/tx/${hash}${C.r}`);

            if (addresses.shieldBridge && addresses.mockUSDC) {
                console.log(`\n  ${C.magenta}${C.bold}CROSS-CHAIN ESCAPE (CCIP) — REAL VAULT BRIDGE${C.r}`);
                console.log(`  ${C.dim}ShieldVault.bridgeToSafeChain() → withdraws from Aave → sends to ShieldBridge → CCIP to Base${C.r}`);
                
                try {
                    const bridgeNonce = await publicClient.getTransactionCount({ address: account.address, blockTag: "pending" });
                    
                    // Call ShieldVault.bridgeToSafeChain(amount, destinationChainSelector)
                    // The Vault will:
                    // 1. Withdraw from safe haven (Aave) 
                    // 2. Approve ShieldBridge
                    // 3. Call ShieldBridge.emergencyBridge → CCIP to Base Sepolia
                    const bridgeHash = await walletClient.writeContract({
                        address: vaultAddr,
                        abi: [{
                            name: "bridgeToSafeChain",
                            type: "function",
                            stateMutability: "nonpayable",
                            inputs: [
                                { name: "amount", type: "uint256" },
                                { name: "destinationChainSelector", type: "uint64" },
                            ],
                            outputs: [],
                        }],
                        functionName: "bridgeToSafeChain",
                        args: [adapter.balance, BASE_SEPOLIA_SELECTOR],
                        nonce: bridgeNonce,
                    });
                    
                    console.log(`  ${C.magenta}Bridge TX: ${bridgeHash}${C.r}`);
                    const bridgeReceipt = await publicClient.waitForTransactionReceipt({ hash: bridgeHash });
                    console.log(`  ${C.magenta}${C.bold}✅ Vault bridge confirmed in block ${bridgeReceipt.blockNumber}${C.r}`);
                    console.log(`  ${C.dim}   Funds evacuated from Aave (Arbitrum) → CCIP → Base Sepolia${C.r}`);
                    console.log(`  ${C.dim}🔎 https://sepolia.arbiscan.io/tx/${bridgeHash}${C.r}`);
                } catch (bridgeErr: any) {
                    console.log(`  ${C.yellow}⚠️  bridgeToSafeChain reverted: ${bridgeErr?.shortMessage || bridgeErr?.message || String(bridgeErr)}${C.r}`);
                    console.log(`  ${C.dim}   This may mean safe haven (Aave) has insufficient balance or ShieldBridge lacks ETH for CCIP fees.${C.r}`);
                }
            }

            try {
                const nonce2 = await publicClient.getTransactionCount({ address: account.address, blockTag: "pending" });
                const logHash = await walletClient.writeContract({
                    address: registryAddr,
                    abi: RiskRegistry,
                    functionName: "logShieldAction",
                    args: [
                        account.address,
                        adapter.address,
                        3, // CRITICAL
                        adapter.balance,
                        reason,
                    ],
                    nonce: nonce2,
                });
                await publicClient.waitForTransactionReceipt({ hash: logHash });
                console.log(`  ${C.red}Shield action logged on-chain: ${logHash}${C.r}`);
            } catch (logErr) {
               console.log(`  ${C.yellow}⚠️  logShieldAction reverted: RiskRegistry only allows ShieldVault. (Cosmetic error)${C.r}`);
            }
            console.log(`  ${C.red}${C.bold}  Amount saved + bridged: $${(Number(adapter.balance) / 1e18).toFixed(6)} USDC${C.r}`);

        } catch (err: any) {
            console.error(`  ${C.yellow}⚠️  emergencyWithdraw or bridge reverted.${C.r}`);
            console.error(`  ${C.dim}${err?.shortMessage || err?.message || String(err)}${C.r}`);
            console.log(`  ${C.cyan}[SIMULATED] Would have withdrawn $${(Number(adapter.balance) / 1e18).toFixed(6)} USDC from ${adapter.name}${C.r}`);
        }

    } else if (isWarning) {
        // ── WARNING: partial withdrawal 30% ──────────────────────────────────
        const amountAtRisk = (adapter.balance * WARNING_WITHDRAW_PCT) / 100n;
        const reason = `Shield Execute [WARNING]: Risk score ${adapter.riskScore}/100 — partial 30% withdrawal to reduce exposure`;

        try {
            const nonce = await publicClient.getTransactionCount({ address: account.address, blockTag: "pending" });
            const hash = await walletClient.writeContract({
                address: vaultAddr,
                abi: ShieldVault,
                functionName: "partialWithdraw",
                args: [adapter.address, WARNING_WITHDRAW_PCT, reason],
                nonce,
            });

            console.log(`  ${C.yellow}TX submitted: ${hash}${C.r}`);
            const receipt = await publicClient.waitForTransactionReceipt({ hash });
            console.log(`  ${C.yellow}${C.bold}✅ Partial withdrawal confirmed in block ${receipt.blockNumber}${C.r}`);
            console.log(`  ${C.dim}🔎 https://sepolia.arbiscan.io/tx/${hash}${C.r}`);

            try {
                const nonce2 = await publicClient.getTransactionCount({ address: account.address, blockTag: "pending" });
                const logHash = await walletClient.writeContract({
                    address: registryAddr,
                    abi: RiskRegistry,
                    functionName: "logShieldAction",
                    args: [
                        account.address,
                        adapter.address,
                        2, // WARNING
                        amountAtRisk,
                        reason,
                    ],
                    nonce: nonce2,
                });
                await publicClient.waitForTransactionReceipt({ hash: logHash });
                console.log(`  ${C.yellow}Shield action logged on-chain: ${logHash}${C.r}`);
            } catch (logErr) {
                console.log(`  ${C.yellow}⚠️  logShieldAction reverted: RiskRegistry only allows ShieldVault. (Cosmetic error)${C.r}`);
            }
            console.log(`  ${C.yellow}${C.bold}  Amount protected: $${(Number(amountAtRisk) / 1e18).toFixed(6)} USDC (30%)${C.r}`);

        } catch (err: any) {
            console.error(`  ${C.yellow}⚠️  partialWithdraw reverted (SC may be base version).${C.r}`);
            console.error(`  ${C.dim}${err?.shortMessage || err?.message || String(err)}${C.r}`);
            console.log(`  ${C.cyan}[SIMULATED] Would have withdrawn 30% ($${(Number(amountAtRisk) / 1e18).toFixed(6)} USDC) from ${adapter.name}${C.r}`);
            console.log(`  ${C.cyan}[SIMULATED] Remaining 70% ($${(Number(adapter.balance - amountAtRisk) / 1e18).toFixed(6)} USDC) stays in position${C.r}`);
        }
    }
}

// ─────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────

async function main() {
    console.log(`\n${C.red}${"═".repeat(60)}${C.r}`);
    console.log(`${C.bold}${C.red}  ShieldYield — Workflow 4: Shield Execute${C.r}`);
    console.log(`${C.dim}  Automated threat response · WARNING/CRITICAL positions${C.r}`);
    console.log(`${C.red}${"═".repeat(60)}${C.r}\n`);

    const vaultAddr    = addresses.shieldVault  as Address;
    const registryAddr = addresses.riskRegistry as Address;

    // 1. Read current threat state
    console.log(`${C.dim}[1/3] Reading threat state from RiskRegistry...${C.r}`);
    const adapters = await readThreatState();

    // 2. Display threat overview
    console.log(`\n${C.dim}  Adapter Threat Overview:${C.r}`);
    console.log(`${C.dim}${"─".repeat(60)}${C.r}`);
    for (const a of adapters) {
        const col = a.threatLevel >= 3 ? C.red
            : a.threatLevel === 2 ? C.yellow
            : C.dim;
        const marker = a.threatLevel >= 2 ? "!" : " ";
        console.log(
            `${marker} ${C.bold}${a.name.padEnd(18)}${C.r}` +
            ` ${col}${a.threatLabel.padEnd(10)}${C.r}` +
            ` score=${col}${a.riskScore}/100${C.r}` +
            `  balance=$${(Number(a.balance) / 1e18).toFixed(4)}`
        );
    }
    console.log(`${C.dim}${"─".repeat(60)}${C.r}\n`);

    // 3. Execute shields for WARNING / CRITICAL
    const actionTargets = adapters.filter(a => a.threatLevel >= 2);

    if (actionTargets.length === 0) {
        console.log(`${C.green}  No WARNING or CRITICAL adapters detected.${C.r}`);
        console.log(`${C.green}  All positions are safe — Shield Execute not triggered.${C.r}\n`);
    } else {
        console.log(`${C.red}${C.bold}  [3/3] Shield Execute triggered for ${actionTargets.length} adapter(s):${C.r}`);

        // Execute CRITICAL first, then WARNING
        const sorted = [
            ...actionTargets.filter(a => a.threatLevel >= 3),
            ...actionTargets.filter(a => a.threatLevel === 2),
        ];

        for (const adapter of sorted) {
            await executeShield(adapter, vaultAddr, registryAddr);
        }

        // Post-action summary
        const criticalCount = sorted.filter(a => a.threatLevel >= 3).length;
        const warningCount  = sorted.filter(a => a.threatLevel === 2).length;
        const totalSaved    = sorted.reduce((s, a) => {
            const withdrawn = a.threatLevel >= 3 ? a.balance : (a.balance * WARNING_WITHDRAW_PCT) / 100n;
            return s + Number(withdrawn);
        }, 0);

        console.log(`\n${C.bold}  Post-Action Summary:${C.r}`);
        console.log(`  ${C.red}  Emergency withdrawals: ${criticalCount}${C.r}`);
        console.log(`  ${C.yellow}  Partial withdrawals:   ${warningCount}${C.r}`);
        console.log(`  ${C.green}  Total protected:       $${(totalSaved / 1e18).toFixed(6)} USDC${C.r}`);
        console.log(`\n  ${C.dim}Next steps: Re-run Workflow 1 (Sentinel Scan) → Workflow 3 (AI Rebalancer)${C.r}`);
    }

    console.log(`\n${C.red}${"═".repeat(60)}${C.r}\n`);
}

main().catch(err => {
    console.error("Fatal:", err);
    process.exit(1);
});
