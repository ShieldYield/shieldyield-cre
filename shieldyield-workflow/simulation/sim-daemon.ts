/**
 * sim-daemon.ts
 * ─────────────────────────────────────────────────────────────
 * CRE Simulation Daemon
 *
 * 1. Runs `bunx cre workflow simulate ... --broadcast` every 30s
 * 2. Parses the risk scores from the CRE output
 * 3. Writes them directly to RiskRegistry via viem (direct viem write)
 *    — because CRE SDK's writeReport() routes TX to WorkflowLogger,
 *      not RiskRegistry. Direct viem write is the correct on-chain approach.
 * ─────────────────────────────────────────────────────────────
 */

import * as fs from "fs";
import * as path from "path";
import { $ } from "bun";
import {
    createWalletClient,
    createPublicClient,
    http,
    type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia } from "viem/chains";

import { RiskRegistry } from "../../contracts/abi";

// ─────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────

const CONFIG_PATH = path.join(__dirname, "..", "config.staging.json");
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));

const PRIVATE_KEY = process.env.PRIVATE_KEY ?? process.env.CRE_ETH_PRIVATE_KEY;
const RPC_URL = process.env.RPC_URL || "https://sepolia-rollup.arbitrum.io/rpc";
const CRON_MS = 30_000;

const arbEvm = config.evms.find((e: any) => e.chainName === "ethereum-testnet-sepolia-arbitrum-1");
const addresses = arbEvm?.addresses[0] || {};

if (!PRIVATE_KEY) {
    console.error("[DAEMON] ERROR: Set CRE_ETH_PRIVATE_KEY=0x...");
    process.exit(1);
}

// ─────────────────────────────────────────────────
// VIEM CLIENTS  (for direct on-chain writes)
// ─────────────────────────────────────────────────

const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`);
const walletClient = createWalletClient({ account, chain: arbitrumSepolia, transport: http(RPC_URL) });
const publicClient = createPublicClient({ chain: arbitrumSepolia, transport: http(RPC_URL) });

// ─────────────────────────────────────────────────
// ADAPTER ADDRESS MAP
// ─────────────────────────────────────────────────

const ADAPTER_ADDRESSES: Record<string, string> = {
    AaveAdapter:     addresses.aaveAdapter     || "",
    CompoundAdapter: addresses.compoundAdapter || "",
    MorphoAdapter:   addresses.morphoAdapter   || "",
    YieldMaxAdapter: addresses.yieldMaxAdapter || "",
};

// ─────────────────────────────────────────────────
// LOGGER
// ─────────────────────────────────────────────────

const C = {
    r: "\x1b[0m", dim: "\x1b[2m", bold: "\x1b[1m",
    cyan: "\x1b[36m", green: "\x1b[32m", yellow: "\x1b[33m", red: "\x1b[31m",
};

function log(tag: string, msg: string, color: string = C.r) {
    const ts = new Date().toISOString().replace("T", " ").split(".")[0];
    console.log(`${C.dim}[${ts}]${C.r} ${color}${C.bold}[${tag}]${C.r} ${msg}`);
}

// ─────────────────────────────────────────────────
// PARSE RISK SCORES FROM CRE OUTPUT
// ─────────────────────────────────────────────────

interface ParsedScore {
    name: string;
    address: string;
    score: number;
    reason: string;
}

function parseRiskScores(output: string): ParsedScore[] {
    const scores: ParsedScore[] = [];
    // Match log lines like: [X] AaveAdapter (0xABCD...): score=13, reason="..."
    const regex = /\[\d+\] (\w+Adapter) \((0x[0-9a-fA-F]+)\): score=(\d+), reason="([^"]*)"/g;
    let match;
    while ((match = regex.exec(output)) !== null) {
        scores.push({
            name: match[1],
            address: match[2],
            score: parseInt(match[3], 10),
            reason: match[4],
        });
    }
    return scores;
}

// ─────────────────────────────────────────────────
// WRITE RISK SCORES DIRECTLY TO REGISTRY
// ─────────────────────────────────────────────────

async function writeRiskScores(scores: ParsedScore[]): Promise<void> {
    if (scores.length === 0) {
        log("WRITE", "No scores to write.", C.dim);
        return;
    }

    const protocols: Address[] = scores.map(s => s.address as Address);
    const scoreValues: number[] = scores.map(s => s.score);
    const reasons: string[] = scores.map(s => s.reason || `Risk score: ${s.score}`);
    const registryAddr = addresses.riskRegistry as Address;

    log("WRITE", `Writing ${scores.length} risk scores to RiskRegistry (${registryAddr})...`, C.cyan);
    for (const s of scores) {
        log("WRITE", `  ${s.name}: score=${s.score}/100`, s.score > 50 ? C.yellow : C.dim);
    }

    try {
        const nonce = await publicClient.getTransactionCount({ address: account.address, blockTag: "pending" });
        const hash = await walletClient.writeContract({
            address: registryAddr,
            abi: RiskRegistry,
            functionName: "batchUpdateRiskScores",
            args: [protocols, scoreValues, reasons],
            nonce,
        });

        log("WRITE", `TX submitted: ${hash}`, C.cyan);
        log("WRITE", "Waiting for confirmation...", C.dim);
        await publicClient.waitForTransactionReceipt({ hash });
        log("WRITE", "✅ Risk scores confirmed on-chain!", C.green);
        log("WRITE", `🔎 https://sepolia.arbiscan.io/tx/${hash}`, C.green);
    } catch (err: any) {
        log("WRITE", `❌ Write failed: ${err?.message || err}`, C.red);
    }
}

