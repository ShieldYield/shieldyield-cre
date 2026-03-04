/**
 * sim-inject.ts
 * ─────────────────────────────────────────────────────────────
 * CLI tool untuk inject skenario data ke simulasi ShieldYield.
 *
 * Daripada menunggu 30 detik cron, gunakan ini untuk memicu scan
 * segera dengan data spesifik — deposit besar, anomali, exploit, dll.
 *
 * ═══════════════════════════════════════════════════════════
 * CARA PAKAI
 * ═══════════════════════════════════════════════════════════
 *
 *  Inject preset + trigger scan segera:
 *    bun simulation/sim-inject.ts warning --trigger
 *    bun simulation/sim-inject.ts critical --trigger
 *    bun simulation/sim-inject.ts exploit --trigger --expires=120
 *
 *  Inject custom data:
 *    bun simulation/sim-inject.ts --ai-score=75 --tvl-change=-12 --trigger
 *    bun simulation/sim-inject.ts --ai-score=90 --utilization=96 --trigger
 *
 *  Hanya trigger scan (tanpa mengubah injected data):
 *    bun simulation/sim-inject.ts --trigger
 *
 *  Clear injected scenario + trigger normal scan:
 *    bun simulation/sim-inject.ts clear --trigger
 *
 *  Lihat status:
 *    bun simulation/sim-inject.ts status
 *    bun simulation/sim-inject.ts list
 *
 * ═══════════════════════════════════════════════════════════
 * PRESET SCENARIOS
 * ═══════════════════════════════════════════════════════════
 *  normal          → AI=15, TVL=+1.0%        → SAFE/WATCH
 *  warning         → AI=68, TVL=-9.5%,  u=88% → WARNING
 *  critical        → AI=92, TVL=-26.0%, u=97% → WARNING (on-chain SAFE)
 *  exploit         → AI=96, TVL=-45.0%, u=99% → WARNING (max off-chain)
 *  tvl-crash       → AI=30, TVL=-35.0%        → WARNING
 *  deposit         → AI=15, TVL=+5.0%         → SAFE
 *  high-util       → AI=55, u=94%             → WATCH/WARNING
 *
 * Catatan: CRITICAL level (score ≥76) membutuhkan sinyal on-chain
 * (adapter tidak sehat / balance = 0 saat ada principal).
 * Off-chain saja maksimal menghasilkan WARNING — ini adalah
 * perilaku yang BENAR sesuai desain safety guardrail sistem.
 * ─────────────────────────────────────────────────────────────
 */

import type { InjectedScenario } from "./bft/mock-variance-server";

const MOCK_SERVER   = "http://localhost:3099";
const TRIGGER_URL   = "http://localhost:3100/trigger";
const STATUS_URL    = "http://localhost:3100/status";
const INJECT_URL    = `${MOCK_SERVER}/inject`;
const INJECT_STATE  = `${MOCK_SERVER}/inject-state`;

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

function ok(msg: string)    { console.log(`  ${C.green}✓${C.r} ${msg}`); }
function err(msg: string)   { console.log(`  ${C.red}✗${C.r} ${msg}`); }
function info(msg: string)  { console.log(`  ${C.dim}${msg}${C.r}`); }
function warn(msg: string)  { console.log(`  ${C.yellow}⚠${C.r} ${msg}`); }
function label(msg: string) { console.log(`\n${C.bold}${C.cyan}${msg}${C.r}`); }

// ─────────────────────────────────────────────────
// PRESET SCENARIOS
// ─────────────────────────────────────────────────

type PresetDef = Omit<InjectedScenario, "injectedAt">;

