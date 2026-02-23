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

function makeEmergingRiskOffchain(): OffchainSignals {
    return {
        prices: { ethUsd: 2500, btcUsd: 45000, usdcUsd: 1.0 },
        tvl: { currentTvl: 3_000_000_000, tvlChangePercent: -8 },
        defiMetrics: { aave: null, compound: null },
        github: { recentCommits: 0, openIssues: 12, lastPushDaysAgo: 20 },
        security: {
            isHoneypot: false,
            isOpenSource: true,
            isProxy: true,       // Proxy detected
            ownerCanChangeBalance: false,
            isMintable: false,
        },
        teamWallet: { balanceEth: 2, recentLargeOutflows: true },
        aiSentinel: null,
    };
}

function makeCriticalOffchain(): OffchainSignals {
    return {
        prices: { ethUsd: 2500, btcUsd: 45000, usdcUsd: 1.0 },
        tvl: { currentTvl: 500_000, tvlChangePercent: -35 },
        defiMetrics: { aave: null, compound: null },
        github: { recentCommits: 0, openIssues: 100, lastPushDaysAgo: 90 },
        security: {
            isHoneypot: true,     // HONEYPOT!
            isOpenSource: false,
            isProxy: true,
            ownerCanChangeBalance: true,
            isMintable: true,
        },
        teamWallet: { balanceEth: 0.001, recentLargeOutflows: true },
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

    // ---- Scenario D: Overleveraged Protocol (DeFi Metrics) ----
    console.log("\n📙 Scenario D: Overleveraged AAVE Protocol");
    console.log("   Healthy adapter but AAVE utilization at 96%");
    const overleveragedOffchain = makeSafeOffchain();
    overleveragedOffchain.defiMetrics = {
        aave: {
            totalSupplied: "50000000",
            totalBorrowed: "48000000",
            supplyApy: 8.5,
            borrowApy: 12.3,
            utilization: 96,
        },
        compound: null,
    };
    const overleveragedScore = computeRiskScore(
        makeHealthyAdapter("AaveAdapter"), undefined, overleveragedOffchain
    );
    console.log(`   → Computed Score: ${overleveragedScore}`);
    assert(overleveragedScore > 0, `Overleveraged Aave should have score > 0, got ${overleveragedScore}`);
    assert(overleveragedScore >= 5, `Overleveraged Aave (96% util) should get +5 penalty, got ${overleveragedScore}`);

    // Verify Morpho adapter is NOT penalized by AAVE utilization
    const morphoScore = computeRiskScore(
        makeHealthyAdapter("MorphoAdapter"), undefined, overleveragedOffchain
    );
    assert(morphoScore === 0, `MorphoAdapter should NOT be penalized by AAVE util, got ${morphoScore}`);

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

    // ---- Scenario E: AI Sentinel with high confidence ----
    console.log("\n🤖 Scenario E: AI Sentinel — High threat + high confidence");
    console.log("   Healthy adapter + AI threat_score=80, confidence=0.9");
    const aiHighOffchain = makeSafeOffchain();
    aiHighOffchain.aiSentinel = {
        ai_threat_score: 80,
        confidence: 0.9,
        reasoning: "Multiple security concerns detected",
        recommendation: "REDUCE",
        signals: [{ source: "news", signal: "Exploit reported", sentiment: "negative" }],
    };
    const aiHighScore = computeRiskScore(
        makeHealthyAdapter(), undefined, aiHighOffchain
    );
    console.log(`   → Computed Score: ${aiHighScore}`);
    // AI contributes: round((80/100) * 20 * 0.9) = round(14.4) = 14
    assert(aiHighScore >= 14, `AI high threat should add ≥14 to score, got ${aiHighScore}`);
    assert(aiHighScore <= 25, `Safe adapter + AI only should be ≤25 (SAFE), got ${aiHighScore}`);

    // ---- Scenario F: AI Sentinel with low confidence ----
    console.log("\n🤖 Scenario F: AI Sentinel — High threat + low confidence");
    console.log("   Healthy adapter + AI threat_score=90, confidence=0.3");
    const aiLowConfOffchain = makeSafeOffchain();
    aiLowConfOffchain.aiSentinel = {
        ai_threat_score: 90,
        confidence: 0.3,
        reasoning: "Insufficient data for confident analysis",
        recommendation: "HOLD",
        signals: [],
    };
    const aiLowConfScore = computeRiskScore(
        makeHealthyAdapter(), undefined, aiLowConfOffchain
    );
    console.log(`   → Computed Score: ${aiLowConfScore}`);
    // AI contributes: round((90/100) * 20 * 0.3) = round(5.4) = 5
    assert(aiLowConfScore <= 10, `Low confidence AI should have limited impact, got ${aiLowConfScore}`);

    // ---- Scenario G: AI Safety Guardrail ----
    console.log("\n🤖 Scenario G: AI Safety Guardrail — AI alone cannot trigger CRITICAL");
    console.log("   Healthy adapter + moderate off-chain risk + AI threat=100, confidence=1.0");
    const aiGuardrailOffchain = makeEmergingRiskOffchain();
    aiGuardrailOffchain.aiSentinel = {
        ai_threat_score: 100,
        confidence: 1.0,
        reasoning: "Critical threat detected by AI",
        recommendation: "EXIT",
        signals: [],
    };
    const aiGuardrailScore = computeRiskScore(
        makeHealthyAdapter(), undefined, aiGuardrailOffchain
    );
    console.log(`   → Computed Score: ${aiGuardrailScore}`);
    assert(aiGuardrailScore <= 75, `AI alone should NOT push healthy adapter to CRITICAL (≤75), got ${aiGuardrailScore}`);
    assert(
        getThreatLevelLabel(aiGuardrailScore) !== "CRITICAL",
        `Threat level should NOT be CRITICAL when only AI flags risk, got ${getThreatLevelLabel(aiGuardrailScore)}`
    );

    // ---- Scenario H: AI + On-chain damage = CRITICAL allowed ----
    console.log("\n🤖 Scenario H: AI + On-chain damage = CRITICAL allowed");
    console.log("   Unhealthy adapter + AI threat=100, confidence=1.0");
    const aiWithDamageOffchain = makeCriticalOffchain();
    aiWithDamageOffchain.aiSentinel = {
        ai_threat_score: 100,
        confidence: 1.0,
        reasoning: "Critical threat corroborated by on-chain damage",
        recommendation: "EXIT",
        signals: [],
    };
    const aiWithDamageScore = computeRiskScore(
        makeUnhealthyAdapter(), undefined, aiWithDamageOffchain
    );
    console.log(`   → Computed Score: ${aiWithDamageScore}`);
    assert(aiWithDamageScore >= 76, `AI + on-chain damage should allow CRITICAL (≥76), got ${aiWithDamageScore}`);
    assert(
        getThreatLevelLabel(aiWithDamageScore) === "CRITICAL",
        `Threat level should be CRITICAL with AI + on-chain damage, got ${getThreatLevelLabel(aiWithDamageScore)}`
    );

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
