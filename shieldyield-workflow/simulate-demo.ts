/**
 * ============================================================================
 * ShieldYield — LIVE DEMO SIMULATION
 * ============================================================================
 *
 * Run this script in a terminal while the Next.js frontend is open.
 * The dashboard at localhost:3000 will update in real-time as the simulation
 * progresses through each workflow step.
 *
 * How it works:
 *   1. This script writes JSON state to /tmp/shieldyield-simulation.json
 *   2. /api/portfolio/live checks for that file on each poll
 *   3. If found, API returns simulation data instead of blockchain data
 *   4. Frontend polls every 10s and picks up changes naturally
 *
 * Usage:
 *   npx tsx simulate-demo.ts
 *   npx tsx simulate-demo.ts --fast     (shorter delays for quick testing)
 *
 * ============================================================================
 */

import * as fs from "fs";
import * as path from "path";

// ============================================================================
// CONFIGURATION
// ============================================================================

const STATE_FILE = "/tmp/shieldyield-simulation.json";
const isFast = process.argv.includes("--fast");

// Delays between steps (milliseconds)
const DELAY = {
    step: isFast ? 5_000 : 15_000,      // Between major steps
    substep: isFast ? 2_000 : 8_000,     // Between sub-steps within a step
    micro: isFast ? 1_000 : 3_000,       // Small pauses for realism
};

// ============================================================================
// COLORS
// ============================================================================

