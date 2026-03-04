/**
 * bft-worker.ts
 * ─────────────────────────────────────────────────────────────
 * Worker thread yang mereplikasi satu node DON dalam BFT round.
 *
 * Setiap worker secara independen:
 *   1. Menerima data on-chain (deterministik) via workerData
 *   2. Fetch off-chain signals dari mock server (variance per nodeId)
 *   3. Hitung risk scores menggunakan pure functions kode CRE asli
 *   4. Post NodeResult ke main thread via parentPort
 *
 * ═══════════════════════════════════════════════════════════
 * PENTING — Import path:
 *   Import LANGSUNG dari file spesifik:
 *     ../../monitors/risk-scorer       ← computeAllRiskScores
 *     ../../monitors/anomaly-detector  ← detectAllAnomalies
 *
 *   JANGAN import via ../../monitors/index.ts karena akan
 *   menarik dependency ke CRE SDK (EVMClient, HTTPClient)
 *   yang tidak bisa berjalan di luar Runtime context.
 * ═══════════════════════════════════════════════════════════
 *
 * Byzantine mode (isByzantine=true):
 *   Node ini menginjeksi score=100 CRITICAL untuk semua adapter.
 *   Digunakan untuk tes apakah BFT bisa menolak node malicious.
 * ─────────────────────────────────────────────────────────────
 */

import { workerData, parentPort } from "worker_threads";

import type { WorkerInput, NodeResult } from "./bft-types";
import type { OffchainSignals } from "../../monitors/types";

// ─────────────────────────────────────────────────
// Import LANGSUNG — hindari monitors/index.ts (ada CRE SDK di dalamnya)
// ─────────────────────────────────────────────────
import { computeAllRiskScores } from "../../monitors/risk-scorer";
import { detectAllAnomalies, getHighestSeverity } from "../../monitors/anomaly-detector";

// ─────────────────────────────────────────────────
// DEFAULT VALUES (fallback jika API tidak tersedia)
// ─────────────────────────────────────────────────

const DEFAULTS = {
    github: {
        recentCommits:   0,
        openIssues:      0,
        lastPushDaysAgo: 999,
    },
    aiSentinel: {
        ai_threat_score: 30,
        confidence:      0.3,
        reasoning:       "AI Sentinel unavailable — default moderate score",
        recommendation:  "HOLD",
        signals:         [] as any[],
    },
    security: {
        isHoneypot:            false,
        isOpenSource:          true,
        isProxy:               false,
        ownerCanChangeBalance: false,
        isMintable:            false,
    },
    teamWallet: {
        balanceEth:          0,
        recentLargeOutflows: false,
    },
};

// ─────────────────────────────────────────────────
// HELPER FETCH (inline agar URL bisa include &node=N)
// ─────────────────────────────────────────────────

async function fetchJson(url: string, timeoutMs = 10_000): Promise<any | null> {
    try {
        const resp = await fetch(url, {
            headers: { "User-Agent": "ShieldYield-BFT-Worker" },
            signal:  AbortSignal.timeout(timeoutMs),
        });
        if (!resp.ok) return null;
        return await resp.json();
    } catch {
        return null;
    }
}

// ─────────────────────────────────────────────────
// NODE COMPUTATION
// ─────────────────────────────────────────────────

