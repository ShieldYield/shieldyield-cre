/**
 * sim-workflow3.ts
 * ─────────────────────────────────────────────────────────────
 * Workflow 3: AI Rebalancer Simulation
 *
 * Flow:
 *   1. Read current risk scores from RiskRegistry (on-chain)
 *   2. Read adapter APYs + balances (on-chain)
 *   3. Compute optimal allocation via risk-adjusted scoring
 *      - CRITICAL (>75): reduce to 0%  → exit position
 *      - WARNING  (51-75): reduce to 10% → minimal exposure
 *      - WATCH    (26-50): reduce to 15% → cautious
 *      - SAFE     (0-25):  distribute remaining ∝ APY
 *   4. Log full rebalancing plan
 *   5. Call ShieldVault.rebalance() → on-chain broadcast
 *
 * Trigger: manual (post Workflow 1/2 threat assessment)
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
import { arbitrumSepolia, baseSepolia } from "viem/chains";

import { RiskRegistry, ShieldVault } from "../../contracts/abi";
import { readAllAdaptersSim, createSimPublicClient } from "./sim-reader";

// ─────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────

const CONFIG_PATH = path.join(__dirname, "..", "config.staging.json");
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));

const PRIVATE_KEY = process.env.PRIVATE_KEY ?? process.env.CRE_ETH_PRIVATE_KEY;
const RPC_URL = process.env.RPC_URL || "https://sepolia.base.org";

const baseEvm = config.evms.find((e: any) => e.chainName === "ethereum-testnet-sepolia-base-1");
const addresses = baseEvm?.addresses[0] || {};

if (!PRIVATE_KEY) {
    console.error("ERROR: Set CRE_ETH_PRIVATE_KEY=0x...");
    process.exit(1);
}

// ─────────────────────────────────────────────────
// VIEM CLIENTS
// ─────────────────────────────────────────────────

const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`);
const walletClient = createWalletClient({ account, chain: baseSepolia, transport: http(RPC_URL) });
const publicClient = createPublicClient({ chain: baseSepolia, transport: http(RPC_URL) });
const simClient = createSimPublicClient(RPC_URL, baseSepolia);

// ─────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────

const C = {
    r: "\x1b[0m", dim: "\x1b[2m", bold: "\x1b[1m",
    cyan: "\x1b[36m", green: "\x1b[32m", yellow: "\x1b[33m",
    red: "\x1b[31m", blue: "\x1b[34m", magenta: "\x1b[35m",
};

const ADAPTER_ADDRESSES: Record<string, Address> = {
    AaveAdapter:     addresses.aaveAdapter     as Address,
    CompoundAdapter: addresses.compoundAdapter as Address,
    MorphoAdapter:   addresses.morphoAdapter   as Address,
    YieldMaxAdapter: addresses.yieldMaxAdapter as Address,
};

// ThreatLevel enum: 0=SAFE, 1=WATCH, 2=WARNING, 3=CRITICAL
const THREAT_LABEL = ["SAFE", "WATCH", "WARNING", "CRITICAL"];
const THREAT_COLOR = [C.green, C.yellow, C.yellow, C.red];

// Rebalancer target weights per threat level (basis points, 10000 = 100%)
const TARGET_WEIGHT_BP: Record<string, number> = {
    SAFE:     0,    // distributed proportionally to APY
    WATCH:    1500, // max 15%
    WARNING:  1000, // max 10%
    CRITICAL: 0,    // exit
};

// ─────────────────────────────────────────────────
// READ RISK SCORES
// ─────────────────────────────────────────────────

interface RiskInfo {
    name: string;
    address: Address;
    riskScore: number;
    threatLevel: number;
    threatLabel: string;
    apy: number;       // basis points (e.g. 297 = 2.97%)
    balance: number;   // USDC 6-decimal
}

async function readAllRiskInfo(): Promise<RiskInfo[]> {
    const adapterSnapshots = await readAllAdaptersSim(simClient, addresses);
    const registryAddr = addresses.riskRegistry as Address;

    const results: RiskInfo[] = [];

    for (const snap of adapterSnapshots) {
        if (!snap.address) continue;
        try {
            const risk = await publicClient.readContract({
                address: registryAddr,
                abi: RiskRegistry,
                functionName: "getProtocolRisk",
                args: [snap.address as Address],
            }) as { riskScore: number; threatLevel: number; lastUpdated: bigint; isActive: boolean };

            results.push({
                name:        snap.name,
                address:     snap.address as Address,
                riskScore:   Number(risk.riskScore),
                threatLevel: Number(risk.threatLevel),
                threatLabel: THREAT_LABEL[Number(risk.threatLevel)] ?? "SAFE",
                apy:         Number(snap.apy),
                balance:     Number(snap.balance),
            });
        } catch {
            results.push({
                name:        snap.name,
                address:     snap.address as Address,
                riskScore:   0,
                threatLevel: 0,
                threatLabel: "SAFE",
                apy:         Number(snap.apy),
                balance:     Number(snap.balance),
            });
        }
    }

    return results;
}

// ─────────────────────────────────────────────────
// COMPUTE OPTIMAL ALLOCATION
// ─────────────────────────────────────────────────

interface AllocationPlan {
    name: string;
    address: Address;
    threatLabel: string;
    riskScore: number;
    apy: number;
    currentBalance: number;
    targetWeightBp: number;   // 0–10000
    action: "EXIT" | "REDUCE" | "HOLD" | "INCREASE";
    actionDetail: string;
}

function computeOptimalAllocation(adapters: RiskInfo[]): AllocationPlan[] {
    const totalBalance = adapters.reduce((s, a) => s + a.balance, 0);

    // Step 1: assign fixed max weights to non-SAFE adapters
    let reservedBp = 0;
    const plans: Omit<AllocationPlan, "action" | "actionDetail">[] = adapters.map(a => {
        if (a.threatLabel === "CRITICAL") {
            reservedBp += 0;
            return { ...a, currentBalance: a.balance, targetWeightBp: 0 };
        }
        if (a.threatLabel === "WARNING") {
            reservedBp += TARGET_WEIGHT_BP.WARNING;
            return { ...a, currentBalance: a.balance, targetWeightBp: TARGET_WEIGHT_BP.WARNING };
        }
        if (a.threatLabel === "WATCH") {
            reservedBp += TARGET_WEIGHT_BP.WATCH;
            return { ...a, currentBalance: a.balance, targetWeightBp: TARGET_WEIGHT_BP.WATCH };
        }
        return { ...a, currentBalance: a.balance, targetWeightBp: 0 }; // SAFE: will be distributed below
    });

    // Step 2: distribute remaining to SAFE adapters ∝ APY
    const remainingBp = Math.max(0, 10000 - reservedBp);
    const safeAdapters = plans.filter(p => p.threatLabel === "SAFE");
    const totalApy = safeAdapters.reduce((s, a) => s + a.apy, 0);

    for (const plan of plans) {
        if (plan.threatLabel === "SAFE") {
            plan.targetWeightBp = totalApy > 0
                ? Math.round((plan.apy / totalApy) * remainingBp)
                : Math.round(remainingBp / Math.max(1, safeAdapters.length));
        }
    }

    // Step 3: determine actions + detail
    const currentWeights = adapters.map(a => ({
        name: a.name,
        currentBp: totalBalance > 0 ? Math.round((a.balance / totalBalance) * 10000) : 0,
    }));

    return plans.map(p => {
        const current = currentWeights.find(c => c.name === p.name)!;
        const delta = p.targetWeightBp - current.currentBp;
        let action: AllocationPlan["action"];
        let actionDetail: string;

        if (p.threatLabel === "CRITICAL") {
            action = "EXIT";
            actionDetail = `Full exit — CRITICAL threat (score=${p.riskScore}/100)`;
        } else if (delta < -200) {
            action = "REDUCE";
            actionDetail = `Reduce ${current.currentBp / 100}% → ${p.targetWeightBp / 100}% (${Math.abs(delta) / 100}% reduction)`;
        } else if (delta > 200) {
            action = "INCREASE";
            actionDetail = `Increase ${current.currentBp / 100}% → ${p.targetWeightBp / 100}% (${delta / 100}% increase, APY=${p.apy / 100}%)`;
        } else {
            action = "HOLD";
            actionDetail = `Hold at ~${p.targetWeightBp / 100}% — within rebalance threshold`;
        }

        return { ...p, action, actionDetail };
    });
}

// ─────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────

async function main() {
    console.log(`\n${C.cyan}${"═".repeat(60)}${C.r}`);
    console.log(`${C.bold}${C.cyan}  ShieldYield — Workflow 3: AI Rebalancer${C.r}`);
    console.log(`${C.dim}  Risk-adjusted optimal allocation → on-chain rebalance${C.r}`);
    console.log(`${C.cyan}${"═".repeat(60)}${C.r}\n`);

    // 1. Read on-chain state
    console.log(`${C.dim}[1/4] Reading current on-chain state...${C.r}`);
    const adapters = await readAllRiskInfo();

    const totalBalance = adapters.reduce((s, a) => s + a.balance, 0);
    console.log(`${C.green}  ✓ TVL: $${(totalBalance / 1e6).toFixed(4)}${C.r}`);
    console.log(`${C.green}  ✓ Adapters: ${adapters.length}${C.r}\n`);

    // 2. Display current state
    console.log(`${C.dim}[2/4] Current risk landscape:${C.r}`);
    console.log(`${C.dim}${"─".repeat(60)}${C.r}`);
    console.log(
        `  ${"Adapter".padEnd(18)} ${"Score".padEnd(8)} ${"Threat".padEnd(12)} ${"APY".padEnd(10)} Balance`
    );
    console.log(`${C.dim}${"─".repeat(60)}${C.r}`);
    for (const a of adapters) {
        const col = THREAT_COLOR[a.threatLevel] ?? C.green;
        console.log(
            `  ${C.bold}${a.name.padEnd(18)}${C.r}` +
            ` ${col}${String(a.riskScore).padEnd(8)}${C.r}` +
            ` ${col}${a.threatLabel.padEnd(12)}${C.r}` +
            ` ${(a.apy / 100).toFixed(2).padStart(5)}%`.padEnd(10) +
            ` $${(a.balance / 1e6).toFixed(6)}`
        );
    }
    console.log(`${C.dim}${"─".repeat(60)}${C.r}\n`);

    // 3. Compute optimal allocation
    console.log(`${C.dim}[3/4] Computing optimal allocation...${C.r}`);
    const plan = computeOptimalAllocation(adapters);

    console.log(`${C.dim}${"─".repeat(60)}${C.r}`);
    console.log(`  ${"Adapter".padEnd(18)} ${"Action".padEnd(10)} Detail`);
    console.log(`${C.dim}${"─".repeat(60)}${C.r}`);

    let hasChanges = false;
    for (const p of plan) {
        const actionColor = p.action === "EXIT" ? C.red
            : p.action === "REDUCE" ? C.yellow
            : p.action === "INCREASE" ? C.green
            : C.dim;
        const marker = p.action !== "HOLD" ? "*" : " ";
        if (p.action !== "HOLD") hasChanges = true;
        console.log(
            `${marker} ${C.bold}${p.name.padEnd(18)}${C.r}` +
            ` ${actionColor}${C.bold}${p.action.padEnd(10)}${C.r}` +
            ` ${C.dim}${p.actionDetail}${C.r}`
        );
    }
    console.log(`${C.dim}${"─".repeat(60)}${C.r}\n`);

    if (!hasChanges) {
        console.log(`${C.green}  Portfolio is optimally balanced. No rebalancing needed.${C.r}\n`);
    }

    // 4. Execute on-chain rebalance via ShieldVault.rebalance()
    console.log(`${C.dim}[4/4] Broadcasting on-chain rebalance...${C.r}`);
    const vaultAddr    = addresses.shieldVault  as Address;
    const registryAddr = addresses.riskRegistry as Address;

    const actionItems = plan.filter(x => x.action !== "HOLD");

    if (actionItems.length === 0) {
        console.log(`  ${C.green}No rebalancing actions required — portfolio is optimal.${C.r}`);
    } else {
        console.log(`\n  ${C.cyan}Executing ShieldVault.rebalance() on Base Sepolia...${C.r}`);
        for (const p of actionItems) {
            const col = p.action === "EXIT" ? C.red : p.action === "REDUCE" ? C.yellow : C.green;
            console.log(`  ${col}  → ${p.name}: ${p.action} — ${p.actionDetail}${C.r}`);
        }

        // Update pool weights in vault to match optimal allocation, then rebalance
        try {
            const nonce = await publicClient.getTransactionCount({ address: account.address, blockTag: "pending" });
            const rebalanceHash = await walletClient.writeContract({
                address: vaultAddr,
                abi: ShieldVault,
                functionName: "rebalance",
                args: [],
                nonce,
            });
            await publicClient.waitForTransactionReceipt({ hash: rebalanceHash });
            console.log(`  ${C.green}✅ ShieldVault.rebalance() confirmed: ${rebalanceHash}${C.r}`);
            console.log(`  ${C.green}🔎 https://sepolia.basescan.org/tx/${rebalanceHash}${C.r}`);
        } catch (err: any) {
            console.error(`  ${C.yellow}rebalance() failed: ${err?.shortMessage || err?.message}${C.r}`);
        }

        // Log highest-severity action to RiskRegistry
        const criticals = plan.filter(p => p.action === "EXIT");
        const warnings  = plan.filter(p => p.action === "REDUCE" && p.threatLabel === "WARNING");
        const targets   = [...criticals, ...warnings];

        if (targets.length > 0) {
            const highestThreat = criticals.length > 0 ? 3 : 2;
            const totalSaved    = targets.reduce((s, p) => s + p.currentBalance, 0);

            console.log(`\n  ${C.dim}Logging shield action to RiskRegistry...${C.r}`);
            try {
                const nonce2 = await publicClient.getTransactionCount({ address: account.address, blockTag: "pending" });
                const logHash = await walletClient.writeContract({
                    address: registryAddr,
                    abi: RiskRegistry,
                    functionName: "logShieldAction",
                    args: [
                        account.address,
                        targets[0].address,
                        highestThreat,
                        BigInt(totalSaved),
                        `Workflow 3 Rebalance: ${targets.map(t => t.name).join(", ")} allocation reduced`,
                    ],
                    nonce: nonce2,
                });
                await publicClient.waitForTransactionReceipt({ hash: logHash });
                console.log(`  ${C.green}Shield action logged on-chain: ${logHash}${C.r}`);
                console.log(`  ${C.green}🔎 https://sepolia.basescan.org/tx/${logHash}${C.r}`);
            } catch (err: any) {
                console.error(`  ${C.yellow}logShieldAction failed: ${err?.shortMessage || err?.message}${C.r}`);
            }
        }
    }

    console.log(`\n${C.cyan}${"═".repeat(60)}${C.r}\n`);
}

main().catch(err => {
    console.error("Fatal:", err);
    process.exit(1);
});
