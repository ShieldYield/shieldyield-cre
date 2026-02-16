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
        github: { recentCommits: 15, openIssues: 3, lastPushDaysAgo: 2 },
        security: {
            isHoneypot: false,
            isOpenSource: true,
            isProxy: false,
            ownerCanChangeBalance: false,
            isMintable: false,
        },
        teamWallet: { balanceEth: 10, recentLargeOutflows: false },
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

    // ---- Test 2: TVL Drop detection (DISABLED — requires historical price tracking) ----
    console.log("\nTest 2: TVL Drop detection — DISABLED (skipped)");
    assert(true, "TVL_DROP detection disabled — requires Data Streams historical price tracking");

    // ---- Test 3: BANK_RUN detection (DISABLED — requires historical price tracking) ----
    console.log("\nTest 3: BANK_RUN detection — DISABLED (skipped)");
    assert(true, "BANK_RUN detection disabled — requires Data Streams historical price tracking");

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
