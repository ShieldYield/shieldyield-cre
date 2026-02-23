/**
 * ShieldYield Anomaly Detector — Unit Tests
 *
 * Run with: npx tsx tests/anomaly.test.ts
 */

import {
    detectAnomalies,
    detectAllAnomalies,
    getHighestSeverity,
} from "../monitors/anomaly-detector";
import type { AdapterSnapshot, OffchainSignals } from "../monitors/types";

// =============================================
// MOCK DATA FACTORIES
// =============================================

function makeHealthyAdapter(name = "TestAdapter"): AdapterSnapshot {
    return {
        name,
        address: "0x1234567890abcdef1234567890abcdef12345678",
        balance: 1000000n,
        apy: 500n, // 5% APY (normal)
        isHealthy: true,
        principal: 900000n,
        accruedYield: 100000n,
    };
}

function makeSafeOffchain(): OffchainSignals {
    return {
        prices: { ethUsd: 2500, btcUsd: 45000, usdcUsd: 1.0 },
        tvl: { currentTvl: 5_000_000, tvlChangePercent: 2.5 },
        defiMetrics: { aave: null, compound: null },
        github: { recentCommits: 15, openIssues: 3, lastPushDaysAgo: 2 },
        security: {
            isHoneypot: false,
            isOpenSource: true,
            isProxy: false,
            ownerCanChangeBalance: false,
            isMintable: false,
        },
        teamWallet: { balanceEth: 10, recentLargeOutflows: false },
        aiSentinel: null,
    };
}

// =============================================
// TEST HELPERS
// =============================================

let testCount = 0;
let passCount = 0;
let failCount = 0;

function assert(condition: boolean, message: string) {
    testCount++;
    if (!condition) {
        failCount++;
        console.error(`  FAIL: ${message}`);
    } else {
        passCount++;
        console.log(`  PASS: ${message}`);
    }
}

// =============================================
// TESTS
// =============================================

