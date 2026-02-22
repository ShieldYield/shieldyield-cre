import type { AdapterSnapshot, OffchainSignals } from "./types";

// ========================================
// TYPES
// ========================================

export type AnomalySeverity = "WATCH" | "WARNING" | "CRITICAL";

export type AnomalyType =
    | "TVL_DROP"
    | "BANK_RUN"
    | "HONEYPOT"
    | "TEAM_EXIT"
    | "BALANCE_DRAIN"
    | "APY_SPIKE"
    | "HIGH_UTILIZATION"
    | "LIQUIDITY_CRUNCH";

export interface Anomaly {
    type: AnomalyType;
    severity: AnomalySeverity;
    adapter: string;
    message: string;
}

// ========================================
// ANOMALY DETECTION
// ========================================

/**
 * Detect anomalies for a single adapter based on on-chain + off-chain signals.
 */
export function detectAnomalies(
    adapter: AdapterSnapshot,
    offchain: OffchainSignals
): Anomaly[] {
    const anomalies: Anomaly[] = [];

    // --- TVL Drop Detection (historical TVL velocity) ---
    const tvlChange = offchain.tvl.tvlChangePercent;
    if (tvlChange < -20) {
        anomalies.push({
            type: "BANK_RUN",
            severity: "CRITICAL",
            adapter: adapter.name,
            message: `TVL dropped ${tvlChange.toFixed(1)}% — possible bank run`,
        });
    } else if (tvlChange < -10) {
        anomalies.push({
            type: "TVL_DROP",
            severity: "WARNING",
            adapter: adapter.name,
            message: `TVL dropped ${tvlChange.toFixed(1)}% — significant outflow`,
        });
    }

    // --- Honeypot Detected (CRITICAL) ---
    if (offchain.security.isHoneypot) {
        anomalies.push({
            type: "HONEYPOT",
            severity: "CRITICAL",
            adapter: adapter.name,
            message: "GoPlus flagged token as honeypot",
        });
    }

    // --- Team Exit: GitHub silent + large admin outflows (CRITICAL) ---
    if (
        offchain.github.lastPushDaysAgo > 30 &&
        offchain.teamWallet.recentLargeOutflows
    ) {
        anomalies.push({
            type: "TEAM_EXIT",
            severity: "CRITICAL",
            adapter: adapter.name,
            message: `No GitHub activity for ${offchain.github.lastPushDaysAgo}d + large admin outflows detected`,
        });
    }

    // --- Balance Drain: Had principal but balance is zero (CRITICAL) ---
    if (adapter.principal > 0n && adapter.balance === 0n) {
        anomalies.push({
            type: "BALANCE_DRAIN",
            severity: "CRITICAL",
            adapter: adapter.name,
            message: "Balance is 0 but principal exists — possible exploit",
        });
    }

    // --- APY Spike: Suspiciously high APY (WARNING) ---
    if (adapter.apy > 5000n) {
        anomalies.push({
            type: "APY_SPIKE",
            severity: "WARNING",
            adapter: adapter.name,
            message: `APY is ${adapter.apy} bps — suspiciously high`,
        });
    }

    // --- DeFi Utilization Detection (Phase 2 metrics) ---
    const util = adapter.name.includes("Aave")
        ? offchain.defiMetrics?.aave?.utilization
        : adapter.name.includes("Compound")
            ? offchain.defiMetrics?.compound?.utilization
            : undefined;

    // Liquidity Crunch: Utilization > 95% (CRITICAL)
    if (util !== undefined && util > 95) {
        anomalies.push({
            type: "LIQUIDITY_CRUNCH",
            severity: "CRITICAL",
            adapter: adapter.name,
            message: `Protocol utilization at ${util.toFixed(1)}% — liquidity crunch imminent`,
        });
        // High Utilization: > 85% (WARNING)
    } else if (util !== undefined && util > 85) {
        anomalies.push({
            type: "HIGH_UTILIZATION",
            severity: "WARNING",
            adapter: adapter.name,
            message: `Protocol utilization at ${util.toFixed(1)}% — withdrawals may be delayed`,
        });
    }

    return anomalies;
}

/**
 * Detect anomalies for all adapters and return a flat list.
 */
export function detectAllAnomalies(
    adapters: AdapterSnapshot[],
    offchain: OffchainSignals
): Anomaly[] {
    const allAnomalies: Anomaly[] = [];

    for (const adapter of adapters) {
        const anomalies = detectAnomalies(adapter, offchain);
        allAnomalies.push(...anomalies);
    }

    return allAnomalies;
}

/**
 * Get the highest severity from a list of anomalies.
 * Returns null if no anomalies.
 */
export function getHighestSeverity(
    anomalies: Anomaly[]
): AnomalySeverity | null {
    if (anomalies.length === 0) return null;

    const severityOrder: AnomalySeverity[] = ["WATCH", "WARNING", "CRITICAL"];
    let highest = 0;

    for (const anomaly of anomalies) {
        const idx = severityOrder.indexOf(anomaly.severity);
        if (idx > highest) highest = idx;
    }

    return severityOrder[highest];
}
