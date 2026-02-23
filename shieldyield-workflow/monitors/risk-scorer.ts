import type {
    AdapterSnapshot,
    ProtocolRiskSnapshot,
    OffchainSignals,
} from "./types";

/**
 * Menghitung composite risk score (0-100) berdasarkan sinyal on-chain dan off-chain.
 *
 * Bobot (rebalanced with AI Sentinel):
 * - isHealthy:             20% — Adapter tidak sehat → +20 risk
 * - APY anomaly:           10% — APY = 0 atau terlalu tinggi → +10
 * - Balance drop:          10% — Balance = 0 padahal ada principal → +10
 * - TVL velocity:          12% — DeFiLlama TVL drop → +12
 * - Security flags:        13% — GoPlus honeypot/proxy/mint → +13
 * - GitHub inactivity:      5% — Tidak ada commit >30 hari → +5
 * - Audit (open source):    5% — GoPlus is_open_source → +5
 * - Admin wallet outflow:   5% — Etherscan large outflows → +5
 * - DeFi utilization:       5% — High protocol utilization → +5
 * - AI Sentinel:           20% — GroqAI threat analysis → +20 (scaled by confidence)
 *
 * Safety guardrail: AI alone CANNOT trigger CRITICAL (≥76).
 * If only AI pushes score above 75 while all on-chain signals are clean,
 * the score is capped at 75 (WARNING max).
 */
export function computeRiskScore(
    adapter: AdapterSnapshot,
    currentRisk: ProtocolRiskSnapshot | undefined,
    offchain: OffchainSignals
): number {
    let score = 0;
    let onChainDamage = false; // Track if on-chain signals indicate real damage

    // =============================================
    // ON-CHAIN SIGNALS (40%)
    // =============================================

    // 1. Health check (20%)
    if (!adapter.isHealthy) {
        score += 20;
        onChainDamage = true;
    }

    // 2. APY anomaly (10%)
    if (adapter.apy === 0n) {
        score += 10;
        onChainDamage = true;
    } else if (adapter.apy > 5000n) {
        score += 7; // Suspiciously high APY
        onChainDamage = true;
    }

    // 3. Balance anomaly (10%)
    if (adapter.principal > 0n && adapter.balance === 0n) {
        score += 10; // Had principal but balance is gone → possible exploit
        onChainDamage = true;
    }

    // =============================================
    // OFF-CHAIN SIGNALS (60%)
    // =============================================

    // 4. TVL velocity (12%) — historical TVL change from proxy
    const tvlChange = offchain.tvl.tvlChangePercent;
    if (tvlChange < -20) {
        score += 12; // Severe drop → full weight
    } else if (tvlChange < -10) {
        score += 8;  // Significant drop
    } else if (tvlChange < -5) {
        score += 4;  // Moderate drop
    }

    // 5. Security flags — GoPlus (13%)
    if (offchain.security.isHoneypot) {
        score += 13; // Instant high risk
    } else {
        if (offchain.security.ownerCanChangeBalance) score += 7;
        if (offchain.security.isProxy && !offchain.security.isOpenSource) score += 4;
        if (offchain.security.isMintable) score += 3;
    }

    // 6. GitHub inactivity (5%)
    if (offchain.github.lastPushDaysAgo > 60) {
        score += 5; // Team likely abandoned
    } else if (offchain.github.lastPushDaysAgo > 30) {
        score += 3;
    } else if (offchain.github.lastPushDaysAgo > 14) {
        score += 2;
    }

    // 7. Open source status — from GoPlus (5%)
    if (!offchain.security.isOpenSource) {
        score += 5; // Not open source = can't verify code
    }

    // 8. Admin wallet — Etherscan (5%)
    if (offchain.teamWallet.recentLargeOutflows) {
        score += 5;
    }

    // 9. DeFi Protocol Utilization (5%) — Phase 2 metrics
    const metrics = offchain.defiMetrics;
    if (metrics) {
        const util = adapter.name.includes("Aave")
            ? metrics.aave?.utilization
            : adapter.name.includes("Compound")
                ? metrics.compound?.utilization
                : undefined;

        if (util !== undefined) {
            if (util > 95) score += 5;       // Near-full → max penalty
            else if (util > 85) score += 3;  // Elevated risk
            else if (util > 75) score += 1;  // Early warning
        }
    }

    // 10. AI Sentinel score (20% weight) — scaled by confidence
    if (offchain.aiSentinel) {
        const aiScore = offchain.aiSentinel.ai_threat_score;
        const confidence = offchain.aiSentinel.confidence;
        // Scale: (aiScore / 100) * maxWeight * confidence
        const weightedAiScore = Math.round((aiScore / 100) * 20 * confidence);
        score += weightedAiScore;
    }

    // Safety guardrail: AI alone cannot push to CRITICAL without on-chain corroboration
    if (score >= 76 && !onChainDamage) {
        // Check if non-AI score would be below CRITICAL
        const scoreWithoutAi = offchain.aiSentinel
            ? score - Math.round((offchain.aiSentinel.ai_threat_score / 100) * 20 * offchain.aiSentinel.confidence)
            : score;
        if (scoreWithoutAi < 76) {
            score = 75; // Cap at WARNING max
        }
    }

    return Math.min(100, Math.max(0, score));
}

/**
 * Convert risk score ke threat level label
 */
export function getThreatLevelLabel(score: number): string {
    if (score <= 25) return "SAFE";
    if (score <= 50) return "WATCH";
    if (score <= 75) return "WARNING";
    return "CRITICAL";
}

/**
 * Compute risk scores untuk semua adapters sekaligus
 */
export function computeAllRiskScores(
    adapters: AdapterSnapshot[],
    risks: ProtocolRiskSnapshot[],
    offchain: OffchainSignals
): Record<string, { score: number; level: string }> {
    const result: Record<string, { score: number; level: string }> = {};

    for (const adapter of adapters) {
        const currentRisk = risks.find((r) => r.address === adapter.address);
        const score = computeRiskScore(adapter, currentRisk, offchain);
        result[adapter.name] = {
            score,
            level: getThreatLevelLabel(score),
        };
    }

    return result;
}
