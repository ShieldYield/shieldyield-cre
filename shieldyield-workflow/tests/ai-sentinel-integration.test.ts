/**
 * ShieldYield AI Sentinel — Integration Test
 *
 * Run with: npx tsx tests/ai-sentinel-integration.test.ts
 *
 * Simulates the FULL pipeline:
 *   AI Sentinel response → risk scoring → anomaly detection → threat level
 *
 * Tests 5 scenarios:
 *   1. SAFE:     AI says protocol is healthy
 *   2. WATCH:    AI detects minor concerns
 *   3. WARNING:  AI detects high threat (but adapter healthy → capped)
 *   4. CRITICAL: AI + on-chain damage (guardrail allows CRITICAL)
 *   5. LOW CONFIDENCE: AI says critical but confidence too low → minimal impact
 */

import { computeRiskScore, getThreatLevelLabel, computeAllRiskScores } from "../monitors/risk-scorer";
import { detectAnomalies, detectAllAnomalies, getHighestSeverity } from "../monitors/anomaly-detector";
import type {
    AdapterSnapshot,
    OffchainSignals,
    AiSentinelSignal,
} from "../monitors/types";

// =============================================
// TEST FRAMEWORK
// =============================================

let testCount = 0;
let passCount = 0;
let failCount = 0;
const sections: { name: string; tests: { pass: boolean; msg: string }[] }[] = [];
let currentSection: { name: string; tests: { pass: boolean; msg: string }[] } | null = null;

function section(name: string) {
    currentSection = { name, tests: [] };
    sections.push(currentSection);
    console.log(`\n${"━".repeat(60)}`);
    console.log(`  ${name}`);
    console.log(`${"━".repeat(60)}`);
}

function assert(condition: boolean, message: string) {
    testCount++;
    const pass = !!condition;
    if (pass) {
        passCount++;
        console.log(`  ✅ ${message}`);
    } else {
        failCount++;
        console.error(`  ❌ ${message}`);
    }
    currentSection?.tests.push({ pass, msg: message });
}

function logScore(score: number, level: string) {
    const bar = "█".repeat(Math.round(score / 2)) + "░".repeat(50 - Math.round(score / 2));
    const color = level === "SAFE" ? "\x1b[32m" : level === "WATCH" ? "\x1b[33m" : level === "WARNING" ? "\x1b[38;5;208m" : "\x1b[31m";
    console.log(`  ${color}${bar}\x1b[0m ${score}/100 → ${level}`);
}

// =============================================
// MOCK FACTORIES
// =============================================

function makeAdapter(overrides: Partial<AdapterSnapshot> = {}): AdapterSnapshot {
    return {
        name: "AaveAdapter",
        address: "0xB81961aA49d7E834404e299e688B3Dc09a5EFe5a",
        balance: 1_000_000n,
        apy: 500n,
        isHealthy: true,
        principal: 900_000n,
        accruedYield: 100_000n,
        ...overrides,
    };
}

function makeOffchain(aiSentinel: AiSentinelSignal | null, overrides: Partial<OffchainSignals> = {}): OffchainSignals {
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
        aiSentinel,
        ...overrides,
    };
}

/** Simulates what AI Sentinel endpoint would return */
function makeAiResponse(
    score: number,
    confidence: number,
    recommendation: string,
    reasoning: string,
    signals: AiSentinelSignal["signals"] = []
): AiSentinelSignal {
    return {
        ai_threat_score: score,
        confidence,
        recommendation,
        reasoning,
        signals,
    };
}

// =============================================
// SIMULATION: Full pipeline
// =============================================

interface SimulationResult {
    adapter: AdapterSnapshot;
    offchain: OffchainSignals;
    riskScore: number;
    threatLevel: string;
    anomalies: ReturnType<typeof detectAnomalies>;
    highestSeverity: ReturnType<typeof getHighestSeverity>;
    aiContribution: number;
}