const C = {
    reset: "\x1b[0m",
    bright: "\x1b[1m",
    dim: "\x1b[2m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    cyan: "\x1b[36m",
    magenta: "\x1b[35m",
    bgRed: "\x1b[41m",
    bgYellow: "\x1b[43m",
};

function log(msg: string) { console.log(msg); }
function header(title: string) {
    log(`\n${C.cyan}${"═".repeat(70)}${C.reset}`);
    log(`${C.bright}${C.cyan}  ${title}${C.reset}`);
    log(`${C.cyan}${"═".repeat(70)}${C.reset}`);
}
function stepLog(num: number, title: string) {
    log(`\n${C.bright}${C.yellow}  ▶ STEP ${num}: ${title}${C.reset}`);
    log(`${C.dim}  ${"─".repeat(60)}${C.reset}`);
}
function info(label: string, value: string) {
    log(`    ${C.dim}${label}:${C.reset} ${value}`);
}
function ok(msg: string) { log(`    ${C.green}✅ ${msg}${C.reset}`); }
function warning(msg: string) { log(`    ${C.yellow}⚠️  ${msg}${C.reset}`); }
function danger(msg: string) { log(`    ${C.red}🚨 ${msg}${C.reset}`); }

function countdown(seconds: number, label: string): Promise<void> {
    return new Promise<void>((resolve) => {
        let remaining = seconds;
        const interval = setInterval(() => {
            process.stdout.write(`\r    ${C.dim}⏳ ${label}: ${remaining}s${C.reset}   `);
            remaining--;
            if (remaining < 0) {
                clearInterval(interval);
                process.stdout.write("\r" + " ".repeat(60) + "\r");
                resolve();
            }
        }, 1000);
    });
}

// ============================================================================
// STATE MANAGEMENT
// ============================================================================

interface SimAdapter {
    address: string;
    balance: number;
    apy: number;
    isHealthy: boolean;
    principal: number;
    accruedYield: number;
    allocation: number;
    changePercent: number;
    changeDirection: "up" | "down" | "neutral";
}

interface SimState {
    active: boolean;
    step: number;
    stepLabel: string;
    totalValueUsd: number;
    totalChangePercent: number;
    totalChangeDirection: "up" | "down" | "neutral";
    adapters: Record<string, SimAdapter>;
    riskScores: Record<string, { score: number; level: string }>;
    lastUpdated: string;
    totalAssets: number;
}

function writeState(state: SimState) {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function clearState() {
    try { fs.unlinkSync(STATE_FILE); } catch { /* file may not exist */ }
}

// ============================================================================
// ADAPTER DEFINITIONS
// ============================================================================

const INITIAL_ADAPTERS: Record<string, SimAdapter> = {
    AaveAdapter: {
        address: "0xB81961aA49d7E834404e299e688B3Dc09a5EFe5a",
        balance: 0, apy: 2.85, isHealthy: true, principal: 0,
        accruedYield: 0, allocation: 0, changePercent: 0, changeDirection: "neutral",
    },
    CompoundAdapter: {
        address: "0xcc547a2B0f18b34095623809977D54cfe306BEBF",
        balance: 0, apy: 3.12, isHealthy: true, principal: 0,
        accruedYield: 0, allocation: 0, changePercent: 0, changeDirection: "neutral",
    },
    MorphoAdapter: {
        address: "0x5f8A64Bc67f23b8d5d02c7CFE187AD42D59f1D59",
        balance: 0, apy: 4.50, isHealthy: true, principal: 0,
        accruedYield: 0, allocation: 0, changePercent: 0, changeDirection: "neutral",
    },
    YieldMaxAdapter: {
        address: "0x5EbD6F3DA76C2B9C9d6aAC89DA08c388EaB2B3cb",
        balance: 0, apy: 12.00, isHealthy: true, principal: 0,
        accruedYield: 0, allocation: 0, changePercent: 0, changeDirection: "neutral",
    },
};

const INITIAL_RISK: Record<string, { score: number; level: string }> = {
    AaveAdapter: { score: 15, level: "SAFE" },
    CompoundAdapter: { score: 20, level: "SAFE" },
    MorphoAdapter: { score: 25, level: "SAFE" },
    YieldMaxAdapter: { score: 35, level: "SAFE" },
};

function recalcAllocations(adapters: Record<string, SimAdapter>) {
    const total = Object.values(adapters).reduce((s, a) => s + a.balance, 0);
    for (const a of Object.values(adapters)) {
        a.allocation = total > 0 ? (a.balance / total) * 100 : 0;
    }
}

function totalValue(adapters: Record<string, SimAdapter>): number {
    return Object.values(adapters).reduce((s, a) => s + a.balance, 0);
}

function buildState(step: number, label: string, adapters: Record<string, SimAdapter>, risk: Record<string, { score: number; level: string }>): SimState {
    const tv = totalValue(adapters);
    return {
        active: true,
        step,
        stepLabel: label,
        totalValueUsd: tv,
        totalChangePercent: 0,
        totalChangeDirection: "neutral",
        adapters: JSON.parse(JSON.stringify(adapters)),
        riskScores: JSON.parse(JSON.stringify(risk)),
        lastUpdated: new Date().toISOString(),
        totalAssets: tv,
    };
}

// ============================================================================
// SIMULATION STEPS
// ============================================================================

async function simulate() {
    header("🛡️  ShieldYield — LIVE DEMO SIMULATION");
    log(`${C.dim}  This script controls the dashboard at localhost:3000 in real-time.${C.reset}`);
    log(`${C.dim}  Mode: ${isFast ? "FAST (short delays)" : "NORMAL (realistic delays)"}${C.reset}`);
    log(`${C.dim}  State file: ${STATE_FILE}${C.reset}`);
    log("");

    const adapters = JSON.parse(JSON.stringify(INITIAL_ADAPTERS)) as Record<string, SimAdapter>;
    const risk = JSON.parse(JSON.stringify(INITIAL_RISK)) as Record<string, { score: number; level: string }>;
    const depositAmount = 10_000;

    // Clean up any previous simulation
    clearState();

    // ── STEP 0: IDLE (empty dashboard)
    stepLog(0, "PREPARING — Dashboard shows empty state");
    info("Action", "Writing initial empty state...");
    writeState(buildState(0, "Preparing...", adapters, risk));
    ok("Dashboard should show 'No adapter data yet'");
    await countdown(DELAY.step / 1000, "Next step: User deposit");

    // ── STEP 1: DEPOSIT
    stepLog(1, "USER DEPOSIT → $10,000 USDC into ShieldVault");
    info("Amount", `$${depositAmount.toLocaleString()} USDC`);
    info("Distribution", "35% Aave | 30% Compound | 20% Morpho | 15% YieldMax");

    adapters.AaveAdapter.balance = 3_500;
    adapters.AaveAdapter.principal = 3_500;
    adapters.CompoundAdapter.balance = 3_000;
    adapters.CompoundAdapter.principal = 3_000;
    adapters.MorphoAdapter.balance = 2_000;
    adapters.MorphoAdapter.principal = 2_000;
    adapters.YieldMaxAdapter.balance = 1_500;
    adapters.YieldMaxAdapter.principal = 1_500;
    recalcAllocations(adapters);

    writeState(buildState(1, "Deposit: $10,000 USDC distributed", adapters, risk));
    ok("Dashboard now shows $10,000 distributed across 4 adapters");
    await countdown(DELAY.step / 1000, "Next step: Sentinel Scan");

    // ── STEP 2: SENTINEL SCAN — ALL SAFE
    stepLog(2, "SENTINEL SCAN — All protocols SAFE");
    info("Workflow", "WF 1+2 (Cron Trigger)");
    info("Result", "All risk scores below threshold");

    writeState(buildState(2, "Sentinel: All SAFE ✅", adapters, risk));
    ok("Dashboard risk badges all GREEN");
    await countdown(DELAY.step / 1000, "Next step: Yield accrual");

    // ── STEP 3: YIELD ACCRUAL (simulate 24h)
    stepLog(3, "YIELD ACCRUAL — 24 hours of interest");

    // Simulate yield in small increments to make it visible
    const yieldSteps = 4;
    for (let i = 1; i <= yieldSteps; i++) {
        const hoursPerStep = 24 / yieldSteps;
        for (const a of Object.values(adapters)) {
            const yieldForPeriod = a.balance * (a.apy / 100) * (hoursPerStep / 8760);
            a.balance += yieldForPeriod;
            a.accruedYield = Math.max(0, a.balance - a.principal);
            a.changeDirection = "up";
            a.changePercent = (a.accruedYield / a.principal) * 100;
        }
        recalcAllocations(adapters);

        info(`${i * (24 / yieldSteps)}h elapsed`, `Total: $${totalValue(adapters).toFixed(6)}`);
        writeState(buildState(3, `Yielding: ${i * (24 / yieldSteps)}h elapsed...`, adapters, risk));
        await countdown(DELAY.substep / 1000, `Accruing yield (${i}/${yieldSteps})`);
    }

    ok(`24h yield complete: +$${(totalValue(adapters) - depositAmount).toFixed(6)}`);

    // ── STEP 4: THREAT DETECTED — WARNING
    stepLog(4, "⚠️  THREAT DETECTED — YieldMaxAdapter");
    log(`    ${C.yellow}📰 "YieldMax protocol reports unauthorized admin key access"${C.reset}`);

    await new Promise((r) => setTimeout(r, DELAY.micro));

    risk.YieldMaxAdapter = { score: 65, level: "WARNING" };
    writeState(buildState(4, "⚠️ WARNING: YieldMax risk score 65/100", adapters, risk));
    warning("YieldMax risk badge turns YELLOW on dashboard");
    await countdown(DELAY.step / 1000, "Next step: Shield Execute (WARNING)");

    // ── STEP 5: PARTIAL WITHDRAW (30%)
    stepLog(5, "🛡️  SHIELD: Partial Withdraw 30% from YieldMax");
    info("Action", "executeWarningProtocol → partialWithdraw(30%)");

    const withdrawAmt = adapters.YieldMaxAdapter.balance * 0.30;
    adapters.YieldMaxAdapter.balance -= withdrawAmt;
    adapters.YieldMaxAdapter.changeDirection = "down";
    adapters.YieldMaxAdapter.changePercent = 30;
    adapters.AaveAdapter.balance += withdrawAmt;
    adapters.AaveAdapter.changeDirection = "up";
    adapters.AaveAdapter.accruedYield = Math.max(0, adapters.AaveAdapter.balance - adapters.AaveAdapter.principal);
    adapters.YieldMaxAdapter.accruedYield = Math.max(0, adapters.YieldMaxAdapter.balance - adapters.YieldMaxAdapter.principal);
    recalcAllocations(adapters);

    writeState(buildState(5, "🛡️ Partial withdraw: 30% from YieldMax → Aave", adapters, risk));
    ok(`$${withdrawAmt.toFixed(2)} moved from YieldMax to Safe Haven (Aave)`);
    await countdown(DELAY.step / 1000, "Next step: Threat escalation");

    // ── STEP 6: CRITICAL
    stepLog(6, "🚨 THREAT ESCALATION — YieldMax → CRITICAL");
    log(`    ${C.red}${C.bright}📰 BREAKING: "YieldMax hacked! $15M drained from liquidity pool"${C.reset}`);

    await new Promise((r) => setTimeout(r, DELAY.micro));

    risk.YieldMaxAdapter = { score: 92, level: "CRITICAL" };
    adapters.YieldMaxAdapter.isHealthy = false;
    writeState(buildState(6, "🚨 CRITICAL: YieldMax score 92/100 — HACKED", adapters, risk));
    danger("YieldMax risk badge turns RED on dashboard");
    await countdown(DELAY.step / 1000, "Next step: Emergency Withdraw");

    // ── STEP 7: EMERGENCY WITHDRAW
    stepLog(7, "🛡️  SHIELD: Emergency Withdraw — ALL from YieldMax");
    info("Action", "executeCriticalProtocol → emergencyWithdraw()");

    const emergencyAmt = adapters.YieldMaxAdapter.balance;
    adapters.YieldMaxAdapter.balance = 0;
    adapters.YieldMaxAdapter.allocation = 0;
    adapters.YieldMaxAdapter.accruedYield = 0;
    adapters.YieldMaxAdapter.changeDirection = "down";
    adapters.YieldMaxAdapter.changePercent = 100;
    adapters.AaveAdapter.balance += emergencyAmt;
    adapters.AaveAdapter.accruedYield = Math.max(0, adapters.AaveAdapter.balance - adapters.AaveAdapter.principal);
    adapters.AaveAdapter.changeDirection = "up";
    recalcAllocations(adapters);

    writeState(buildState(7, "🛡️ Emergency: ALL YieldMax → Aave Safe Haven", adapters, risk));
    ok(`$${emergencyAmt.toFixed(2)} rescued from YieldMax → Safe Haven`);
    ok(`YieldMax balance: $0.00 | Aave balance: $${adapters.AaveAdapter.balance.toFixed(2)}`);
    await countdown(DELAY.step / 1000, "Next step: CCIP Bridge");

    // ── STEP 8: CCIP BRIDGE
    stepLog(8, "🌉 CCIP BRIDGE — Cross-chain Escape to Base");
    log(`    ${C.red}${C.bright}⚡ Arbitrum network instability detected!${C.reset}`);
    info("Action", "executeCriticalBridgeProtocol → emergencyBridge()");
    info("Destination", "Base Sepolia via Chainlink CCIP");

    writeState(buildState(8, "🌉 CCIP: Evacuating all funds to Base Sepolia...", adapters, risk));
    await countdown(DELAY.substep / 1000, "Bridging in progress");

    // After bridge, show a "bridged" state
    const bridgedTotal = totalValue(adapters);
    for (const a of Object.values(adapters)) {
        a.balance = 0;
        a.allocation = 0;
        a.accruedYield = 0;
    }

    const finalState = buildState(8, "🌉 CCIP Complete: Funds safe on Base Sepolia", adapters, risk);
    finalState.totalValueUsd = bridgedTotal; // Show total still preserved
    writeState(finalState);

    ok(`$${bridgedTotal.toFixed(2)} evacuated to Base Sepolia — ZERO LOSS`);

    // ── SUMMARY
    header("📊  SIMULATION COMPLETE");
    log(`    ${C.bright}${C.green}╔══════════════════════════════════════════════════════╗${C.reset}`);
    log(`    ${C.bright}${C.green}║  ShieldYield protected $${depositAmount.toLocaleString()} with ZERO LOSS    ║${C.reset}`);
    log(`    ${C.bright}${C.green}║  AI detected & reacted before user even noticed.    ║${C.reset}`);
    log(`    ${C.bright}${C.green}╚══════════════════════════════════════════════════════╝${C.reset}`);
    log("");
    info("Yield earned", `+$${(bridgedTotal - depositAmount).toFixed(6)}`);
    info("Funds lost", "$0.000000 (ZERO)");
    log("");

    // ── CLEANUP
    await countdown(10, "Cleaning up simulation state");
    clearState();
    ok("Simulation state cleared. Dashboard returns to normal blockchain data.");
    log("");
}

// ============================================================================
// CLEANUP ON EXIT
// ============================================================================

process.on("SIGINT", () => {
    log(`\n${C.yellow}  Simulation interrupted! Cleaning up...${C.reset}`);
    clearState();
    log(`${C.green}  State file removed. Dashboard will return to normal.${C.reset}\n`);
    process.exit(0);
});

// ============================================================================
// RUN
// ============================================================================

simulate().catch((err) => {
    console.error("Simulation error:", err);
    clearState();
    process.exit(1);
});
