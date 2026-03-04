/**
 * sim-daemon.ts
 * ─────────────────────────────────────────────────────────────
 * CRE Simulation Daemon — mereplikasi perilaku CRE workflow
 * menggunakan viem (HTTP/RPC) + fetch() tanpa CRE SDK runtime.
 *
 * ══════════════════════════════════════════════════════════════
 * BFT MODE (Level 2 — Worker Threads + Mock HTTP Variance)
 * ══════════════════════════════════════════════════════════════
 * Sentinel scan sekarang menggunakan BFT 21 nodes:
 *
 *   1. Main thread membaca data on-chain (deterministik — shared)
 *   2. Mock variance server (port 3099) dijalankan di main thread
 *   3. 21 worker threads di-spawn secara paralel
 *      - Setiap worker fetch HTTP dari mock server (tiap node mendapat
 *        variance berbeda: ai_score ±15, confidence ±0.15, TVL ±0.5%)
 *      - Setiap worker menghitung risk score secara independen
 *   4. Main thread kumpulkan hasil → hitung median + konsensus BFT
 *      - Konsensus tercapai jika ≥ 15 dari 21 nodes setuju (n-f)
 *      - Byzantine nodes (env BYZANTINE_NODES=7,14) di-reject otomatis
 *   5. Hasil konsensus ditulis ke chain via writeContract
 *
 * Event watchers tetap berjalan:
 *   WF 4 → Reaksi otomatis terhadap event RiskScoreUpdated
 *
 * Cara menjalankan:
 *   CRE_ETH_PRIVATE_KEY=0x... bun simulation/sim-daemon.ts
 *   CRE_ETH_PRIVATE_KEY=0x... BYZANTINE_NODES=7,14 bun simulation/sim-daemon.ts
 * ─────────────────────────────────────────────────────────────
 */

import * as fs   from "fs";
import * as path from "path";
import { type Address } from "viem";

// ABIs untuk event watching
import { RiskRegistry, ShieldVault } from "../../contracts/abi";

// On-chain read (tetap di main thread — data deterministik, shared ke semua workers)
import { createSimPublicClient, readAllAdaptersSim, readPriceFeedsSim } from "./sim-reader";

// On-chain write (tetap di main thread)
import {
    createSimClients,
    writeBatchRiskScores,
    writePartialWithdraw,
    writeEmergencyWithdraw,
    type SimClients,
} from "./sim-writer";

// BFT modules
import { startMockVarianceServer, MOCK_SERVER_PORT } from "./bft/mock-variance-server";
import { runBftRound, type BftConfig }               from "./bft/bft-runner";

// ─────────────────────────────────────────────────
// LOAD CONFIG
// ─────────────────────────────────────────────────

const CONFIG_PATH = path.join(process.cwd(), "config.staging.json");
const config      = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));

const RPC_URL      = process.env.RPC_URL    || "https://sepolia-rollup.arbitrum.io/rpc";
const PRIVATE_KEY  = process.env.PRIVATE_KEY ?? process.env.CRE_ETH_PRIVATE_KEY;
const CRON_MS      = 30_000; // 30 detik, sama dengan schedule di config.staging.json
const TRIGGER_PORT = 3100;   // port untuk event-driven trigger dari sim-inject

// Guard: cegah scan overlap jika trigger dipicu lebih cepat dari 30 detik
let scanInProgress  = false;
const daemonStartMs = Date.now();

if (!PRIVATE_KEY) {
    console.error("[DAEMON] ERROR: Set environment variable PRIVATE_KEY=0x... or CRE_ETH_PRIVATE_KEY=0x...");
    process.exit(1);
}

// Ambil alamat kontrak dari config Arbitrum Sepolia
const arbEvm    = config.evms.find((e: any) => e.chainName === "ethereum-testnet-sepolia-arbitrum-1");
const addresses = arbEvm?.addresses[0] || {};
const apis      = config.offchainApis;
const shieldCfg = config.shieldConfig;

// Price feeds: ambil dari Ethereum Sepolia (cross-chain, sama seperti WF asli)
const ethEvm     = config.evms.find((e: any) => e.chainName === "ethereum-testnet-sepolia");
const priceFeeds = ethEvm?.priceFeeds || config.priceFeeds;

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
    magenta: "\x1b[35m",
    blue:    "\x1b[34m",
};

function log(tag: string, msg: string, color: string = C.r) {
    const ts = new Date().toISOString().replace("T", " ").split(".")[0];
    console.log(`${C.dim}[${ts}]${C.r} ${color}${C.bold}[${tag}]${C.r} ${msg}`);
}

function separator() {
    console.log(`${C.dim}${"─".repeat(60)}${C.r}`);
}

// ─────────────────────────────────────────────────
// BUAT CLIENTS
// ─────────────────────────────────────────────────