async function runNode(): Promise<NodeResult> {
    const input = workerData as WorkerInput;
    const {
        nodeId, isByzantine, adapters,
        mockBaseUrl, directApis,
        primaryProtocol, currentTvl, timestamp,
    } = input;

    // ── Byzantine node: injeksi CRITICAL untuk semua adapter ──────────────
    // Mensimulasikan node malicious yang mencoba memaksa tindakan darurat.
    // BFT akan menolaknya selama jumlah Byzantine ≤ FAULT_TOLERANCE (6).
    if (isByzantine) {
        const riskScores: Record<string, { score: number; level: string }> = {};
        for (const adapter of adapters) {
            riskScores[adapter.name] = { score: 100, level: "CRITICAL" };
        }
        return {
            nodeId,
            isByzantine: true,
            ok:          true,
            riskScores,
            anomalies:       [],
            highestSeverity: "CRITICAL",
        };
    }

    try {
        // ── 1. AI Sentinel + GitHub (mock server — ada variance) ──────────
        const aiData = await fetchJson(
            `${mockBaseUrl}/api/ai-sentinel?protocol=${primaryProtocol}&node=${nodeId}`
        );
        const github = aiData?.github ?? DEFAULTS.github;
        const aiSentinel = aiData
            ? {
                ai_threat_score: Number(aiData.ai_threat_score) || 30,
                confidence:      Number(aiData.confidence)      || 0.3,
                reasoning:       String(aiData.reasoning        || ""),
                recommendation:  String(aiData.recommendation   || "HOLD"),
                signals: Array.isArray(aiData.signals)
                    ? aiData.signals.map((s: any) => ({
                        source:    String(s.source    || ""),
                        signal:    String(s.signal    || ""),
                        sentiment: String(s.sentiment || "neutral"),
                    }))
                    : [],
            }
            : DEFAULTS.aiSentinel;

        // ── 2. TVL history (mock server — ada variance ±0.5%) ─────────────
        const tvlData = await fetchJson(
            `${mockBaseUrl}/api/tvl-history?tvl=${currentTvl.toFixed(2)}&ts=${timestamp}&node=${nodeId}`
        );
        const tvlChangePercent = tvlData ? (Number(tvlData.tvlChangePercent) || 0) : 0;

        // ── 3. DeFi metrics (mock server — pass-through, tanpa variance) ──
        const defiRaw = await fetchJson(`${mockBaseUrl}/api/defi-metrics?node=${nodeId}`);
        const defiMetrics = defiRaw
            ? {
                aave: defiRaw.aave
                    ? {
                        totalSupplied: String(defiRaw.aave.totalSupplied || "0"),
                        totalBorrowed: String(defiRaw.aave.totalBorrowed || "0"),
                        supplyApy:     Number(defiRaw.aave.supplyApy)    || 0,
                        borrowApy:     Number(defiRaw.aave.borrowApy)    || 0,
                        utilization:   Number(defiRaw.aave.utilization)  || 0,
                    }
                    : null,
                compound: defiRaw.compound
                    ? {
                        totalSupply: String(defiRaw.compound.totalSupply || "0"),
                        totalBorrow: String(defiRaw.compound.totalBorrow || "0"),
                        utilization: Number(defiRaw.compound.utilization) || 0,
                        supplyApr:   Number(defiRaw.compound.supplyApr)   || 0,
                        borrowApr:   Number(defiRaw.compound.borrowApr)   || 0,
                    }
                    : null,
            }
            : { aave: null, compound: null };

        // ── 4. GoPlus security (langsung ke GoPlus API, tanpa variance) ───
        const goPlusRaw = await fetchJson(directApis.goPlusUrl, 8_000);
        let security = DEFAULTS.security;
        if (goPlusRaw?.result) {
            const firstKey = Object.keys(goPlusRaw.result)[0];
            const flags    = firstKey ? goPlusRaw.result[firstKey] : {};
            security = {
                isHoneypot:            flags.is_honeypot          === "1",
                isOpenSource:          flags.is_open_source        === "1",
                isProxy:               flags.is_proxy              === "1",
                ownerCanChangeBalance: flags.owner_change_balance  === "1",
                isMintable:            flags.is_mintable           === "1",
            };
        }

        // ── 5. Team wallet balance (langsung ke Arbiscan, tanpa variance) ─
        const walletRaw = await fetchJson(directApis.teamWalletUrl, 8_000);
        // Arbiscan may return error strings (e.g. "Max rate limit reached") in result field.
        // Guard: only call BigInt() when result is a valid decimal integer string.
        const walletResultStr = String(walletRaw?.result ?? "");
        const teamWallet = /^\d+$/.test(walletResultStr)
            ? {
                balanceEth:          Number(BigInt(walletResultStr)) / 1e18,
                recentLargeOutflows: false,
            }
            : DEFAULTS.teamWallet;

        // ── 6. Rakit OffchainSignals ───────────────────────────────────────
        const offchain: OffchainSignals = {
            prices:     { ethUsd: 0, btcUsd: 0, usdcUsd: 1.0 },
            tvl:        { currentTvl, tvlChangePercent },
            defiMetrics,
            github,
            security,
            teamWallet,
            aiSentinel,
        };

        // ── 7. Hitung scores via pure functions dari kode CRE asli ─────────
        const riskScores      = computeAllRiskScores(adapters, [], offchain);
        const anomalies       = detectAllAnomalies(adapters, offchain);
        const highestSeverity = getHighestSeverity(anomalies);

        return {
            nodeId,
            isByzantine: false,
            ok:          true,
            riskScores,
            anomalies,
            highestSeverity,
        };

    } catch (err) {
        return {
            nodeId,
            isByzantine:     false,
            ok:              false,
            error:           String(err),
            riskScores:      {},
            anomalies:       [],
            highestSeverity: null,
        };
    }
}

// ─────────────────────────────────────────────────
// ENTRY POINT
// ─────────────────────────────────────────────────

runNode()
    .then((result) => parentPort!.postMessage(result))
    .catch((err) =>
        parentPort!.postMessage({
            nodeId:          (workerData as WorkerInput).nodeId,
            isByzantine:     false,
            ok:              false,
            error:           String(err),
            riskScores:      {},
            anomalies:       [],
            highestSeverity: null,
        } satisfies NodeResult)
    );