const PRESETS: Record<string, PresetDef> = {
    normal: {
        type:              "normal",
        label:             "Normal — Semua sinyal bersih",
        description:       "AI score rendah, TVL stabil. Tidak ada aksi yang diharapkan.",
        aiScore:           15,
        tvlChangePercent:  1.0,
    },
    warning: {
        type:              "warning",
        label:             "Warning — Sinyal risiko sedang",
        description:       "AI score tinggi + TVL drop sedang + utilization elevated.",
        aiScore:           68,
        tvlChangePercent:  -9.5,
        utilization:       88,
    },
    critical: {
        type:              "critical",
        label:             "Critical — Sinyal risiko tinggi",
        description:       "AI score sangat tinggi + TVL crash + utilization kritis. " +
                           "Akan menghasilkan WARNING (off-chain max). CRITICAL butuh on-chain damage.",
        aiScore:           92,
        tvlChangePercent:  -26.0,
        utilization:       97,
    },
    exploit: {
        type:              "exploit",
        label:             "Exploit — Simulasi serangan protokol",
        description:       "AI score ekstrem + TVL drain berat + utilization penuh.",
        aiScore:           96,
        tvlChangePercent:  -45.0,
        utilization:       99,
    },
    "tvl-crash": {
        type:              "tvl-crash",
        label:             "TVL Crash — Penurunan TVL ekstrem",
        description:       "TVL drop >20% → risk score +12 (full TVL velocity weight).",
        tvlChangePercent:  -35.0,
    },
    deposit: {
        type:              "deposit",
        label:             "Large Deposit — Dana masuk besar",
        description:       "Simulasi deposit besar. TVL naik, AI score bersih.",
        aiScore:           15,
        tvlChangePercent:  5.0,
    },
    "high-util": {
        type:              "high-util",
        label:             "High Utilization — Mendekati batas likuiditas",
        description:       "Utilization >90% → risk score +3-5 dari defi metrics.",
        aiScore:           55,
        utilization:       94,
    },
};

// ─────────────────────────────────────────────────
// HTTP HELPERS
// ─────────────────────────────────────────────────

async function postJson(url: string, body: any): Promise<any> {
    const resp = await fetch(url, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
        signal:  AbortSignal.timeout(5_000),
    });
    return resp.json();
}

async function deleteReq(url: string): Promise<any> {
    const resp = await fetch(url, {
        method: "DELETE",
        signal: AbortSignal.timeout(5_000),
    });
    return resp.json();
}

async function getJson(url: string): Promise<any> {
    const resp = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    return resp.json();
}

// ─────────────────────────────────────────────────
// ARG PARSER
// ─────────────────────────────────────────────────

function parseArgs(argv: string[]): {
    preset?:           string;
    aiScore?:          number;
    tvlChange?:        number;
    utilization?:      number;
    expires?:          number;
    trigger:           boolean;
    clear:             boolean;
    status:            boolean;
    list:              boolean;
    description?:      string;
} {
    const args = argv.slice(2);
    const result = { trigger: false, clear: false, status: false, list: false } as ReturnType<typeof parseArgs>;

    for (const arg of args) {
        if (arg === "--trigger")                result.trigger     = true;
        else if (arg === "--clear" || arg === "clear")   result.clear       = true;
        else if (arg === "--status" || arg === "status") result.status      = true;
        else if (arg === "--list"   || arg === "list")   result.list        = true;
        else if (arg.startsWith("--ai-score="))     result.aiScore     = parseFloat(arg.split("=")[1]);
        else if (arg.startsWith("--tvl-change="))   result.tvlChange   = parseFloat(arg.split("=")[1]);
        else if (arg.startsWith("--utilization="))  result.utilization = parseFloat(arg.split("=")[1]);
        else if (arg.startsWith("--expires="))      result.expires     = parseInt(arg.split("=")[1], 10);
        else if (arg.startsWith("--desc="))         result.description = arg.split("=").slice(1).join("=");
        else if (!arg.startsWith("--") && PRESETS[arg]) result.preset  = arg;
        else if (!arg.startsWith("--")) {
            warn(`Argumen tidak dikenal: "${arg}". Jalankan tanpa argumen untuk melihat help.`);
        }
    }

    return result;
}

// ─────────────────────────────────────────────────
// COMMANDS
// ─────────────────────────────────────────────────

