/**
 * sim-fetcher.ts
 * ─────────────────────────────────────────────────────────────
 * HTTP fetching untuk simulasi daemon.
 * Menggantikan HTTPClient.sendRequest() dari CRE SDK dengan
 * native fetch() yang berjalan secara async.
 *
 * Parsing response sama persis dengan logika di monitors/offchain.ts,
 * tapi tanpa ketergantungan pada Runtime context CRE SDK.
 *
 * File ini TERPISAH dari kode CRE asli (monitors/offchain.ts).
 * ─────────────────────────────────────────────────────────────
 */

import type {
    GithubSignal,
    SecuritySignal,
    TeamWalletSignal,
    AiSentinelSignal,
    TvlSignal,
    DefiMetricsSignal,
} from "../monitors/types";

// ─────────────────────────────────────────────────
// DEFAULT VALUES (sama seperti di offchain.ts)
// ─────────────────────────────────────────────────

const DEFAULT_GITHUB: GithubSignal = {
    recentCommits: 0,
    openIssues: 0,
    lastPushDaysAgo: 999,
};

const DEFAULT_AI: AiSentinelSignal = {
    ai_threat_score: 30,
    confidence: 0.3,
    reasoning: "AI Sentinel unavailable — using default moderate score",
    recommendation: "HOLD",
    signals: [],
};

const DEFAULT_SECURITY: SecuritySignal = {
    isHoneypot: false,
    isOpenSource: true,
    isProxy: false,
    ownerCanChangeBalance: false,
    isMintable: false,
};

const DEFAULT_TEAM_WALLET: TeamWalletSignal = {
    balanceEth: 0,
    recentLargeOutflows: false,
};

// ─────────────────────────────────────────────────
// AI SENTINEL (Next.js proxy: GitHub + GroqAI + CryptoPanic)
// ─────────────────────────────────────────────────

export async function fetchAiSentinelSim(
    url: string,
    protocol: string
): Promise<{ github: GithubSignal; aiSentinel: AiSentinelSignal }> {
    try {
        const resp = await fetch(`${url}?protocol=${protocol}`, {
            headers: { "User-Agent": "ShieldYield-Sim-Daemon" },
            signal: AbortSignal.timeout(15_000),
        });

        if (!resp.ok) return { github: DEFAULT_GITHUB, aiSentinel: DEFAULT_AI };

        const data = await resp.json() as any;

        return {
            github: {
                recentCommits: Number(data.github?.recentCommits) || 0,
                openIssues:    Number(data.github?.openIssues)    || 0,
                lastPushDaysAgo: Number(data.github?.lastPushDaysAgo) || 999,
            },
            aiSentinel: {
                ai_threat_score: Number(data.ai_threat_score) || 30,
                confidence:      Number(data.confidence)      || 0.3,
                reasoning:       String(data.reasoning        || ""),
                recommendation:  String(data.recommendation   || "HOLD"),
                signals: Array.isArray(data.signals)
                    ? data.signals.map((s: any) => ({
                        source:    String(s.source    || ""),
                        signal:    String(s.signal    || ""),
                        sentiment: String(s.sentiment || "neutral"),
                    }))
                    : [],
            },
        };
    } catch {
        return { github: DEFAULT_GITHUB, aiSentinel: DEFAULT_AI };
    }
}

// ─────────────────────────────────────────────────
// GOPLUS (security flags)
// ─────────────────────────────────────────────────

export async function fetchGoPlusSim(url: string): Promise<SecuritySignal> {
    try {
        const resp = await fetch(url, { signal: AbortSignal.timeout(8_000) });

        if (!resp.ok) return DEFAULT_SECURITY;

        const data = await resp.json() as any;

        // GoPlus returns: { result: { "0xAddress": { ...flags } } }
        const results  = data.result || {};
        const firstKey = Object.keys(results)[0];
        const flags    = firstKey ? results[firstKey] : {};

        return {
            isHoneypot:           flags.is_honeypot          === "1",
            isOpenSource:         flags.is_open_source        === "1",
            isProxy:              flags.is_proxy              === "1",
            ownerCanChangeBalance: flags.owner_change_balance === "1",
            isMintable:           flags.is_mintable           === "1",
        };
    } catch {
        return DEFAULT_SECURITY;
    }
}

// ─────────────────────────────────────────────────
// ETHERSCAN (team wallet balance)
// ─────────────────────────────────────────────────

export async function fetchTeamWalletSim(url: string): Promise<TeamWalletSignal> {
    try {
        const resp = await fetch(url, { signal: AbortSignal.timeout(8_000) });

        if (!resp.ok) return DEFAULT_TEAM_WALLET;

        const data      = await resp.json() as any;
        const balanceWei = BigInt(data.result || "0");

        return {
            balanceEth:          Number(balanceWei) / 1e18,
            recentLargeOutflows: false, // membutuhkan tx history untuk ini
        };
    } catch {
        return DEFAULT_TEAM_WALLET;
    }
}

// ─────────────────────────────────────────────────
// TVL HISTORY (Next.js proxy)
// ─────────────────────────────────────────────────

export async function fetchTvlHistorySim(
    url: string,
    currentTvl: number,
    timestamp: number
): Promise<TvlSignal> {
    try {
        const fullUrl = `${url}?tvl=${currentTvl.toFixed(2)}&ts=${timestamp}`;
        const resp    = await fetch(fullUrl, { signal: AbortSignal.timeout(8_000) });

        if (!resp.ok) return { currentTvl, tvlChangePercent: 0 };

        const data = await resp.json() as any;

        return {
            currentTvl:      Number(data.currentTvl)      || currentTvl,
            tvlChangePercent: Number(data.tvlChangePercent) || 0,
        };
    } catch {
        return { currentTvl, tvlChangePercent: 0 };
    }
}

// ─────────────────────────────────────────────────
// DEFI METRICS (Next.js proxy: AAVE + Compound)
// ─────────────────────────────────────────────────

export async function fetchDefiMetricsSim(url: string): Promise<DefiMetricsSignal> {
    try {
        const resp = await fetch(url, { signal: AbortSignal.timeout(8_000) });

        if (!resp.ok) return { aave: null, compound: null };

        const data = await resp.json() as any;

        return {
            aave: data.aave
                ? {
                    totalSupplied: String(data.aave.totalSupplied || "0"),
                    totalBorrowed: String(data.aave.totalBorrowed || "0"),
                    supplyApy:     Number(data.aave.supplyApy)    || 0,
                    borrowApy:     Number(data.aave.borrowApy)    || 0,
                    utilization:   Number(data.aave.utilization)  || 0,
                }
                : null,
            compound: data.compound
                ? {
                    totalSupply: String(data.compound.totalSupply || "0"),
                    totalBorrow: String(data.compound.totalBorrow || "0"),
                    utilization: Number(data.compound.utilization) || 0,
                    supplyApr:   Number(data.compound.supplyApr)   || 0,
                    borrowApr:   Number(data.compound.borrowApr)   || 0,
                }
                : null,
        };
    } catch {
        return { aave: null, compound: null };
    }
}
