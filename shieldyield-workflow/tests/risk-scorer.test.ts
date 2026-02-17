/**
 * ShieldYield Risk Scorer — Unit Tests
 *
 * Run with: npx tsx tests/risk-scorer.test.ts
 *
 * Tests the computeRiskScore logic in isolation with mock data
 * for 3 scenarios: Safe, Emerging Risk, and Critical Threat.
 */

import { computeRiskScore, getThreatLevelLabel, computeAllRiskScores } from "../monitors/risk-scorer";
import type {
    AdapterSnapshot,
    ProtocolRiskSnapshot,
    OffchainSignals,
    TvlSignal,
    GithubSignal,
    SecuritySignal,
    TeamWalletSignal,
} from "../monitors/types";

// =============================================
// MOCK DATA FACTORIES
// =============================================

function makeHealthyAdapter(name = "TestAdapter"): AdapterSnapshot {
    return {
        name,
        address: "0x1234567890abcdef1234567890abcdef12345678",
        balance: 1000000n,   // 1M units
        apy: 500n,           // 5% APY (normal)
        isHealthy: true,
        principal: 900000n,
        accruedYield: 100000n,
    };
}

function makeUnhealthyAdapter(name = "RiskyAdapter"): AdapterSnapshot {
    return {
        name,
        address: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
        balance: 0n,         // Balance gone!
        apy: 0n,             // APY crashed
        isHealthy: false,    // Adapter unhealthy
        principal: 500000n,  // Had principal → balance gone = exploit?
        accruedYield: 0n,
    };
}

function makeSafeOffchain(): OffchainSignals {
    return {
        prices: { ethUsd: 2500, btcUsd: 45000, usdcUsd: 1.0 },
        tvl: { currentTvl: 5_000_000_000, tvlChangePercent: 2.5 },
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

function makeEmergingRiskOffchain(): OffchainSignals {
    return {
        prices: { ethUsd: 2500, btcUsd: 45000, usdcUsd: 1.0 },
        tvl: { currentTvl: 3_000_000_000, tvlChangePercent: -8 },
        github: { recentCommits: 0, openIssues: 12, lastPushDaysAgo: 20 },
        security: {
            isHoneypot: false,
            isOpenSource: true,
            isProxy: true,       // Proxy detected
            ownerCanChangeBalance: false,
            isMintable: false,
        },
        teamWallet: { balanceEth: 2, recentLargeOutflows: true },
    };
}

function makeCriticalOffchain(): OffchainSignals {
    return {
        prices: { ethUsd: 2500, btcUsd: 45000, usdcUsd: 1.0 },
        tvl: { currentTvl: 500_000, tvlChangePercent: -35 },
        github: { recentCommits: 0, openIssues: 100, lastPushDaysAgo: 90 },
        security: {
            isHoneypot: true,     // HONEYPOT!
            isOpenSource: false,
            isProxy: true,
            ownerCanChangeBalance: true,
            isMintable: true,
        },
        teamWallet: { balanceEth: 0.001, recentLargeOutflows: true },
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
        console.error(`  ❌ FAIL: ${message}`);
    } else {
        passCount++;
        console.log(`  ✅ PASS: ${message}`);
    }
}

// =============================================
// TESTS
// =============================================

function runTests() {
    console.log("\n🧪 ShieldYield Risk Scorer — Unit Tests\n");
    console.log("=".repeat(55));

    // ---- Scenario A: Bullish/Safe Protocol ----
    console.log("\n📗 Scenario A: Bullish/Safe Protocol");
    console.log("   Healthy adapter + stable TVL + active GitHub + clean security");
    const safeScore = computeRiskScore(
        makeHealthyAdapter(), undefined, makeSafeOffchain()
    );
    console.log(`   → Computed Score: ${safeScore}`);
    assert(safeScore <= 25, `Safe score should be ≤ 25, got ${safeScore}`);
    assert(
        getThreatLevelLabel(safeScore) === "SAFE",
        `Threat level should be SAFE, got ${getThreatLevelLabel(safeScore)}`
    );

    // ---- Scenario B: Emerging Risk ----
    console.log("\n📙 Scenario B: Emerging Risk");
    console.log("   Healthy adapter but GitHub silent + proxy + team outflows");
    const emergingScore = computeRiskScore(
        makeHealthyAdapter(), undefined, makeEmergingRiskOffchain()
    );
    console.log(`   → Computed Score: ${emergingScore}`);
    assert(emergingScore > 5, `Emerging risk should be > 5, got ${emergingScore}`);
    assert(emergingScore <= 50, `Emerging risk should be ≤ 50, got ${emergingScore}`);

    // ---- Scenario C: Critical Threat ----
    console.log("\n📕 Scenario C: Critical Threat");
    console.log("   Unhealthy adapter + honeypot + TVL crash + abandoned GitHub");
    const criticalScore = computeRiskScore(
        makeUnhealthyAdapter(), undefined, makeCriticalOffchain()
    );
    console.log(`   → Computed Score: ${criticalScore}`);
    assert(criticalScore >= 76, `Critical score should be ≥ 76, got ${criticalScore}`);
    assert(
        getThreatLevelLabel(criticalScore) === "CRITICAL",
        `Threat level should be CRITICAL, got ${getThreatLevelLabel(criticalScore)}`
    );

    // ---- Edge Case: Score capped at 100 ----
    console.log("\n🔧 Edge Case: Score bounds");
    assert(criticalScore <= 100, `Score should never exceed 100, got ${criticalScore}`);
    const zeroScore = computeRiskScore(
        makeHealthyAdapter(), undefined, makeSafeOffchain()
    );
    assert(zeroScore >= 0, `Score should never be negative, got ${zeroScore}`);

    // ---- Threat Level Label boundaries ----
    console.log("\n🏷️ Threat Level Label Boundaries");
    assert(getThreatLevelLabel(0) === "SAFE", "0 → SAFE");
    assert(getThreatLevelLabel(25) === "SAFE", "25 → SAFE");
    assert(getThreatLevelLabel(26) === "WATCH", "26 → WATCH");
    assert(getThreatLevelLabel(50) === "WATCH", "50 → WATCH");
    assert(getThreatLevelLabel(51) === "WARNING", "51 → WARNING");
    assert(getThreatLevelLabel(75) === "WARNING", "75 → WARNING");
    assert(getThreatLevelLabel(76) === "CRITICAL", "76 → CRITICAL");
    assert(getThreatLevelLabel(100) === "CRITICAL", "100 → CRITICAL");

    // ---- computeAllRiskScores integration ----
    console.log("\n📊 computeAllRiskScores Integration");
    const adapters = [
        makeHealthyAdapter("SafeAdapter"),
        makeUnhealthyAdapter("DangerAdapter"),
    ];
    const allScores = computeAllRiskScores(adapters, [], makeSafeOffchain());
    assert("SafeAdapter" in allScores, "Should have SafeAdapter in results");
    assert("DangerAdapter" in allScores, "Should have DangerAdapter in results");
    assert(
        allScores.SafeAdapter.score < allScores.DangerAdapter.score,
        `Safe (${allScores.SafeAdapter.score}) should score lower than Danger (${allScores.DangerAdapter.score})`
    );

    // ---- Summary ----
    console.log("\n" + "=".repeat(55));
    console.log(`\n📋 Results: ${passCount}/${testCount} passed, ${failCount} failed\n`);

    if (failCount > 0) {
        console.log("💥 SOME TESTS FAILED!");
        process.exit(1);
    } else {
        console.log("🎉 All tests passed!");
    }
}

runTests();
