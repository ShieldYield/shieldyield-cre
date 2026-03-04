/**
 * bft-types.ts
 * ─────────────────────────────────────────────────────────────
 * Shared types dan konstanta untuk simulasi BFT 21 nodes.
 *
 * BFT Parameters:
 *   n = 21  total nodes
 *   f = 6   fault tolerance (jumlah maks Byzantine nodes) → n = 3f + 1
 *   threshold = 15 nodes harus setuju (n - f)
 *
 * Referensi ke kode CRE asli:
 *   - AdapterSnapshot dari monitors/types.ts (type-only import, aman)
 *   - Anomaly / AnomalySeverity dari monitors/anomaly-detector.ts (type-only)
 * ─────────────────────────────────────────────────────────────
 */

import type { AdapterSnapshot } from "../../monitors/types";
import type { Anomaly, AnomalySeverity } from "../../monitors/anomaly-detector";

// ─────────────────────────────────────────────────
// BFT CONSTANTS
// ─────────────────────────────────────────────────

export const NUM_NODES           = 21;
export const FAULT_TOLERANCE     = Math.floor((NUM_NODES - 1) / 3); // 6
export const CONSENSUS_THRESHOLD = NUM_NODES - FAULT_TOLERANCE;      // 15

// ─────────────────────────────────────────────────
// WORKER I/O TYPES
// ─────────────────────────────────────────────────

/**
 * Input yang dikirim ke setiap worker via workerData.
 * BigInt fields di AdapterSnapshot di-clone via structured clone (Bun-native).
 */
export interface WorkerInput {
    nodeId:      number;
    isByzantine: boolean;

    /** Data on-chain deterministik — sama untuk semua 21 nodes */
    adapters: AdapterSnapshot[];

    /** Base URL mock server untuk HTTP variance per node */
    mockBaseUrl: string; // "http://localhost:3099"

    /** URL yang diakses langsung tanpa variance (external APIs) */
    directApis: {
        goPlusUrl:    string;
        teamWalletUrl: string;
    };

    primaryProtocol: string;
    currentTvl:      number;
    timestamp:       number;
}

/** Hasil komputasi satu node DON */
export interface NodeResult {
    nodeId:      number;
    isByzantine: boolean;
    ok:          boolean;
    error?:      string;

    /** Scores per adapter yang dihitung oleh node ini */
    riskScores: Record<string, { score: number; level: string }>;

    /** Anomali yang terdeteksi oleh node ini */
    anomalies: Anomaly[];

    /** Severity tertinggi dari anomali node ini */
    highestSeverity: AnomalySeverity | null;
}

/** Hasil konsensus dari semua 21 nodes */
export interface ConsensusResult {
    /** true jika ≥ CONSENSUS_THRESHOLD nodes setuju */
    reached:       boolean;
    agreeingNodes: number;
    totalNodes:    number;
    threshold:     number;

    /** Median score dari semua nodes yang berhasil, per adapter */
    medianScores: Record<string, { score: number; level: string }>;

    /** Highest severity dari median scores */
    highestSeverity: AnomalySeverity | null;

    /** Jumlah Byzantine nodes yang terdeteksi (diabaikan dari konsensus) */
    byzantineRejected: number;

    /** Semua hasil per-node untuk debugging */
    nodeResults: NodeResult[];
}