const publicClient           = createSimPublicClient(RPC_URL);
const simClients: SimClients = createSimClients(RPC_URL, PRIVATE_KEY!);

// ─────────────────────────────────────────────────
// SENTINEL SCAN — setara WF 1+2 (Cron)
// Sekarang menggunakan BFT 21 nodes
// ─────────────────────────────────────────────────

async function runSentinelScan() {
    if (scanInProgress) {
        log("CRON", "Scan sedang berjalan — skip (triggered too fast)", C.dim);
        return;
    }
    scanInProgress = true;
    try {
        await _runSentinelScanInner();
    } finally {
        scanInProgress = false;
    }
}

async function _runSentinelScanInner() {
    separator();
    log("CRON", "Sentinel scan dimulai (BFT 21 nodes)...", C.cyan);

    // ── 1. Baca adapter data dari chain (main thread — shared ke semua workers)
    log("CHAIN", "Membaca data adapter dari Arbitrum Sepolia...", C.dim);
    let adapters;
    try {
        adapters = await readAllAdaptersSim(publicClient, addresses);
    } catch (err) {
        log("CHAIN", `Gagal membaca adapter: ${err}`, C.red);
        return;
    }

    for (const a of adapters) {
        log(
            "CHAIN",
            `${a.name}: balance=${Number(a.balance) / 1e6} USDC, apy=${a.apy}, healthy=${a.isHealthy}`,
            C.dim
        );
    }

    // ── 2. Baca price feeds (main thread)
    let prices;
    try {
        prices = await readPriceFeedsSim(publicClient, priceFeeds);
        log(
            "CHAIN",
            `Prices: ETH=$${prices.ethUsd.toFixed(2)} BTC=$${prices.btcUsd.toFixed(2)} USDC=$${prices.usdcUsd.toFixed(6)}`,
            C.dim
        );
    } catch {
        prices = { ethUsd: 0, btcUsd: 0, usdcUsd: 1.0 };
        log("CHAIN", "Price feeds tidak tersedia, gunakan fallback", C.yellow);
    }

    // ── 3. Hitung TVL baseline (dipakai workers sebelum variance diterapkan)
    const usdcPrice    = prices.usdcUsd || 1.0;
    let totalBalance   = 0n;
    for (const a of adapters) totalBalance += a.balance;
    const currentTvl = Number(totalBalance) * usdcPrice / 1e6;
    log("CHAIN", `TVL saat ini: $${currentTvl.toFixed(2)} USDC`, C.dim);

    // ── 4. Siapkan config BFT
    const timestamp         = Math.floor(Date.now() / 1000);
    const primaryAdapterCfg = apis.adapters[apis.primaryProtocol];

    const bftCfg: BftConfig = {
        mockBaseUrl: `http://localhost:${MOCK_SERVER_PORT}`,
        directApis: {
            goPlusUrl:
                `https://api.gopluslabs.io/api/v1/token_security/${apis.goPlusChainId}` +
                `?contract_addresses=${primaryAdapterCfg.goPlusTokenAddress}`,
            teamWalletUrl:
                `https://api.arbiscan.io/api?module=account&action=balance` +
                `&address=${primaryAdapterCfg.teamWallet}&tag=latest` +
                `&apikey=${process.env.ARBISCAN_API_KEY ?? "YourApiKeyToken"}`,
        },
        primaryProtocol: apis.primaryProtocol,
        currentTvl,
        timestamp,
    };

    // ── 5. Jalankan BFT round — 21 workers paralel, dengan variance per node
    log("BFT", `Memulai BFT round (mock: ${bftCfg.mockBaseUrl})...`, C.cyan);
    const consensus = await runBftRound(bftCfg, adapters);

    if (!consensus.reached) {
        log(
            "BFT",
            `Konsensus TIDAK tercapai (${consensus.agreeingNodes}/${consensus.totalNodes} setuju) — scan dibatalkan`,
            C.red
        );
        return;
    }

    log(
        "BFT",
        `Konsensus tercapai: ${consensus.agreeingNodes}/${consensus.totalNodes} nodes setuju`,
        C.green
    );

    // ── 6. Tampilkan median scores dari konsensus BFT
    const riskScores = consensus.medianScores;

    for (const [name, { score, level }] of Object.entries(riskScores)) {
        const color = level === "CRITICAL" ? C.red : level === "WARNING" ? C.yellow : C.green;
        log("RISK", `${name}: score=${score}/100, level=${level}  [BFT median]`, color);
    }

    // ── 7. Tulis ke chain jika ada WARNING atau CRITICAL
    const hasAlert = Object.values(riskScores).some(
        (r) => r.level === "WARNING" || r.level === "CRITICAL"
    );

    if (!hasAlert) {
        log("CRON", "Semua protokol SAFE/WATCH — tidak ada update on-chain", C.green);
        return;
    }

    log("CRON", "WARNING/CRITICAL terdeteksi — menulis risk scores ke chain...", C.yellow);

    const adapterToAddr: Record<string, string | undefined> = {
        AaveAdapter:     addresses.aaveAdapter,
        CompoundAdapter: addresses.compoundAdapter,
        MorphoAdapter:   addresses.morphoAdapter,
        YieldMaxAdapter: addresses.yieldMaxAdapter,
    };

    const protocols: Address[] = [];
    const scores:    number[]  = [];
    const reasons:   string[]  = [];

    for (const [name, { score, level }] of Object.entries(riskScores)) {
        const addr = adapterToAddr[name];
        if (!addr) continue;

        protocols.push(addr as Address);
        scores.push(score);
        reasons.push(
            `BFT Consensus (${consensus.agreeingNodes}/${consensus.totalNodes} nodes): ` +
            `Risk score ${score}/100 — ${level}`
        );
    }

    try {
        const txHash = await writeBatchRiskScores(
            simClients,
            addresses.riskRegistry,
            protocols,
            scores,
            reasons
        );
        log("WRITE", "batchUpdateRiskScores() berhasil", C.cyan);
        log("WRITE", `txHash: ${txHash}`, C.cyan);
        log("WRITE", `Verify: https://sepolia.arbiscan.io/tx/${txHash}`, C.blue);
    } catch (err) {
        log("WRITE", `Gagal menulis risk scores: ${err}`, C.red);
    }
}