async function cmdStatus() {
    label("Status Daemon & Injeksi");

    try {
        const daemonStatus = await getJson(STATUS_URL);
        ok(`Daemon berjalan  (uptime: ${daemonStatus.uptimeSeconds}s, scan: ${daemonStatus.running ? "sedang jalan" : "idle"})`);
    } catch {
        err("Daemon tidak berjalan (port 3100 tidak tersedia)");
        info("Jalankan: bun simulation/sim-daemon.ts");
    }

    try {
        const injectState = await getJson(INJECT_STATE);
        if (injectState.scenario) {
            const s = injectState.scenario as InjectedScenario;
            ok(`Scenario aktif: ${C.bold}${s.label}${C.r}`);
            info(`  type: ${s.type}`);
            if (s.aiScore          !== undefined) info(`  aiScore:          ${s.aiScore}`);
            if (s.tvlChangePercent !== undefined) info(`  tvlChangePercent: ${s.tvlChangePercent}%`);
            if (s.utilization      !== undefined) info(`  utilization:      ${s.utilization}%`);
            if (s.expiresAt        !== undefined) {
                const remaining = s.expiresAt - Math.floor(Date.now() / 1000);
                info(`  expires in:       ${remaining}s`);
            }
        } else {
            info("Tidak ada scenario yang diinjeksi. Data real/sim digunakan.");
        }
    } catch {
        err("Mock variance server tidak berjalan (port 3099 tidak tersedia)");
    }
}

async function cmdList() {
    label("Daftar Preset Scenarios");
    console.log();
    const maxLen = Math.max(...Object.keys(PRESETS).map((k) => k.length));
    for (const [name, preset] of Object.entries(PRESETS)) {
        const parts: string[] = [];
        if (preset.aiScore          !== undefined) parts.push(`AI=${preset.aiScore}`);
        if (preset.tvlChangePercent !== undefined) parts.push(`TVL%=${preset.tvlChangePercent}%`);
        if (preset.utilization      !== undefined) parts.push(`util=${preset.utilization}%`);
        console.log(
            `  ${C.cyan}${name.padEnd(maxLen + 2)}${C.r}` +
            `${C.dim}${parts.join("  ").padEnd(35)}${C.r}` +
            `${preset.label}`
        );
    }
    console.log();
    info("Usage: bun simulation/sim-inject.ts <preset> [--trigger] [--expires=<detik>]");
    info("       bun simulation/sim-inject.ts --ai-score=X --tvl-change=Y [--trigger]");
    console.log();
}

async function cmdClear(trigger: boolean) {
    label("Menghapus Scenario Injeksi");

    try {
        const result = await deleteReq(INJECT_URL);
        if (result.ok) {
            ok(`Scenario dihapus: ${result.cleared ?? "(tidak ada scenario aktif)"}`);
        } else {
            err(`Gagal menghapus: ${JSON.stringify(result)}`);
        }
    } catch (e) {
        err(`Mock variance server tidak tersedia: ${e}`);
        return;
    }

    if (trigger) await cmdTrigger();
}

async function cmdTrigger() {
    try {
        const result = await postJson(TRIGGER_URL, {});
        if (result.ok) {
            ok("Scan dipicu — cek output daemon untuk hasilnya");
        } else {
            err(`Trigger gagal: ${JSON.stringify(result)}`);
        }
    } catch (e) {
        err(`Trigger server tidak tersedia (port 3100): ${e}`);
        info("Pastikan daemon berjalan: bun simulation/sim-daemon.ts");
    }
}

async function cmdInject(scenario: PresetDef, trigger: boolean) {
    label(`Menginjeksi Scenario: ${scenario.label}`);

    if (scenario.description) info(scenario.description);
    console.log();

    try {
        const result = await postJson(INJECT_URL, scenario);
        if (result.ok) {
            ok(`Scenario aktif: ${result.scenario.label}`);
            if (result.scenario.aiScore          !== undefined) info(`  aiScore:          ${result.scenario.aiScore}`);
            if (result.scenario.tvlChangePercent !== undefined) info(`  tvlChangePercent: ${result.scenario.tvlChangePercent}%`);
            if (result.scenario.utilization      !== undefined) info(`  utilization:      ${result.scenario.utilization}%`);
            if (result.scenario.expiresAt        !== undefined) {
                const remaining = result.scenario.expiresAt - Math.floor(Date.now() / 1000);
                info(`  auto-clear in:    ${remaining}s`);
            }
            console.log();
        } else {
            err(`Injeksi gagal: ${JSON.stringify(result)}`);
            return;
        }
    } catch (e) {
        err(`Mock variance server tidak tersedia (port 3099): ${e}`);
        info("Pastikan daemon berjalan: bun simulation/sim-daemon.ts");
        return;
    }

    if (trigger) {
        await cmdTrigger();
    } else {
        info("Tambahkan --trigger untuk memicu scan segera.");
        info(`Scan akan berjalan otomatis pada cron berikutnya.`);
    }
}

