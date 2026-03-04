/**
 * bft-runner.ts
 * ─────────────────────────────────────────────────────────────
 * Orkestrasi satu BFT round dengan 21 worker threads.
 *
 * Cara kerja:
 *   1. Spawn 21 workers secara paralel via worker_threads
 *   2. Log hasil setiap node secara real-time saat tiba
 *   3. Setelah semua selesai: hitung konsensus BFT
 *      - Median score per adapter (dari nodes yang berhasil)
 *      - Count nodes yang "setuju" (score dalam ±10 dari median)
 *      - Konsensus tercapai jika agreeingNodes ≥ CONSENSUS_THRESHOLD (15)
 *   4. Log summary konsensus
 *   5. Return ConsensusResult ke pemanggil (sim-daemon.ts)
 *
 * Byzantine simulation:
 *   Set env var BYZANTINE_NODES=7,14 untuk menandai node 7 dan 14
 *   sebagai Byzantine. Mereka akan melaporkan score=100 CRITICAL.
 *   Jika jumlah Byzantine ≤ FAULT_TOLERANCE (6), konsensus tetap tercapai.
 * ─────────────────────────────────────────────────────────────
 */

import path   from "path";
import { Worker } from "worker_threads";

import {
    NUM_NODES,
    FAULT_TOLERANCE,
    CONSENSUS_THRESHOLD,
    type WorkerInput,
    type NodeResult,
    type ConsensusResult,
} from "./bft-types";

import { getThreatLevelLabel } from "../../monitors/risk-scorer";
import type { AdapterSnapshot } from "../../monitors/types";
import type { AnomalySeverity } from "../../monitors/anomaly-detector";

// ─────────────────────────────────────────────────
// WORKER PATH (Bun-native TypeScript workers)
// ─────────────────────────────────────────────────

const WORKER_FILE = path.join(import.meta.dir, "bft-worker.ts");

// ─────────────────────────────────────────────────
// WARNA LOG
// ─────────────────────────────────────────────────

const C = {
    r:       "\x1b[0m",
    dim:     "\x1b[2m",
    bold:    "\x1b[1m",
    green:   "\x1b[32m",
    yellow:  "\x1b[33m",
    red:     "\x1b[31m",
    cyan:    "\x1b[36m",
    blue:    "\x1b[34m",
};

function logNode(result: NodeResult): void {
    const id     = String(result.nodeId).padStart(2, "0");
    const prefix = `  ${C.dim}NODE ${id}${C.r}`;

    if (!result.ok) {
        console.log(`${prefix}  ${C.red}✗ ERROR: ${result.error?.slice(0, 80)}${C.r}`);
        return;
    }

    if (result.isByzantine) {
        console.log(`${prefix}  ${C.red}${C.bold}⚡ BYZANTINE${C.r} — score=100 CRITICAL injected`);
        return;
    }

    const scoreStr = Object.entries(result.riskScores)
        .map(([n, v]) => {
            const color = v.level === "CRITICAL" ? C.red
                : v.level === "WARNING" ? C.yellow
                : C.green;
            return `${n.replace("Adapter", "")}:${color}${v.score}${C.r}`;
        })
        .join("  ");

    const sev = result.highestSeverity;
    const sevLabel = sev === "CRITICAL" ? `${C.red}CRITICAL${C.r}`
        : sev === "WARNING"  ? `${C.yellow}WARNING${C.r}`
        : sev === "WATCH"    ? `${C.yellow}WATCH${C.r}`
        : `${C.green}SAFE${C.r}`;

    console.log(`${prefix}  ${sevLabel}  ${C.dim}[${scoreStr}]${C.r}`);
}

// ─────────────────────────────────────────────────
// STATISTIK HELPERS
// ─────────────────────────────────────────────────