// ─────────────────────────────────────────────────
// TRIGGER SERVER — event-driven scan (port 3100)
// sim-inject.ts POST ke /trigger untuk memulai scan segera
// ─────────────────────────────────────────────────

function startTriggerServer(): () => void {
    const server = Bun.serve({
        port: TRIGGER_PORT,
        async fetch(req) {
            const u      = new URL(req.url);
            const method = req.method;

            // POST /trigger → jalankan sentinel scan segera
            if (method === "POST" && u.pathname === "/trigger") {
                log("TRIGGER", "Scan dipicu secara event-driven oleh injector!", C.magenta);
                // Fire-and-forget — biarkan caller langsung mendapat respons
                runSentinelScan().catch((err) =>
                    log("TRIGGER", `Scan error: ${err}`, C.red)
                );
                return Response.json({ ok: true, message: "Scan triggered" });
            }

            // GET /status → info daemon
            if (u.pathname === "/status") {
                return Response.json({
                    running:      scanInProgress,
                    uptimeSeconds: Math.floor((Date.now() - daemonStartMs) / 1000),
                    mockServerPort: MOCK_SERVER_PORT,
                });
            }

            return Response.json({ error: "Unknown endpoint" }, { status: 404 });
        },
    });

    log("DAEMON", `Trigger server aktif di port ${TRIGGER_PORT}  (POST /trigger | GET /status)`, C.dim);

    return () => {
        server.stop();
        log("DAEMON", "Trigger server dihentikan", C.dim);
    };
}

// ─────────────────────────────────────────────────
// SHIELD EXECUTE — setara WF 4 (LogTrigger)
// Dipanggil ketika event RiskScoreUpdated terdeteksi
// ─────────────────────────────────────────────────

async function executeShield(
    protocolAddress: string,
    newScore:        number,
    threatLevel:     number
) {
    const LABELS = ["SAFE", "WATCH", "WARNING", "CRITICAL"];
    const label  = LABELS[threatLevel] || "UNKNOWN";

    log(
        "SHIELD",
        `Event: protocol=${protocolAddress.slice(0, 10)}... score=${newScore} level=${label}`,
        C.magenta
    );

    if (threatLevel < 2) {
        log("SHIELD", `Level ${label} — tidak ada aksi shield diperlukan`, C.dim);
        return;
    }

    if (threatLevel === 2) {
        const pct = shieldCfg.warningWithdrawPercent / 100;
        log("SHIELD", `WARNING protocol — partial withdraw ${pct}%...`, C.yellow);

        try {
            const txHash = await writePartialWithdraw(
                simClients,
                addresses.shieldVault,
                protocolAddress,
                shieldCfg.warningWithdrawPercent,
                `ShieldYield WARNING: Risk score ${newScore}/100. Partial withdrawal to protect funds.`
            );
            log("SHIELD", "partialWithdraw() berhasil", C.green);
            log("SHIELD", `txHash: ${txHash}`, C.green);
            log("SHIELD", `Verify: https://sepolia.arbiscan.io/tx/${txHash}`, C.blue);
        } catch (err) {
            log("SHIELD", `WARNING action gagal: ${err}`, C.red);
        }
        return;
    }

    if (threatLevel >= 3) {
        log("SHIELD", "CRITICAL protocol — EMERGENCY WITHDRAWAL!", C.red);

        try {
            const txHash = await writeEmergencyWithdraw(
                simClients,
                addresses.shieldVault,
                protocolAddress,
                `ShieldYield CRITICAL: Risk score ${newScore}/100. Emergency withdrawal to protect all funds.`
            );
            log("SHIELD", "emergencyWithdraw() berhasil", C.green);
            log("SHIELD", `txHash: ${txHash}`, C.green);
            log("SHIELD", `Verify: https://sepolia.arbiscan.io/tx/${txHash}`, C.blue);
        } catch (err) {
            log("SHIELD", `CRITICAL action gagal: ${err}`, C.red);
        }
    }
}