function runTests() {
    console.log("\nShieldYield Anomaly Detector — Unit Tests\n");
    console.log("=".repeat(55));

    // ---- Test 1: No anomalies for safe data ----
    console.log("\nTest 1: No anomalies for safe data");
    const safeAnomalies = detectAnomalies(makeHealthyAdapter(), makeSafeOffchain());
    assert(safeAnomalies.length === 0, `Expected 0 anomalies, got ${safeAnomalies.length}`);

    // ---- Test 2: TVL Drop detection ----
    console.log("\nTest 2: TVL Drop detection (>10% drop)");
    const tvlDropOffchain = makeSafeOffchain();
    tvlDropOffchain.tvl = { currentTvl: 4_000_000, tvlChangePercent: -15 };
    const tvlDropAnomalies = detectAnomalies(makeHealthyAdapter(), tvlDropOffchain);
    assert(tvlDropAnomalies.some((a) => a.type === "TVL_DROP"), "Should detect TVL_DROP");
    assert(tvlDropAnomalies.some((a) => a.severity === "WARNING"), "TVL_DROP should be WARNING");

    // ---- Test 3: BANK_RUN detection ----
    console.log("\nTest 3: BANK_RUN detection (>20% drop)");
    const bankRunOffchain = makeSafeOffchain();
    bankRunOffchain.tvl = { currentTvl: 2_000_000, tvlChangePercent: -30 };
    const bankRunAnomalies = detectAnomalies(makeHealthyAdapter(), bankRunOffchain);
    assert(bankRunAnomalies.some((a) => a.type === "BANK_RUN"), "Should detect BANK_RUN");
    assert(bankRunAnomalies.some((a) => a.severity === "CRITICAL"), "BANK_RUN should be CRITICAL");

    // ---- Test 4: Honeypot detected ----
    console.log("\nTest 4: Honeypot detected");
    const honeypotOffchain = makeSafeOffchain();
    honeypotOffchain.security.isHoneypot = true;
    const honeypotAnomalies = detectAnomalies(makeHealthyAdapter(), honeypotOffchain);
    assert(honeypotAnomalies.some((a) => a.type === "HONEYPOT"), "Should detect HONEYPOT");
    assert(honeypotAnomalies.some((a) => a.severity === "CRITICAL"), "HONEYPOT should be CRITICAL");

    // ---- Test 5: Team Exit (GitHub silent + outflows) ----
    console.log("\nTest 5: Team Exit detection");
    const teamExitOffchain = makeSafeOffchain();
    teamExitOffchain.github.lastPushDaysAgo = 45;
    teamExitOffchain.teamWallet.recentLargeOutflows = true;
    const teamExitAnomalies = detectAnomalies(makeHealthyAdapter(), teamExitOffchain);
    assert(teamExitAnomalies.some((a) => a.type === "TEAM_EXIT"), "Should detect TEAM_EXIT");
    assert(teamExitAnomalies.some((a) => a.severity === "CRITICAL"), "TEAM_EXIT should be CRITICAL");

    // ---- Test 6: GitHub silent alone is NOT a team exit ----
    console.log("\nTest 6: GitHub silent alone is not TEAM_EXIT");
    const githubOnlyOffchain = makeSafeOffchain();
    githubOnlyOffchain.github.lastPushDaysAgo = 45;
    const githubOnlyAnomalies = detectAnomalies(makeHealthyAdapter(), githubOnlyOffchain);
    assert(!githubOnlyAnomalies.some((a) => a.type === "TEAM_EXIT"), "Should NOT detect TEAM_EXIT without outflows");

    // ---- Test 7: Balance Drain ----
    console.log("\nTest 7: Balance Drain detection");
    const drainedAdapter: AdapterSnapshot = {
        ...makeHealthyAdapter(),
        balance: 0n,
        principal: 500000n,
    };
    const drainAnomalies = detectAnomalies(drainedAdapter, makeSafeOffchain());
    assert(drainAnomalies.some((a) => a.type === "BALANCE_DRAIN"), "Should detect BALANCE_DRAIN");
    assert(drainAnomalies.some((a) => a.severity === "CRITICAL"), "BALANCE_DRAIN should be CRITICAL");

    // ---- Test 8: APY Spike ----
    console.log("\nTest 8: APY Spike detection");
    const spikeAdapter: AdapterSnapshot = {
        ...makeHealthyAdapter(),
        apy: 10000n, // 100% APY
    };
    const spikeAnomalies = detectAnomalies(spikeAdapter, makeSafeOffchain());
    assert(spikeAnomalies.some((a) => a.type === "APY_SPIKE"), "Should detect APY_SPIKE");
    assert(spikeAnomalies.some((a) => a.severity === "WARNING"), "APY_SPIKE should be WARNING");

    // ---- Test 9: Multiple anomalies at once ----
    console.log("\nTest 9: Multiple anomalies at once");
    const criticalOffchain = makeSafeOffchain();
    criticalOffchain.security.isHoneypot = true;
    criticalOffchain.github.lastPushDaysAgo = 60;
    criticalOffchain.teamWallet.recentLargeOutflows = true;
    const multiAnomalies = detectAnomalies(makeHealthyAdapter(), criticalOffchain);
    assert(multiAnomalies.length >= 2, `Expected >= 2 anomalies (HONEYPOT + TEAM_EXIT), got ${multiAnomalies.length}`);

    // ---- Test 10: detectAllAnomalies works across multiple adapters ----
    console.log("\nTest 10: detectAllAnomalies with multiple adapters");
    const adapters = [makeHealthyAdapter("Safe"), drainedAdapter];
    const allAnomalies = detectAllAnomalies(adapters, makeSafeOffchain());
    assert(allAnomalies.length >= 1, "Should have anomalies from drained adapter");
    assert(allAnomalies.some((a) => a.type === "BALANCE_DRAIN"), "Should contain BALANCE_DRAIN");

    // ---- Test 11: getHighestSeverity ----
    console.log("\nTest 11: getHighestSeverity");
    assert(getHighestSeverity([]) === null, "Empty list → null");
    assert(
        getHighestSeverity([{ type: "TVL_DROP", severity: "WARNING", adapter: "test", message: "test" }]) === "WARNING",
        "Single WARNING → WARNING"
    );
    assert(
        getHighestSeverity([
            { type: "TVL_DROP", severity: "WARNING", adapter: "test", message: "test" },
            { type: "HONEYPOT", severity: "CRITICAL", adapter: "test", message: "test" },
        ]) === "CRITICAL",
        "WARNING + CRITICAL → CRITICAL"
    );
    assert(
        getHighestSeverity([
            { type: "TVL_DROP", severity: "WATCH", adapter: "test", message: "test" },
        ]) === "WATCH",
        "Single WATCH → WATCH"
    );

    // ---- Test 12: HIGH_UTILIZATION detection (90% Aave utilization) ----
    console.log("\nTest 12: HIGH_UTILIZATION detection (AaveAdapter + 90% util)");
    const highUtilOffchain = makeSafeOffchain();
    highUtilOffchain.defiMetrics = {
        aave: {
            totalSupplied: "50000000",
            totalBorrowed: "45000000",
            supplyApy: 7.2,
            borrowApy: 10.1,
            utilization: 90,
        },
        compound: null,
    };
    const highUtilAnomalies = detectAnomalies(
        { ...makeHealthyAdapter("AaveAdapter"), name: "AaveAdapter" },
        highUtilOffchain
    );
    assert(highUtilAnomalies.some((a) => a.type === "HIGH_UTILIZATION"), "Should detect HIGH_UTILIZATION");
    assert(highUtilAnomalies.some((a) => a.severity === "WARNING"), "HIGH_UTILIZATION should be WARNING");

    // ---- Test 13: LIQUIDITY_CRUNCH detection (98% Compound utilization) ----
    console.log("\nTest 13: LIQUIDITY_CRUNCH detection (CompoundAdapter + 98% util)");
    const crunchOffchain = makeSafeOffchain();
    crunchOffchain.defiMetrics = {
        aave: null,
        compound: {
            totalSupply: "80000000",
            totalBorrow: "78400000",
            utilization: 98,
            supplyApr: 15.3,
            borrowApr: 22.7,
        },
    };
    const crunchAnomalies = detectAnomalies(
        { ...makeHealthyAdapter("CompoundAdapter"), name: "CompoundAdapter" },
        crunchOffchain
    );
    assert(crunchAnomalies.some((a) => a.type === "LIQUIDITY_CRUNCH"), "Should detect LIQUIDITY_CRUNCH");
    assert(crunchAnomalies.some((a) => a.severity === "CRITICAL"), "LIQUIDITY_CRUNCH should be CRITICAL");

    // ---- Test 14: AI_THREAT_DETECTED at score > 70 + confidence > 0.7 ----
    console.log("\nTest 14: AI_THREAT_DETECTED (score=85, confidence=0.9)");
    const aiThreatOffchain = makeSafeOffchain();
    aiThreatOffchain.aiSentinel = {
        ai_threat_score: 85,
        confidence: 0.9,
        reasoning: "Critical vulnerability detected in protocol smart contract",
        recommendation: "EXIT",
        signals: [{ source: "news", signal: "Exploit reported", sentiment: "negative" }],
    };
    const aiThreatAnomalies = detectAnomalies(makeHealthyAdapter(), aiThreatOffchain);
    assert(aiThreatAnomalies.some((a) => a.type === "AI_THREAT_DETECTED"), "Should detect AI_THREAT_DETECTED");
    assert(
        aiThreatAnomalies.filter((a) => a.type === "AI_THREAT_DETECTED").every((a) => a.severity === "WARNING"),
        "AI_THREAT_DETECTED severity should be WARNING (never CRITICAL from AI alone)"
    );

    // ---- Test 15: AI threat NOT detected when score < 70 ----
    console.log("\nTest 15: No AI anomaly when score < 70");
    const aiLowOffchain = makeSafeOffchain();
    aiLowOffchain.aiSentinel = {
        ai_threat_score: 50,
        confidence: 0.9,
        reasoning: "Moderate concerns but nothing critical",
        recommendation: "HOLD",
        signals: [],
    };
    const aiLowAnomalies = detectAnomalies(makeHealthyAdapter(), aiLowOffchain);
    assert(!aiLowAnomalies.some((a) => a.type === "AI_THREAT_DETECTED"), "Should NOT detect AI_THREAT_DETECTED at score=50");

    // ---- Test 16: AI threat NOT detected when confidence < 0.7 ----
    console.log("\nTest 16: No AI anomaly when confidence < 0.7");
    const aiLowConfidenceOffchain = makeSafeOffchain();
    aiLowConfidenceOffchain.aiSentinel = {
        ai_threat_score: 90,
        confidence: 0.5,
        reasoning: "High threat but low confidence",
        recommendation: "REDUCE",
        signals: [],
    };
    const aiLowConfAnomalies = detectAnomalies(makeHealthyAdapter(), aiLowConfidenceOffchain);
    assert(!aiLowConfAnomalies.some((a) => a.type === "AI_THREAT_DETECTED"), "Should NOT detect AI_THREAT_DETECTED at confidence=0.5");

    // ---- Test 17: No AI anomaly when aiSentinel is null ----
    console.log("\nTest 17: No AI anomaly when aiSentinel is null");
    const noAiOffchain = makeSafeOffchain();
    const noAiAnomalies = detectAnomalies(makeHealthyAdapter(), noAiOffchain);
    assert(!noAiAnomalies.some((a) => a.type === "AI_THREAT_DETECTED"), "Should NOT detect AI_THREAT_DETECTED when aiSentinel is null");

    // ---- Summary ----
    console.log("\n" + "=".repeat(55));
    console.log(`\nResults: ${passCount}/${testCount} passed, ${failCount} failed\n`);

    if (failCount > 0) {
        console.log("SOME TESTS FAILED!");
        process.exit(1);
    } else {
        console.log("All tests passed!");
    }
}

runTests();
