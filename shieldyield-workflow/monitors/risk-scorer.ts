import type {
    AdapterSnapshot,
    ProtocolRiskSnapshot,
    OffchainSignals,
} from "./types";

/**
 * Menghitung composite risk score (0-100) berdasarkan sinyal on-chain dan off-chain.
 *
 * Bobot (rebalanced for real APIs):
 * - isHealthy:             25% — Adapter tidak sehat → +25 risk
 * - APY anomaly:           10% — APY = 0 atau terlalu tinggi → +10
 * - Balance drop:          10% — Balance = 0 padahal ada principal → +10
 * - TVL velocity:          15% — DeFiLlama TVL drop → +15
 * - Security flags:        15% — GoPlus honeypot/proxy/mint → +15
 * - GitHub inactivity:     10% — Tidak ada commit >30 hari → +10
 * - Audit (open source):    5% — GoPlus is_open_source → +5
 * - Admin wallet outflow:   5% — Etherscan large outflows → +5
 * - Reserve:                5% — Future signals → +5
 */
export function computeRiskScore(
    adapter: AdapterSnapshot,
    currentRisk: ProtocolRiskSnapshot | undefined,
    offchain: OffchainSignals
): number {
    let score = 0;

    // =============================================
    // ON-CHAIN SIGNALS (45%)
    // =============================================

    // 1. Health check (25%)
    if (!adapter.isHealthy) {
        score += 25;
    }

    // 2. APY anomaly (10%)
    if (adapter.apy === 0n) {
        score += 10;
    } else if (adapter.apy > 5000n) {
        score += 7; // Suspiciously high APY
    }

    // 3. Balance anomaly (10%)
    if (adapter.principal > 0n && adapter.balance === 0n) {
        score += 10; // Had principal but balance is gone → possible exploit
    }

    // =============================================
    // OFF-CHAIN SIGNALS (55%)
    // =============================================

    // 4. TVL velocity (15%) — historical TVL change from proxy
    const tvlChange = offchain.tvl.tvlChangePercent;
    if (tvlChange < -20) {
        score += 15; // Severe drop → full weight
    } else if (tvlChange < -10) {
        score += 10; // Significant drop
    } else if (tvlChange < -5) {
        score += 5;  // Moderate drop
    }

    // 5. Security flags — GoPlus (15%)
    if (offchain.security.isHoneypot) {
        score += 15; // Instant CRITICAL
    } else {
        if (offchain.security.ownerCanChangeBalance) score += 8;
        if (offchain.security.isProxy && !offchain.security.isOpenSource) score += 5;
        if (offchain.security.isMintable) score += 4;
    }

    // 6. GitHub inactivity (10%)
    if (offchain.github.lastPushDaysAgo > 60) {
        score += 10; // Team likely abandoned
    } else if (offchain.github.lastPushDaysAgo > 30) {
        score += 7;
    } else if (offchain.github.lastPushDaysAgo > 14) {
        score += 4;
    }

    // 7. Open source status — from GoPlus (5%)
    if (!offchain.security.isOpenSource) {
        score += 5; // Not open source = can't verify code
    }

    // 8. Admin wallet — Etherscan (5%)
    if (offchain.teamWallet.recentLargeOutflows) {
        score += 5;
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
