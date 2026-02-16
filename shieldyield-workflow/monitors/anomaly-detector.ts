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
    | "APY_SPIKE";

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

    // --- TVL Drop Detection: DISABLED (Data Streams integration in progress) ---
    // TODO: Implement TVL change calculation using historical balance * price data
    // For now, TVL_DROP and BANK_RUN anomalies are disabled

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