// ─────────────────────────────────────────────────
// MAIN SIMULATION CYCLE
// ─────────────────────────────────────────────────

async function runCycle() {
    log("CRON", "Running CRE workflow simulation...", C.cyan);

    let output = "";
    try {
        // Run CRE simulation and capture output
        const proc = await $`cd .. && bunx cre workflow simulate ./shieldyield-workflow --target=staging-settings --trigger-index 0 --non-interactive`.quiet();
        output = proc.stdout.toString() + proc.stderr.toString();
        log("CRON", "Simulation completed.", C.cyan);
    } catch (err: any) {
        // Even on "error" exit code, the output still has useful data (CRE exits non-zero sometimes)
        output = (err?.stdout?.toString() || "") + (err?.stderr?.toString() || "");
        if (!output.includes("batchUpdateRiskScores")) {
            log("CRON", `Simulation failed with no useful output: ${err?.message}`, C.red);
            return;
        }
        log("CRON", "Simulation exited with error but produced output — parsing scores anyway.", C.yellow);
    }

    // Parse risk scores from CRE output
    const scores = parseRiskScores(output);
    if (scores.length === 0) {
        log("CRON", "No risk scores found in simulation output — skipping write.", C.yellow);
        return;
    }

    log("CRON", `Parsed ${scores.length} risk scores: ${scores.map(s => `${s.name}=${s.score}`).join(", ")}`, C.dim);

    // Write directly to RiskRegistry via viem
    await writeRiskScores(scores);
}

// ─────────────────────────────────────────────────
// ENTRY POINT
// ─────────────────────────────────────────────────

async function main() {
    console.log(`\n${C.cyan}${"═".repeat(60)}${C.r}`);
    console.log(`${C.bold}${C.cyan}  ShieldYield — CRE Simulation Daemon${C.r}`);
    console.log(`${C.dim}  CRE computes scores · Daemon writes to chain via viem${C.r}`);
    console.log(`${C.cyan}${"═".repeat(60)}${C.r}\n`);

    log("DAEMON", `Wallet: ${account.address}`, C.dim);
    log("DAEMON", `RiskRegistry: ${addresses.riskRegistry}`, C.dim);
    log("DAEMON", `Cron interval: ${CRON_MS / 1000}s`, C.dim);

    // Sequential loop — each cycle waits for the previous to fully complete
    while (true) {
        await runCycle();
        log("DAEMON", `Sleeping ${CRON_MS / 1000}s...`, C.dim);
        await Bun.sleep(CRON_MS);
    }
}

main().catch(err => {
    console.error("[DAEMON] Fatal error:", err);
    process.exit(1);
});