function printHelp() {
    console.log(`
${C.bold}${C.cyan}sim-inject — ShieldYield Simulation Injector${C.r}

${C.bold}Usage:${C.r}
  ${C.cyan}bun simulation/sim-inject.ts <preset> [options]${C.r}
  ${C.cyan}bun simulation/sim-inject.ts [--flags] [options]${C.r}

${C.bold}Presets:${C.r}
  normal       AI=15,  TVL=+1.0%         → SAFE
  warning      AI=68,  TVL=-9.5%,  u=88% → WARNING
  critical     AI=92,  TVL=-26.0%, u=97% → WARNING (max off-chain)
  exploit      AI=96,  TVL=-45.0%, u=99% → WARNING (extreme)
  tvl-crash    AI=30,  TVL=-35.0%        → WARNING
  deposit      AI=15,  TVL=+5.0%         → SAFE
  high-util    AI=55,  u=94%             → WATCH/WARNING
  clear        Hapus scenario aktif

${C.bold}Custom flags:${C.r}
  --ai-score=N          Override AI threat score (0-100)
  --tvl-change=N        Override TVL change % (misal: -15)
  --utilization=N       Override protocol utilization % (misal: 95)
  --desc="..."          Label custom

${C.bold}Options:${C.r}
  --trigger             Trigger scan segera setelah inject
  --expires=N           Auto-clear scenario setelah N detik

${C.bold}Info:${C.r}
  status                Lihat status daemon + scenario aktif
  list                  Daftar semua preset + parameternya

${C.bold}Examples:${C.r}
  ${C.dim}bun simulation/sim-inject.ts warning --trigger${C.r}
  ${C.dim}bun simulation/sim-inject.ts exploit --trigger --expires=120${C.r}
  ${C.dim}bun simulation/sim-inject.ts --ai-score=80 --tvl-change=-15 --trigger${C.r}
  ${C.dim}bun simulation/sim-inject.ts clear --trigger${C.r}
  ${C.dim}bun simulation/sim-inject.ts status${C.r}
`);
}

// ─────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────

async function main() {
    const args = parseArgs(process.argv);

    // ── Info commands ──────────────────────────────────────────────────────
    if (args.status) { await cmdStatus(); return; }
    if (args.list)   { await cmdList();   return; }

    // ── Clear ──────────────────────────────────────────────────────────────
    if (args.clear)  { await cmdClear(args.trigger); return; }

    // ── Trigger only (tanpa inject) ────────────────────────────────────────
    const hasInjectData = args.preset || args.aiScore !== undefined ||
                          args.tvlChange !== undefined || args.utilization !== undefined;

    if (args.trigger && !hasInjectData) {
        label("Trigger Scan (tanpa perubahan scenario)");
        await cmdTrigger();
        return;
    }

    // ── Build scenario ─────────────────────────────────────────────────────
    let scenario: PresetDef;

    if (args.preset) {
        scenario = { ...PRESETS[args.preset] };
    } else if (hasInjectData) {
        // Custom scenario dari flags
        scenario = {
            type:  "custom",
            label: args.description ?? `Custom (AI=${args.aiScore ?? "?"}, TVL=${args.tvlChange ?? "?"}%, util=${args.utilization ?? "?"}%)`,
        };
    } else {
        // Tidak ada argumen — tampilkan help
        printHelp();
        return;
    }

    // Apply per-flag overrides on top of preset
    if (args.aiScore      !== undefined) scenario.aiScore           = args.aiScore;
    if (args.tvlChange    !== undefined) scenario.tvlChangePercent  = args.tvlChange;
    if (args.utilization  !== undefined) scenario.utilization       = args.utilization;
    if (args.description  !== undefined) scenario.label             = args.description;

    // Auto-expire
    if (args.expires !== undefined && args.expires > 0) {
        scenario.expiresAt = Math.floor(Date.now() / 1000) + args.expires;
    }

    await cmdInject(scenario, args.trigger);
}

main().catch((e) => {
    console.error(`${C.red}[sim-inject] Fatal error: ${e}${C.r}`);
    process.exit(1);
});
