/**
 * ============================================================================
 * ShieldYield — CRE Workflow Full Lifecycle Simulation
 * ============================================================================
 *
 * Simulates the entire ShieldYield workflow WITHOUT connecting to any chain.
 * Uses mock data to demonstrate:
 *   1. User Deposit → Funds split across adapters
 *   2. Sentinel Scan → Risk scores computed (all SAFE)
 *   3. Yield Accrual → 24h passes, interest accumulates
 *   4. Threat Emerges → YieldMax score rises to WARNING
 *   5. Shield Execute → Partial withdraw triggered
 *   6. Threat Escalates → Score rises to CRITICAL
 *   7. Emergency Withdraw → Full evacuation to Safe Haven
 *   8. CCIP Bridge → Cross-chain escape (optional extreme scenario)
 *
 * Run: npx ts-node simulate.ts   OR   bun run simulate.ts
 * ============================================================================
 */

// ============================================================================
// UTILITIES
// ============================================================================

const COLORS = {
    reset: "\x1b[0m",
    bright: "\x1b[1m",
    dim: "\x1b[2m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    blue: "\x1b[34m",
    magenta: "\x1b[35m",
    cyan: "\x1b[36m",
    white: "\x1b[37m",
    bgRed: "\x1b[41m",
    bgGreen: "\x1b[42m",
    bgYellow: "\x1b[43m",
    bgBlue: "\x1b[44m",
};

function log(msg: string) {
    console.log(msg);
}

function header(title: string) {
    log("");
    log(`${COLORS.cyan}${"═".repeat(70)}${COLORS.reset}`);
    log(`${COLORS.bright}${COLORS.cyan}  ${title}${COLORS.reset}`);
    log(`${COLORS.cyan}${"═".repeat(70)}${COLORS.reset}`);
}

function step(num: number, title: string) {
    log("");
    log(`${COLORS.bright}${COLORS.yellow}  ▶ STEP ${num}: ${title}${COLORS.reset}`);
    log(`${COLORS.dim}  ${"─".repeat(60)}${COLORS.reset}`);
}

function info(label: string, value: string) {
    log(`    ${COLORS.dim}${label}:${COLORS.reset} ${value}`);
}

function success(msg: string) {
    log(`    ${COLORS.green}✅ ${msg}${COLORS.reset}`);
}

function warn(msg: string) {
    log(`    ${COLORS.yellow}⚠️  ${msg}${COLORS.reset}`);
}

function critical(msg: string) {
    log(`    ${COLORS.red}🚨 ${msg}${COLORS.reset}`);
}

function money(label: string, amount: number) {
    log(`    ${COLORS.dim}${label}:${COLORS.reset} ${COLORS.green}$${amount.toLocaleString("en-US", { minimumFractionDigits: 6 })}${COLORS.reset}`);
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// MOCK DATA
// ============================================================================

interface MockAdapter {
    name: string;
    address: string;
    balance: number;    // USDC (6 decimals in real, but we use float here)
    apy: number;        // Annual Percentage Yield in %
    riskScore: number;  // 0-100
    threatLevel: string;
    isHealthy: boolean;
    allocation: number; // percentage of total
}

const ADAPTERS: MockAdapter[] = [
    {
        name: "AaveAdapter",
        address: "0xB81961aA49d7E834404e299e688B3Dc09a5EFe5a",
        balance: 0,
        apy: 2.85,
        riskScore: 15,
        threatLevel: "SAFE",
        isHealthy: true,
        allocation: 35,
    },
    {
        name: "CompoundAdapter",
        address: "0xcc547a2B0f18b34095623809977D54cfe306BEBF",
        balance: 0,
        apy: 3.12,
        riskScore: 20,
        threatLevel: "SAFE",
        isHealthy: true,
        allocation: 30,
    },
    {
        name: "MorphoAdapter",
        address: "0x5f8A64Bc67f23b8d5d02c7CFE187AD42D59f1D59",
        balance: 0,
        apy: 4.50,
        riskScore: 25,
        threatLevel: "SAFE",
        isHealthy: true,
        allocation: 20,
    },
    {
        name: "YieldMaxAdapter",
        address: "0x5EbD6F3DA76C2B9C9d6aAC89DA08c388EaB2B3cb",
        balance: 0,
        apy: 12.00,
        riskScore: 35,
        threatLevel: "SAFE",
        isHealthy: true,
        allocation: 15,
    },
];

const SAFE_HAVEN = "AaveAdapter";
const SHIELD_VAULT = "0xcFBd47c63D284A8F824e586596Df4d5c57326c8B";
const SHIELD_BRIDGE = "0xA5D0CF3DC85538FfC93EF8941819e2b1b0460387";

// ============================================================================
// SIMULATION ENGINE
// ============================================================================

function getThreatLevel(score: number): string {
    if (score <= 30) return "SAFE";
    if (score <= 50) return "WATCH";
    if (score <= 70) return "WARNING";
    return "CRITICAL";
}

function getThreatColor(level: string): string {
    switch (level) {
        case "SAFE": return COLORS.green;
        case "WATCH": return COLORS.yellow;
        case "WARNING": return `${COLORS.bgYellow}${COLORS.bright}`;
        case "CRITICAL": return `${COLORS.bgRed}${COLORS.bright}`;
        default: return COLORS.white;
    }
}

function printAdapterTable(adapters: MockAdapter[]) {
    log("");
    log(`    ${COLORS.dim}┌──────────────────┬──────────────┬────────┬────────┬──────────────┬────────┐${COLORS.reset}`);
    log(`    ${COLORS.dim}│${COLORS.reset} ${COLORS.bright}Adapter${COLORS.reset}          ${COLORS.dim}│${COLORS.reset} ${COLORS.bright}Balance${COLORS.reset}       ${COLORS.dim}│${COLORS.reset} ${COLORS.bright}APY${COLORS.reset}    ${COLORS.dim}│${COLORS.reset} ${COLORS.bright}Alloc${COLORS.reset}  ${COLORS.dim}│${COLORS.reset} ${COLORS.bright}Risk${COLORS.reset}          ${COLORS.dim}│${COLORS.reset} ${COLORS.bright}Health${COLORS.reset} ${COLORS.dim}│${COLORS.reset}`);
    log(`    ${COLORS.dim}├──────────────────┼──────────────┼────────┼────────┼──────────────┼────────┤${COLORS.reset}`);

    for (const a of adapters) {
        const nameStr = a.name.replace("Adapter", "").padEnd(16);
        const balStr = `$${a.balance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.padStart(12);
        const apyStr = `${a.apy.toFixed(2)}%`.padStart(6);
        const allocStr = `${a.allocation.toFixed(1)}%`.padStart(6);
        const riskColor = getThreatColor(a.threatLevel);
        const riskStr = `${riskColor} ${a.threatLevel.padEnd(8)} ${a.riskScore}${COLORS.reset}`.padEnd(24);
        const healthStr = a.isHealthy ? `${COLORS.green}  ●${COLORS.reset}   ` : `${COLORS.red}  ✗${COLORS.reset}   `;

        log(`    ${COLORS.dim}│${COLORS.reset} ${nameStr} ${COLORS.dim}│${COLORS.reset} ${balStr} ${COLORS.dim}│${COLORS.reset} ${apyStr} ${COLORS.dim}│${COLORS.reset} ${allocStr} ${COLORS.dim}│${COLORS.reset} ${riskStr} ${COLORS.dim}│${COLORS.reset}${healthStr}${COLORS.dim}│${COLORS.reset}`);
    }

    log(`    ${COLORS.dim}└──────────────────┴──────────────┴────────┴────────┴──────────────┴────────┘${COLORS.reset}`);

    const total = adapters.reduce((s, a) => s + a.balance, 0);
    money("Total Value", total);
}

// ============================================================================
// MAIN SIMULATION
// ============================================================================

async function simulate() {
    header("🛡️  ShieldYield — CRE Workflow Full Lifecycle Simulation");
    log(`${COLORS.dim}  Simulating the entire automated risk management pipeline.${COLORS.reset}`);
    log(`${COLORS.dim}  No blockchain connection required.${COLORS.reset}`);

    const depositAmount = 10_000;

    // ========================================
    // STEP 1: USER DEPOSIT
    // ========================================
    step(1, "USER DEPOSIT → ShieldVault");
    info("User Wallet", "0xb62329fc70e2d15f6e676E65C0916166b395c296");
    info("Deposit Amount", `$${depositAmount.toLocaleString()} USDC`);
    info("ShieldVault", SHIELD_VAULT);

    await sleep(800);

    // Distribute funds according to allocation %
    for (const adapter of ADAPTERS) {
        adapter.balance = depositAmount * (adapter.allocation / 100);
    }

    success(`Deposit of $${depositAmount.toLocaleString()} USDC received`);
    log(`    ${COLORS.dim}ShieldVault auto-distributes to ${ADAPTERS.length} adapters:${COLORS.reset}`);

    printAdapterTable(ADAPTERS);

    await sleep(1000);

    // ========================================
    // STEP 2: SENTINEL SCAN (WF 1+2)
    // ========================================
    step(2, "SENTINEL SCAN — Workflow 1+2 (Cron Trigger)");
    info("Trigger", "Cron every 30 seconds (staging)");
    info("Phase 1", "Reading on-chain adapter data...");
    await sleep(500);

    for (const a of ADAPTERS) {
        log(`    📡 ${a.name}: balance=${a.balance.toFixed(2)}, apy=${a.apy}%, healthy=${a.isHealthy}`);
    }

    info("Phase 2", "Fetching Chainlink Price Feeds...");
    await sleep(300);
    log("    📈 ETH/USD: $2,541.87 | BTC/USD: $61,240.50 | USDC/USD: $1.000012");

    info("Phase 3", "Fetching Off-chain Signals (AI Sentinel, GoPlus, GitHub)...");
    await sleep(300);
    log("    🤖 AI Sentinel: No critical news detected for Aave, Compound, Morpho");
    log("    🔍 GoPlus: Token security — no malicious flags");
    log("    📊 DeFi Metrics: AAVE supplyAPY=2.85% | Compound supplyAPR=3.12%");

    info("Phase 4", "Computing Risk Scores...");
    await sleep(300);

    for (const a of ADAPTERS) {
        const color = getThreatColor(a.threatLevel);
        log(`    ${a.name}: score=${a.riskScore}/100, level=${color}${a.threatLevel}${COLORS.reset}`);
    }

    info("Anomaly Detection", "0 anomalies detected");
    success("All protocols SAFE — no on-chain risk update needed");

    await sleep(1000);

    // ========================================
    // STEP 3: YIELD ACCRUAL (24h passes)
    // ========================================
    step(3, "TIME PASSES — 24 Hours of Yield Accrual");
    info("Simulating", "24 hours of compound interest...");
    await sleep(500);

    for (const a of ADAPTERS) {
        const dailyYield = a.balance * (a.apy / 100) / 365;
        const oldBal = a.balance;
        a.balance += dailyYield;
        log(`    ${a.name}: $${oldBal.toFixed(6)} → $${a.balance.toFixed(6)} (+$${dailyYield.toFixed(6)})`);
    }

    const totalAfterYield = ADAPTERS.reduce((s, a) => s + a.balance, 0);
    const yieldEarned = totalAfterYield - depositAmount;
    success(`24h yield earned: $${yieldEarned.toFixed(6)}`);
    money("New Total Value", totalAfterYield);

    await sleep(1000);

    // ========================================
    // STEP 4: THREAT EMERGES (WARNING)
    // ========================================
    step(4, "⚠️  THREAT DETECTED — YieldMaxAdapter");
    info("Source", "AI Sentinel detected suspicious activity on YieldMax protocol");
    log(`    ${COLORS.yellow}📰 CryptoPanic: "YieldMax protocol reports unauthorized access to admin keys"${COLORS.reset}`);
    log(`    ${COLORS.yellow}📰 GoPlus: Token risk flag raised — possible honeypot${COLORS.reset}`);

    await sleep(500);

    // Update YieldMax risk
    const yieldMax = ADAPTERS.find((a) => a.name === "YieldMaxAdapter")!;
    yieldMax.riskScore = 65;
    yieldMax.threatLevel = getThreatLevel(yieldMax.riskScore);

    info("Risk Score Update", `YieldMaxAdapter: 35 → ${COLORS.yellow}${COLORS.bright}65/100 (WARNING)${COLORS.reset}`);
    warn("RiskScoreUpdated event emitted on-chain to RiskRegistry");

    printAdapterTable(ADAPTERS);

    await sleep(1000);

    // ========================================
    // STEP 5: SHIELD EXECUTE — WARNING PROTOCOL
    // ========================================
    step(5, "🛡️  SHIELD EXECUTE — Workflow 4 (WARNING Protocol)");
    info("Trigger", "RiskScoreUpdated event (LogTrigger)");
    info("Action", "Partial Withdraw (30% from YieldMaxAdapter)");

    await sleep(500);

    const warningWithdrawPercent = 30;
    const withdrawAmount = yieldMax.balance * (warningWithdrawPercent / 100);
    yieldMax.balance -= withdrawAmount;

    // Move withdrawn funds to safe haven (Aave)
    const safeHaven = ADAPTERS.find((a) => a.name === SAFE_HAVEN)!;
    safeHaven.balance += withdrawAmount;

    log(`    ${COLORS.magenta}📤 Withdrawing ${warningWithdrawPercent}% from YieldMaxAdapter: -$${withdrawAmount.toFixed(6)}${COLORS.reset}`);
    log(`    ${COLORS.green}📥 Moving to Safe Haven (${SAFE_HAVEN}): +$${withdrawAmount.toFixed(6)}${COLORS.reset}`);

    success(`Partial withdraw executed. Funds secured in ${SAFE_HAVEN}.`);

    // Recalculate allocations
    const totalAfterPartial = ADAPTERS.reduce((s, a) => s + a.balance, 0);
    for (const a of ADAPTERS) {
        a.allocation = (a.balance / totalAfterPartial) * 100;
    }

    printAdapterTable(ADAPTERS);

    await sleep(1000);

    // ========================================
    // STEP 6: THREAT ESCALATES (CRITICAL)
    // ========================================
    step(6, "🚨 THREAT ESCALATION — YieldMaxAdapter → CRITICAL");
    log(`    ${COLORS.red}${COLORS.bright}📰 BREAKING: "YieldMax protocol hacked! $15M drained from liquidity pool"${COLORS.reset}`);
    log(`    ${COLORS.red}📰 AI Sentinel LLM Analysis: SEVERITY=CRITICAL, CONFIDENCE=95%${COLORS.reset}`);

    await sleep(500);

    yieldMax.riskScore = 92;
    yieldMax.threatLevel = getThreatLevel(yieldMax.riskScore);
    yieldMax.isHealthy = false;

    info("Risk Score Update", `YieldMaxAdapter: 65 → ${COLORS.bgRed}${COLORS.bright} 92/100 (CRITICAL) ${COLORS.reset}`);
    critical("RiskScoreUpdated event emitted — CRITICAL LEVEL");

    await sleep(1000);

    // ========================================
    // STEP 7: EMERGENCY WITHDRAW
    // ========================================
    step(7, "🛡️  SHIELD EXECUTE — Workflow 4 (CRITICAL Protocol)");
    info("Trigger", "RiskScoreUpdated event (CRITICAL)");
    info("Action", "EMERGENCY WITHDRAW — Full evacuation from YieldMaxAdapter");

    await sleep(500);

    const emergencyAmount = yieldMax.balance;
    yieldMax.balance = 0;
    safeHaven.balance += emergencyAmount;

    log(`    ${COLORS.red}📤 EMERGENCY: Withdrawing ALL from YieldMaxAdapter: -$${emergencyAmount.toFixed(6)}${COLORS.reset}`);
    log(`    ${COLORS.green}📥 Moving to Safe Haven (${SAFE_HAVEN}): +$${emergencyAmount.toFixed(6)}${COLORS.reset}`);

    success("Emergency withdrawal complete! All YieldMax funds rescued.");

    // Recalculate allocations
    const totalAfterEmergency = ADAPTERS.reduce((s, a) => s + a.balance, 0);
    for (const a of ADAPTERS) {
        a.allocation = a.balance > 0 ? (a.balance / totalAfterEmergency) * 100 : 0;
    }

    printAdapterTable(ADAPTERS);

    await sleep(1000);

    // ========================================
    // STEP 8: CCIP BRIDGE (EXTREME SCENARIO)
    // ========================================
    step(8, "🌉 CCIP BRIDGE — Cross-Chain Escape (Extreme Scenario)");
    log(`    ${COLORS.red}${COLORS.bright}⚡ SCENARIO: Arbitrum network instability detected!${COLORS.reset}`);
    info("Decision", "AI triggers cross-chain evacuation to Base Sepolia");
    info("ShieldBridge", SHIELD_BRIDGE);

    await sleep(500);

    const bridgeAmount = totalAfterEmergency;
    info("Token", "USDC (0xaf88...5831)");
    info("Amount", `$${bridgeAmount.toFixed(6)} USDC`);
    info("Source", "Arbitrum Sepolia");
    info("Destination", "Base Sepolia (selector: 10344971235874465080)");
    info("CCIP Fee", "~0.015 ETH (estimated)");

    await sleep(300);

    log(`    ${COLORS.magenta}📡 Encoding emergencyBridge() calldata...${COLORS.reset}`);
    log(`    ${COLORS.magenta}📡 Sending via CRE writeReport to ShieldBridge...${COLORS.reset}`);
    await sleep(500);
    log(`    ${COLORS.cyan}🔗 CCIP Message ID: 0x7a3f...b2c1${COLORS.reset}`);
    log(`    ${COLORS.cyan}🔗 Track: https://ccip.chain.link/msg/0x7a3f...b2c1${COLORS.reset}`);

    success("Cross-chain bridge initiated! Funds en route to Base Sepolia.");

    await sleep(500);
    log(`    ${COLORS.green}📥 Funds arrived on Base Sepolia${COLORS.reset}`);
    log(`    ${COLORS.green}📥 Auto-deposited into Safe Haven (Aave on Base)${COLORS.reset}`);
    success("Cross-chain evacuation complete! User funds are SAFE.");

    // ========================================
    // FINAL SUMMARY
    // ========================================
    header("📊  SIMULATION SUMMARY");

    const finalTotal = ADAPTERS.reduce((s, a) => s + a.balance, 0);
    const totalYieldEarned = finalTotal - depositAmount;

    info("Initial Deposit", `$${depositAmount.toLocaleString()} USDC`);
    info("Final Value (pre-bridge)", `$${finalTotal.toFixed(6)} USDC`);
    info("Total Yield Earned", `$${totalYieldEarned.toFixed(6)} (${((totalYieldEarned / depositAmount) * 100).toFixed(4)}%)`);
    info("Funds Lost to Hack", `$0.000000 (ZERO — all rescued by AI)`);
    log("");

    log(`    ${COLORS.bright}Workflow Actions Executed:${COLORS.reset}`);
    log(`    ${COLORS.dim}  1. ${COLORS.green}✅${COLORS.reset} ${COLORS.dim}Sentinel Scan (WF 1+2) — Risk assessed, all SAFE${COLORS.reset}`);
    log(`    ${COLORS.dim}  2. ${COLORS.green}✅${COLORS.reset} ${COLORS.dim}24h yield accrured — +$${yieldEarned.toFixed(6)}${COLORS.reset}`);
    log(`    ${COLORS.dim}  3. ${COLORS.yellow}⚠️${COLORS.reset}  ${COLORS.dim}WARNING detected — Partial withdraw 30% from YieldMax${COLORS.reset}`);
    log(`    ${COLORS.dim}  4. ${COLORS.red}🚨${COLORS.reset} ${COLORS.dim}CRITICAL detected — Emergency withdraw ALL from YieldMax${COLORS.reset}`);
    log(`    ${COLORS.dim}  5. ${COLORS.cyan}🌉${COLORS.reset} ${COLORS.dim}CCIP Bridge — Funds evacuated to Base Sepolia${COLORS.reset}`);
    log("");

    log(`    ${COLORS.bright}${COLORS.green}╔══════════════════════════════════════════════════════╗${COLORS.reset}`);
    log(`    ${COLORS.bright}${COLORS.green}║  ShieldYield protected $${depositAmount.toLocaleString()} with ZERO LOSS    ║${COLORS.reset}`);
    log(`    ${COLORS.bright}${COLORS.green}║  AI detected & reacted before user even noticed.    ║${COLORS.reset}`);
    log(`    ${COLORS.bright}${COLORS.green}╚══════════════════════════════════════════════════════╝${COLORS.reset}`);

    log("");
    log(`${COLORS.dim}  Simulation complete. Total time: simulated 24+ hours in seconds.${COLORS.reset}`);
    log("");

    // JSON output for programmatic use
    const result = {
        simulation: "ShieldYield CRE Workflow Lifecycle",
        deposit: depositAmount,
        finalValue: finalTotal,
        yieldEarned: totalYieldEarned,
        fundsLost: 0,
        workflowsExecuted: [
            "SENTINEL_SCAN",
            "YIELD_ACCRUAL",
            "WARNING_PARTIAL_WITHDRAW",
            "CRITICAL_EMERGENCY_WITHDRAW",
            "CCIP_CROSS_CHAIN_BRIDGE",
        ],
        adapters: ADAPTERS.map((a) => ({
            name: a.name,
            finalBalance: a.balance,
            riskScore: a.riskScore,
            threatLevel: a.threatLevel,
        })),
    };

    log(`${COLORS.dim}  JSON Output:${COLORS.reset}`);
    log(JSON.stringify(result, null, 2));
}

// ============================================================================
// RUN
// ============================================================================

simulate().catch(console.error);