function median(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid    = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0
        ? sorted[mid]
        : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

// ─────────────────────────────────────────────────
// BFT CONSENSUS
// ─────────────────────────────────────────────────

function computeConsensus(results: NodeResult[]): ConsensusResult {
    const successful        = results.filter((r) => r.ok && !r.isByzantine);
    const byzantineRejected = results.filter((r) => r.isByzantine).length;

    if (successful.length === 0) {
        return {
            reached:          false,
            agreeingNodes:    0,
            totalNodes:       NUM_NODES,
            threshold:        CONSENSUS_THRESHOLD,
            medianScores:     {},
            highestSeverity:  null,
            byzantineRejected,
            nodeResults:      results,
        };
    }

    // Kumpulkan semua adapter names dari nodes yang berhasil
    const adapterNames = new Set<string>();
    for (const r of successful) {
        for (const name of Object.keys(r.riskScores)) adapterNames.add(name);
    }

    // ── Median score per adapter ───────────────────────────────────────────
    const medianScores: Record<string, { score: number; level: string }> = {};
    for (const name of adapterNames) {
        const scores = successful
            .map((r) => r.riskScores[name]?.score)
            .filter((s): s is number => s !== undefined);
        const med = median(scores);
        medianScores[name] = { score: med, level: getThreatLevelLabel(med) };
    }

    // ── Count agreeing nodes ───────────────────────────────────────────────
    // Node "setuju" jika semua score-nya dalam ±10 dari median
    // (Byzantine nodes dikecualikan karena sudah difilter di `successful`)
    let agreeingNodes = 0;
    for (const r of successful) {
        const allClose = [...adapterNames].every((name) => {
            const nodeScore   = r.riskScores[name]?.score;
            const medianScore = medianScores[name]?.score;
            return nodeScore !== undefined && Math.abs(nodeScore - medianScore) <= 10;
        });
        if (allClose) agreeingNodes++;
    }

    // ── Highest severity dari median ──────────────────────────────────────
    const sevOrder: AnomalySeverity[] = ["WATCH", "WARNING", "CRITICAL"];
    let highestSeverity: AnomalySeverity | null = null;
    for (const { level } of Object.values(medianScores)) {
        if (level === "CRITICAL" || level === "WARNING" || level === "WATCH") {
            const idx    = sevOrder.indexOf(level as AnomalySeverity);
            const curIdx = highestSeverity ? sevOrder.indexOf(highestSeverity) : -1;
            if (idx > curIdx) highestSeverity = level as AnomalySeverity;
        }
    }

    return {
        reached:          agreeingNodes >= CONSENSUS_THRESHOLD,
        agreeingNodes,
        totalNodes:       NUM_NODES,
        threshold:        CONSENSUS_THRESHOLD,
        medianScores,
        highestSeverity,
        byzantineRejected,
        nodeResults:      results,
    };
}

// ─────────────────────────────────────────────────
// SPAWN SATU WORKER
// ─────────────────────────────────────────────────

function spawnWorker(input: WorkerInput): Promise<NodeResult> {
    return new Promise((resolve) => {
        const worker = new Worker(WORKER_FILE, { workerData: input });

        worker.once("message", (result: NodeResult) => {
            logNode(result);
            resolve(result);
        });

        worker.once("error", (err) => {
            const fail: NodeResult = {
                nodeId:          input.nodeId,
                isByzantine:     false,
                ok:              false,
                error:           String(err),
                riskScores:      {},
                anomalies:       [],
                highestSeverity: null,
            };
            logNode(fail);
            resolve(fail);
        });
    });
}

// ─────────────────────────────────────────────────
// PUBLIC CONFIG TYPE
// ─────────────────────────────────────────────────

export interface BftConfig {
    mockBaseUrl:     string;
    directApis: {
        goPlusUrl:    string;
        teamWalletUrl: string;
    };
    primaryProtocol: string;
    currentTvl:      number;
    timestamp:       number;
}

// ─────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────

/**
 * Jalankan satu BFT round:
 * - Spawn NUM_NODES (21) workers secara paralel
 * - Log hasil setiap node saat tiba
 * - Hitung konsensus dan log summary
 * - Return ConsensusResult
 *
 * Byzantine nodes dikontrol via env var: BYZANTINE_NODES=7,14
 */
export async function runBftRound(
    cfg:      BftConfig,
    adapters: AdapterSnapshot[]
): Promise<ConsensusResult> {

    // Parse Byzantine node IDs dari env var
    const byzantineSet = new Set<number>(
        (process.env.BYZANTINE_NODES ?? "")
            .split(",")
            .map((s) => parseInt(s.trim(), 10))
            .filter((n) => !isNaN(n) && n >= 1 && n <= NUM_NODES)
    );

    // ── Header ──
    console.log(`\n${C.cyan}${"─".repeat(56)}${C.r}`);
    console.log(
        `${C.bold}${C.cyan}  BFT ROUND — ${NUM_NODES} nodes${C.r}  ` +
        `${C.dim}f=${FAULT_TOLERANCE}  threshold=${CONSENSUS_THRESHOLD}${C.r}`
    );
    if (byzantineSet.size > 0) {
        console.log(
            `${C.yellow}  Byzantine nodes: [${[...byzantineSet].join(", ")}]${C.r}`
        );
    }
    console.log(`${C.dim}${"─".repeat(56)}${C.r}`);

    // ── Spawn semua 21 workers paralel ──
    const promises = Array.from({ length: NUM_NODES }, (_, i) => {
        const nodeId = i + 1;
        return spawnWorker({
            nodeId,
            isByzantine:     byzantineSet.has(nodeId),
            adapters,
            mockBaseUrl:     cfg.mockBaseUrl,
            directApis:      cfg.directApis,
            primaryProtocol: cfg.primaryProtocol,
            currentTvl:      cfg.currentTvl,
            timestamp:       cfg.timestamp,
        });
    });

    const nodeResults = await Promise.all(promises);

    // ── Hitung konsensus ──
    const consensus = computeConsensus(nodeResults);

    // ── Summary ──────────────────────────────────────────────────────
    console.log(`${C.dim}${"─".repeat(56)}${C.r}`);
    console.log(`${C.bold}  CONSENSUS RESULT${C.r}`);

    const reachStr = consensus.reached
        ? `${C.green}${C.bold}✓ TERCAPAI${C.r}`
        : `${C.red}${C.bold}✗ TIDAK TERCAPAI${C.r}`;

    console.log(
        `  ${reachStr}  ` +
        `${C.dim}${consensus.agreeingNodes}/${consensus.totalNodes} nodes setuju  ` +
        `(butuh ≥${consensus.threshold})${C.r}`
    );

    if (consensus.byzantineRejected > 0) {
        console.log(
            `  ${C.yellow}⚡ ${consensus.byzantineRejected} Byzantine node(s) ` +
            `terdeteksi & diabaikan${C.r}`
        );
    }

    console.log(`  Median scores:`);
    for (const [name, { score, level }] of Object.entries(consensus.medianScores)) {
        const color = level === "CRITICAL" ? C.red
            : level === "WARNING" ? C.yellow
            : C.green;
        console.log(
            `    ${C.dim}${name.padEnd(18)}${C.r} ` +
            `${color}${C.bold}${score}/100  ${level}${C.r}`
        );
    }

    console.log(`${C.cyan}${"─".repeat(56)}${C.r}\n`);

    return consensus;
}