function simulate(adapter: AdapterSnapshot, offchain: OffchainSignals): SimulationResult {
    // Step 1: Compute risk score (same as CRE risk-scorer.ts)
    const riskScore = computeRiskScore(adapter, undefined, offchain);
    const threatLevel = getThreatLevelLabel(riskScore);

    // Step 2: Detect anomalies (same as CRE anomaly-detector.ts)
    const anomalies = detectAnomalies(adapter, offchain);
    const highestSeverity = getHighestSeverity(anomalies);

    // Step 3: Calculate AI contribution
    let aiContribution = 0;
    if (offchain.aiSentinel) {
        aiContribution = Math.round(
            (offchain.aiSentinel.ai_threat_score / 100) * 20 * offchain.aiSentinel.confidence
        );
    }

    return { adapter, offchain, riskScore, threatLevel, anomalies, highestSeverity, aiContribution };
}

// =============================================
// TESTS
// =============================================

function runTests() {
    console.log("\n🤖 ShieldYield AI Sentinel — Integration Test");
    console.log("   Full pipeline: AI Response → Risk Score → Anomaly → Threat Level\n");

    // ========================================
    // SCENARIO 1: SAFE — AI says all clear
    // ========================================
    section("SCENARIO 1: SAFE — Protocol is healthy, AI confirms");

    console.log("  Setup:");
    console.log("    Adapter: healthy, balance=1M, APY=5%, isHealthy=true");
    console.log("    AI Sentinel: score=10, confidence=0.9, recommendation=HOLD");
    console.log("    GitHub: active (2 days ago), no security flags");
    console.log("");

    const safeAi = makeAiResponse(10, 0.9, "HOLD",
        "Protocol shows excellent health. Active development with 15 recent commits. No negative news or security concerns detected.",
        [
            { source: "github", signal: "Active development — 15 commits, last push 2d ago", sentiment: "positive" },
            { source: "news", signal: "No security incidents reported in recent news", sentiment: "neutral" },
        ]
    );
    const safeResult = simulate(makeAdapter(), makeOffchain(safeAi));
    logScore(safeResult.riskScore, safeResult.threatLevel);

    assert(safeResult.threatLevel === "SAFE", `Threat level = ${safeResult.threatLevel} (expected SAFE)`);
    assert(safeResult.riskScore <= 25, `Risk score = ${safeResult.riskScore} (expected ≤25)`);
    assert(safeResult.anomalies.length === 0, `Anomalies = ${safeResult.anomalies.length} (expected 0)`);
    assert(safeResult.aiContribution <= 5, `AI contribution = ${safeResult.aiContribution} (expected ≤5 for low threat)`);
    console.log(`  AI reasoning: "${safeAi.reasoning}"`);

    // ========================================
    // SCENARIO 2: WATCH — AI detects minor concerns
    // ========================================
    section("SCENARIO 2: WATCH — AI detects moderate concerns");

    console.log("  Setup:");
    console.log("    Adapter: healthy, normal");
    console.log("    AI Sentinel: score=55, confidence=0.8, recommendation=HOLD");
    console.log("    Off-chain: GitHub inactive 20d, minor TVL dip");
    console.log("");

    const watchAi = makeAiResponse(55, 0.8, "HOLD",
        "Protocol shows some concerning signals. Development has slowed down. Recent news mentions regulatory scrutiny but no direct security threat.",
        [
            { source: "github", signal: "Development slowed — last push 20 days ago", sentiment: "negative" },
            { source: "news", signal: "Regulatory uncertainty mentioned in 2 articles", sentiment: "negative" },
        ]
    );
    const watchOffchain = makeOffchain(watchAi, {
        github: { recentCommits: 2, openIssues: 15, lastPushDaysAgo: 20 },
        tvl: { currentTvl: 4_500_000, tvlChangePercent: -3 },
    });
    const watchResult = simulate(makeAdapter(), watchOffchain);
    logScore(watchResult.riskScore, watchResult.threatLevel);

    assert(watchResult.threatLevel === "WATCH" || watchResult.threatLevel === "SAFE",
        `Threat level = ${watchResult.threatLevel} (expected WATCH or SAFE)`);
    assert(watchResult.riskScore > 5, `Risk score = ${watchResult.riskScore} (expected >5 with concerns)`);
    assert(watchResult.riskScore <= 50, `Risk score = ${watchResult.riskScore} (expected ≤50, not WARNING yet)`);
    assert(!watchResult.anomalies.some(a => a.type === "AI_THREAT_DETECTED"),
        "No AI_THREAT_DETECTED (score 55 < threshold 70)");
    console.log(`  AI reasoning: "${watchAi.reasoning}"`);

    // ========================================
    // SCENARIO 3: WARNING — AI detects high threat
    //   BUT adapter is healthy → safety guardrail caps at 75
    // ========================================
    section("SCENARIO 3: WARNING — AI high threat + healthy adapter (guardrail test)");

    console.log("  Setup:");
    console.log("    Adapter: HEALTHY (isHealthy=true, balance>0, normal APY)");
    console.log("    AI Sentinel: score=95, confidence=0.95, recommendation=EXIT");
    console.log("    Off-chain: GitHub dead 45d, TVL dropping 12%, team outflows");
    console.log("    GUARDRAIL: AI alone cannot push to CRITICAL (≥76)");
    console.log("");

    const warningAi = makeAiResponse(95, 0.95, "EXIT",
        "CRITICAL: Multiple exploit reports detected. Smart contract vulnerability disclosed on security forum. Team wallet showing unusual outflows. Recommend immediate exit.",
        [
            { source: "github", signal: "No commits for 45 days — possible team abandonment", sentiment: "negative" },
            { source: "news", signal: "Exploit vulnerability disclosed on security forum", sentiment: "negative" },
        ]
    );
    const warningOffchain = makeOffchain(warningAi, {
        github: { recentCommits: 0, openIssues: 30, lastPushDaysAgo: 45 },
        tvl: { currentTvl: 3_000_000, tvlChangePercent: -12 },
        teamWallet: { balanceEth: 0.5, recentLargeOutflows: true },
    });
    const warningResult = simulate(makeAdapter(), warningOffchain);
    logScore(warningResult.riskScore, warningResult.threatLevel);

    assert(warningResult.threatLevel !== "CRITICAL",
        `Threat level = ${warningResult.threatLevel} (expected NOT CRITICAL — guardrail active)`);
    assert(warningResult.riskScore <= 75,
        `Risk score = ${warningResult.riskScore} (expected ≤75 — guardrail caps at WARNING)`);
    assert(warningResult.riskScore > 25,
        `Risk score = ${warningResult.riskScore} (expected >25 — significant off-chain risk)`);

    // AI_THREAT_DETECTED anomaly should fire (score=95 > 70, confidence=0.95 > 0.7)
    const aiAnomaly = warningResult.anomalies.find(a => a.type === "AI_THREAT_DETECTED");
    assert(!!aiAnomaly, "AI_THREAT_DETECTED anomaly should fire (score=95, confidence=0.95)");
    assert(aiAnomaly?.severity === "WARNING",
        `AI anomaly severity = ${aiAnomaly?.severity} (expected WARNING, never CRITICAL from AI alone)`);

    // TEAM_EXIT should also fire (GitHub 45d + outflows)
    assert(warningResult.anomalies.some(a => a.type === "TEAM_EXIT"),
        "TEAM_EXIT anomaly should also fire (GitHub 45d + team outflows)");

    console.log(`  AI reasoning: "${warningAi.reasoning}"`);
    console.log(`  Anomalies detected: ${warningResult.anomalies.map(a => `${a.type}(${a.severity})`).join(", ")}`);
    console.log(`  Safety guardrail: ACTIVE — score would be higher but capped at ${warningResult.riskScore}`);

    // ========================================
    // SCENARIO 4: CRITICAL — AI + on-chain damage
    //   Guardrail allows CRITICAL when on-chain signals confirm
    // ========================================
    section("SCENARIO 4: CRITICAL — AI confirms on-chain damage (guardrail allows)");

    console.log("  Setup:");
    console.log("    Adapter: UNHEALTHY (isHealthy=false, balance=0, APY=0)");
    console.log("    AI Sentinel: score=100, confidence=1.0, recommendation=EXIT");
    console.log("    Off-chain: honeypot detected, TVL crashed -35%, GitHub dead");
    console.log("    GUARDRAIL: Allows CRITICAL because on-chain damage confirmed");
    console.log("");

    const criticalAi = makeAiResponse(100, 1.0, "EXIT",
        "EMERGENCY: Protocol has been exploited. All funds drained from smart contract. GoPlus confirms honeypot. Immediate exit required — total loss scenario.",
        [
            { source: "github", signal: "Repository archived — team has abandoned project", sentiment: "negative" },
            { source: "news", signal: "BREAKING: $50M exploit confirmed, all user funds stolen", sentiment: "negative" },
        ]
    );
    const criticalAdapter = makeAdapter({
        isHealthy: false,
        balance: 0n,
        apy: 0n,
        principal: 500_000n,
    });
    const criticalOffchain = makeOffchain(criticalAi, {
        github: { recentCommits: 0, openIssues: 200, lastPushDaysAgo: 90 },
        tvl: { currentTvl: 100_000, tvlChangePercent: -35 },
        security: {
            isHoneypot: true,
            isOpenSource: false,
            isProxy: true,
            ownerCanChangeBalance: true,
            isMintable: true,
        },
        teamWallet: { balanceEth: 0, recentLargeOutflows: true },
    });
    const criticalResult = simulate(criticalAdapter, criticalOffchain);
    logScore(criticalResult.riskScore, criticalResult.threatLevel);

    assert(criticalResult.threatLevel === "CRITICAL",
        `Threat level = ${criticalResult.threatLevel} (expected CRITICAL)`);
    assert(criticalResult.riskScore >= 76,
        `Risk score = ${criticalResult.riskScore} (expected ≥76)`);

    // Multiple anomalies should fire
    assert(criticalResult.anomalies.some(a => a.type === "BANK_RUN"),
        "BANK_RUN anomaly should fire (TVL -35%)");
    assert(criticalResult.anomalies.some(a => a.type === "HONEYPOT"),
        "HONEYPOT anomaly should fire");
    assert(criticalResult.anomalies.some(a => a.type === "BALANCE_DRAIN"),
        "BALANCE_DRAIN anomaly should fire (balance=0, principal>0)");
    assert(criticalResult.anomalies.some(a => a.type === "AI_THREAT_DETECTED"),
        "AI_THREAT_DETECTED anomaly should fire (score=100, confidence=1.0)");
    assert(criticalResult.highestSeverity === "CRITICAL",
        `Highest severity = ${criticalResult.highestSeverity} (expected CRITICAL)`);

    console.log(`  AI reasoning: "${criticalAi.reasoning}"`);
    console.log(`  Anomalies (${criticalResult.anomalies.length}):`);
    for (const a of criticalResult.anomalies) {
        console.log(`    [${a.severity}] ${a.type}: ${a.message}`);
    }

    // ========================================
    // SCENARIO 5: LOW CONFIDENCE — AI uncertain
    //   High threat score but low confidence → minimal impact
    // ========================================
    section("SCENARIO 5: LOW CONFIDENCE — AI says critical but unsure");

    console.log("  Setup:");
    console.log("    Adapter: healthy, normal");
    console.log("    AI Sentinel: score=90, confidence=0.3, recommendation=REDUCE");
    console.log("    Off-chain: everything normal");
    console.log("    Expected: AI has minimal impact due to low confidence");
    console.log("");

    const lowConfAi = makeAiResponse(90, 0.3, "REDUCE",
        "Potential threat detected but insufficient data to confirm. News sources are limited. GitHub data inconclusive. Low confidence in this assessment.",
        [
            { source: "github", signal: "Unable to access repository — data inconclusive", sentiment: "neutral" },
            { source: "news", signal: "Limited news coverage — cannot assess sentiment", sentiment: "neutral" },
        ]
    );
    const lowConfResult = simulate(makeAdapter(), makeOffchain(lowConfAi));
    logScore(lowConfResult.riskScore, lowConfResult.threatLevel);

    assert(lowConfResult.threatLevel === "SAFE",
        `Threat level = ${lowConfResult.threatLevel} (expected SAFE — low confidence means low impact)`);
    assert(lowConfResult.aiContribution <= 6,
        `AI contribution = ${lowConfResult.aiContribution} (expected ≤6 — scaled down by 0.3 confidence)`);
    assert(!lowConfResult.anomalies.some(a => a.type === "AI_THREAT_DETECTED"),
        "No AI_THREAT_DETECTED (confidence 0.3 < threshold 0.7)");

    console.log(`  AI reasoning: "${lowConfAi.reasoning}"`);
    console.log(`  AI contribution to score: only +${lowConfResult.aiContribution} (out of max 20)`);

    // ========================================
    // MULTI-ADAPTER SIMULATION
    // ========================================
    section("BONUS: Multi-adapter portfolio simulation");

    console.log("  Setup: 4 adapters with different AI assessments\n");

    const adapters = [
        makeAdapter({ name: "AaveAdapter" }),
        makeAdapter({ name: "CompoundAdapter" }),
        makeAdapter({ name: "MorphoAdapter", apy: 800n }),
        makeAdapter({ name: "YieldMaxAdapter", isHealthy: false, balance: 0n, principal: 200_000n }),
    ];

    // Shared offchain with AI
    const portfolioAi = makeAiResponse(40, 0.75, "HOLD",
        "Mixed signals across the portfolio. Most protocols healthy but YieldMax shows concerning patterns.",
        [
            { source: "github", signal: "3 of 4 protocols actively developed", sentiment: "positive" },
            { source: "news", signal: "Minor exploit reported on a similar protocol", sentiment: "negative" },
        ]
    );
    const portfolioOffchain = makeOffchain(portfolioAi);

    const allScores = computeAllRiskScores(adapters, [], portfolioOffchain);
    const allAnomalies = detectAllAnomalies(adapters, portfolioOffchain);
    const portfolioSeverity = getHighestSeverity(allAnomalies);

    console.log("  Portfolio Risk Scores:");
    for (const [name, { score, level }] of Object.entries(allScores)) {
        const bar = "█".repeat(Math.round(score / 2)) + "░".repeat(50 - Math.round(score / 2));
        const color = level === "SAFE" ? "\x1b[32m" : level === "WATCH" ? "\x1b[33m" : level === "WARNING" ? "\x1b[38;5;208m" : "\x1b[31m";
        console.log(`    ${name.padEnd(20)} ${color}${bar}\x1b[0m ${score}/100 → ${level}`);
    }

    assert(allScores["AaveAdapter"].level === "SAFE",
        `AaveAdapter = ${allScores["AaveAdapter"].level} (expected SAFE)`);
    assert(allScores["YieldMaxAdapter"].score > allScores["AaveAdapter"].score,
        `YieldMax (${allScores["YieldMaxAdapter"].score}) > Aave (${allScores["AaveAdapter"].score}) — unhealthy adapter scores higher`);

    console.log(`\n  Anomalies: ${allAnomalies.length}`);
    for (const a of allAnomalies) {
        console.log(`    [${a.severity}] ${a.adapter}: ${a.type} — ${a.message}`);
    }
    assert(allAnomalies.some(a => a.adapter === "YieldMaxAdapter" && a.type === "BALANCE_DRAIN"),
        "YieldMaxAdapter should have BALANCE_DRAIN anomaly");
    console.log(`  Portfolio highest severity: ${portfolioSeverity}`);

    // ========================================
    // SUMMARY
    // ========================================
    console.log(`\n${"═".repeat(60)}`);
    console.log("  RESULTS SUMMARY");
    console.log(`${"═".repeat(60)}\n`);

    for (const s of sections) {
        const allPass = s.tests.every(t => t.pass);
        const icon = allPass ? "✅" : "❌";
        console.log(`  ${icon} ${s.name}`);
        if (!allPass) {
            for (const t of s.tests.filter(t => !t.pass)) {
                console.log(`     ❌ ${t.msg}`);
            }
        }
    }

    console.log(`\n  Total: ${passCount}/${testCount} passed, ${failCount} failed\n`);

    if (failCount > 0) {
        console.log("  💥 SOME TESTS FAILED!\n");
        process.exit(1);
    } else {
        console.log("  🎉 All integration tests passed!\n");
    }
}

runTests();