// ─────────────────────────────────────────────────
// EVENT WATCHERS
// ─────────────────────────────────────────────────

function startEventWatchers() {
    // Watch: RiskScoreUpdated → trigger shield execute (WF 4)
    publicClient.watchContractEvent({
        address:         addresses.riskRegistry as Address,
        abi:             RiskRegistry,
        eventName:       "RiskScoreUpdated",
        pollingInterval: 4_000,
        onLogs: (logs) => {
            for (const entry of logs) {
                const { protocol, newScore, threatLevel } = entry.args as any;
                log(
                    "EVENT",
                    `RiskScoreUpdated: ${protocol?.slice(0, 10)}... score=${newScore} level=${threatLevel}`,
                    C.magenta
                );
                executeShield(protocol, Number(newScore), Number(threatLevel))
                    .catch((err) => log("EVENT", `Shield execute error: ${err}`, C.red));
            }
        },
        onError: (err) => log("EVENT", `RiskScoreUpdated watcher error: ${err}`, C.red),
    });

    // Watch: Deposited → informasikan deposit baru
    publicClient.watchContractEvent({
        address:         addresses.shieldVault as Address,
        abi:             ShieldVault,
        eventName:       "Deposited",
        pollingInterval: 4_000,
        onLogs: (logs) => {
            for (const entry of logs) {
                const { user, amount } = entry.args as any;
                const amountFormatted  = (Number(amount) / 1e6).toFixed(2);
                log("EVENT", `Deposited: $${amountFormatted} USDC dari ${user}`, C.green);
                log("EVENT", "Dana akan diperiksa pada BFT scan berikutnya", C.dim);
            }
        },
        onError: (err) => log("EVENT", `Deposited watcher error: ${err}`, C.red),
    });

    log("DAEMON", "Event watchers aktif: RiskScoreUpdated + Deposited", C.cyan);
}

// ─────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────

async function main() {
    console.log(`\n${C.cyan}${"═".repeat(60)}${C.r}`);
    console.log(`${C.bold}${C.cyan}  ShieldYield — CRE Simulation Daemon (BFT Mode)${C.r}`);
    console.log(`${C.dim}  21 worker nodes · threshold=15 · fault tolerance=6${C.r}`);
    console.log(`${C.dim}  Kode CRE asli TIDAK dimodifikasi${C.r}`);
    console.log(`${C.cyan}${"═".repeat(60)}${C.r}\n`);

    log("DAEMON", `CRE Address: ${simClients.account.address}`, C.cyan);
    log("DAEMON", `RiskRegistry: ${addresses.riskRegistry}`, C.dim);
    log("DAEMON", `ShieldVault:  ${addresses.shieldVault}`, C.dim);
    log("DAEMON", `Cron interval: setiap ${CRON_MS / 1000} detik`, C.dim);

    if (process.env.BYZANTINE_NODES) {
        log("DAEMON", `Byzantine nodes: [${process.env.BYZANTINE_NODES}]`, C.yellow);
    }

    // Mulai mock variance server (harus berjalan sebelum BFT round pertama)
    const stopMockServer    = startMockVarianceServer();

    // Mulai trigger server — terima POST /trigger dari sim-inject.ts
    const stopTriggerServer = startTriggerServer();

    // Mulai event watchers
    startEventWatchers();

    // Graceful shutdown
    process.on("SIGINT", () => {
        log("DAEMON", "Menghentikan daemon...", C.yellow);
        stopTriggerServer();
        stopMockServer();
        process.exit(0);
    });

    // Langsung jalankan BFT scan pertama
    log("DAEMON", "Menjalankan BFT scan awal...", C.cyan);
    await runSentinelScan();

    // Lanjutkan dengan cron loop
    setInterval(async () => {
        await runSentinelScan();
    }, CRON_MS);

    log("DAEMON", "Daemon berjalan. Tekan Ctrl+C untuk berhenti.", C.cyan);
}

main().catch((err) => {
    console.error("[DAEMON] Fatal error:", err);
    process.exit(1);
});
