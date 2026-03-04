/**
 * mock-variance-server.ts
 * ─────────────────────────────────────────────────────────────
 * HTTP server (port 3099) yang menambahkan variance deterministik
 * berbeda per node ID pada data off-chain.
 *
 * Tujuan: mensimulasikan bahwa setiap node DON mendapat sinyal
 * yang sedikit berbeda karena network latency / data versioning.
 * Ini yang membuat BFT penting — satu node yang "eror" tidak bisa
 * mendistorsi keseluruhan konsensus.
 *
 * Variance ranges:
 *   ai_threat_score  ±15  (salt 1)
 *   confidence       ±0.15 (salt 2)
 *   tvlChangePercent ±0.5% (salt 3)
 *
 * ═══════════════════════════════════════════════════════════
 * INJECTION API  (diakses oleh sim-inject.ts)
 * ═══════════════════════════════════════════════════════════
 *   POST   /inject       body: InjectedScenario → aktifkan skenario
 *   DELETE /inject                              → hapus skenario aktif
 *   GET    /inject-state                        → lihat skenario aktif
 *
 * Saat skenario aktif:
 *   - aiScore menggantikan nilai upstream sebelum variance
 *   - tvlChangePercent menggantikan nilai upstream sebelum variance
 *   - utilization override untuk /api/defi-metrics
 *   Node tetap mendapat variance berbeda → BFT tetap relevan.
 * ═══════════════════════════════════════════════════════════
 *
 * Routes data:
 *   GET /api/ai-sentinel?protocol=X&node=N
 *   GET /api/tvl-history?tvl=X&ts=Y&node=N
 *   GET /api/defi-metrics?node=N
 *   (semua route lain: pass-through ke upstream localhost:3000)
 *
 * Dijalankan oleh sim-daemon.ts sebelum BFT round dimulai.
 * ─────────────────────────────────────────────────────────────
 */

const UPSTREAM_BASE = "http://localhost:3000";
export const MOCK_SERVER_PORT = 3099;

// ─────────────────────────────────────────────────
// INJECTION STATE
// ─────────────────────────────────────────────────

/**
 * Skenario yang sedang aktif diinjeksi.
 * Semua field opsional kecuali type dan label.
 * Jika field tidak di-set, nilai dari upstream/default tetap digunakan.
 */
export interface InjectedScenario {
    type:               string;   // "normal" | "warning" | "critical" | "exploit" | ...
    label:              string;   // Label untuk log display
    description?:       string;   // Deskripsi skenario

    // Off-chain overrides — null = gunakan upstream/default
    aiScore?:           number;   // 0-100, override ai_threat_score SEBELUM variance
    tvlChangePercent?:  number;   // %, override tvlChangePercent SEBELUM variance
    utilization?:       number;   // %, override utilization di defi-metrics

    // Metadata
    injectedAt:         number;   // unix timestamp (detik)
    expiresAt?:         number;   // unix timestamp — auto-clear jika terlewat
}

let injectedScenario: InjectedScenario | null = null;

function getActiveScenario(): InjectedScenario | null {
    if (!injectedScenario) return null;

    // Auto-expire: hapus jika sudah melewati expiresAt
    if (
        injectedScenario.expiresAt &&
        Math.floor(Date.now() / 1000) > injectedScenario.expiresAt
    ) {
        console.log(
            `\x1b[2m[BFT-MOCK] Scenario "${injectedScenario.label}" kadaluarsa — dihapus otomatis\x1b[0m`
        );
        injectedScenario = null;
    }

    return injectedScenario;
}

// ─────────────────────────────────────────────────
// VARIANCE FUNCTIONS
// ─────────────────────────────────────────────────

/**
 * Nilai deterministik antara -1 dan +1 berdasarkan nodeId dan salt.
 * Menggunakan sin(nodeId × prime1 + salt × prime2) untuk distribusi baik.
 * Node yang sama selalu menghasilkan offset yang sama → reproducible.
 */
function nodeVariance(nodeId: number, salt: number): number {
    return Math.sin(nodeId * 31_337 + salt * 7_919);
}

function clamp(val: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, val));
}

// ─────────────────────────────────────────────────
// UPSTREAM PROXY
// ─────────────────────────────────────────────────

async function proxyUpstream(
    pathname:     string,
    searchParams: URLSearchParams
): Promise<any | null> {
    try {
        const upstreamParams = new URLSearchParams(searchParams);
        upstreamParams.delete("node"); // jangan teruskan param node ke upstream
        upstreamParams.set("sim", "true"); // sinyal ke FE API routes → gunakan mock data

        const qs  = upstreamParams.toString();
        const url = `${UPSTREAM_BASE}${pathname}${qs ? "?" + qs : ""}`;

        const resp = await fetch(url, {
            signal:  AbortSignal.timeout(8_000),
            headers: { "User-Agent": "ShieldYield-BFT-MockServer" },
        });

        if (!resp.ok) return null;
        return await resp.json();
    } catch {
        return null;
    }
}

// ─────────────────────────────────────────────────
// REQUEST HANDLER
// ─────────────────────────────────────────────────

async function handleRequest(req: Request): Promise<Response> {
    const url    = new URL(req.url);
    const nodeId = parseInt(url.searchParams.get("node") || "0", 10);
    const path   = url.pathname;
    const method = req.method;

    // ─── Injection management ──────────────────────────────────────────────

    if (method === "POST" && path === "/inject") {
        try {
            const body = await req.json() as Omit<InjectedScenario, "injectedAt">;
            if (!body.type || !body.label) {
                return Response.json(
                    { error: "Body harus mengandung 'type' dan 'label'" },
                    { status: 400 }
                );
            }
            injectedScenario = { ...body, injectedAt: Math.floor(Date.now() / 1000) };
            console.log(
                `\x1b[35m[BFT-MOCK]\x1b[0m \x1b[1mScenario diinjeksi:\x1b[0m ${injectedScenario.label}` +
                (injectedScenario.aiScore       !== undefined ? `  AI=${injectedScenario.aiScore}`      : "") +
                (injectedScenario.tvlChangePercent !== undefined ? `  TVL%=${injectedScenario.tvlChangePercent}%` : "") +
                (injectedScenario.utilization   !== undefined ? `  util=${injectedScenario.utilization}%` : "") +
                (injectedScenario.expiresAt     !== undefined
                    ? `  (expires in ${injectedScenario.expiresAt - Math.floor(Date.now() / 1000)}s)`
                    : "")
            );
            return Response.json({ ok: true, scenario: injectedScenario });
        } catch {
            return Response.json({ error: "JSON body tidak valid" }, { status: 400 });
        }
    }

    if (method === "DELETE" && path === "/inject") {
        const prev = injectedScenario?.label ?? null;
        injectedScenario = null;
        console.log(`\x1b[2m[BFT-MOCK] Scenario dihapus: ${prev ?? "(tidak ada)"}\x1b[0m`);
        return Response.json({ ok: true, cleared: prev });
    }

    if (path === "/inject-state") {
        return Response.json({ scenario: getActiveScenario() });
    }

    // ─── Data routes — proxy upstream + variance + injection ──────────────

    const upstream = await proxyUpstream(path, url.searchParams);
    const inj      = getActiveScenario();

    // ── /api/ai-sentinel ──────────────────────────────────────────────────
    if (path === "/api/ai-sentinel") {
        // Jika skenario aktif → override base score; variance tetap berlaku di atasnya
        const baseScore = inj?.aiScore !== undefined
            ? inj.aiScore
            : (upstream ? (Number(upstream.ai_threat_score) || 30) : 30);
        const baseConf  = upstream ? (Number(upstream.confidence) || 0.3) : 0.3;

        const variedScore = clamp(Math.round(baseScore + nodeVariance(nodeId, 1) * 15), 0, 100);
        const variedConf  = Math.round(
            clamp(baseConf + nodeVariance(nodeId, 2) * 0.15, 0.05, 1.0) * 1000
        ) / 1000;

        const github = upstream?.github ?? {
            recentCommits:   0,
            openIssues:      0,
            lastPushDaysAgo: 999,
        };

        const reasoning = inj
            ? `[INJECTED: ${inj.label}] AI Threat Score base=${baseScore}/100`
            : (upstream?.reasoning ?? `[Node ${nodeId}] AI Sentinel unavailable — default score`);

        return Response.json({
            github,
            ai_threat_score: variedScore,
            confidence:      variedConf,
            reasoning,
            recommendation:  upstream?.recommendation ?? "HOLD",
            signals:         upstream?.signals        ?? [],
            ...(inj ? { _injected: inj.type } : {}),
        });
    }

    // ── /api/tvl-history ──────────────────────────────────────────────────
    if (path === "/api/tvl-history") {
        const currentTvl = parseFloat(url.searchParams.get("tvl") || "0");

        // Jika skenario aktif → override base TVL change
        const baseTvlChg = inj?.tvlChangePercent !== undefined
            ? inj.tvlChangePercent
            : (upstream ? (Number(upstream.tvlChangePercent) || 0) : 0);
        const baseTvl    = upstream ? (Number(upstream.currentTvl) || currentTvl) : currentTvl;

        const variedChange = Math.round(
            (baseTvlChg + nodeVariance(nodeId, 3) * 0.5) * 100
        ) / 100;

        return Response.json({
            currentTvl:       baseTvl,
            tvlChangePercent: variedChange,
            ...(inj ? { _injected: inj.type } : {}),
        });
    }

    // ── /api/defi-metrics ─────────────────────────────────────────────────
    if (path === "/api/defi-metrics") {
        let result: Record<string, any> = upstream ?? {};

        // Override utilization jika diinjeksi
        if (inj?.utilization !== undefined) {
            const util = inj.utilization;
            if (result.aave)     result = { ...result, aave:     { ...result.aave,     utilization: util } };
            if (result.compound) result = { ...result, compound: { ...result.compound, utilization: util } };
        }
        if (inj) result = { ...result, _injected: inj.type };

        if (Object.keys(result).length > 0) return Response.json(result);

        return new Response(
            JSON.stringify({ error: "upstream unavailable" }),
            { status: 502, headers: { "Content-Type": "application/json" } }
        );
    }

    // ── pass-through (semua route lain) ───────────────────────────────────
    if (upstream !== null) return Response.json(upstream);

    return new Response(
        JSON.stringify({ error: "upstream unavailable" }),
        { status: 502, headers: { "Content-Type": "application/json" } }
    );
}

// ─────────────────────────────────────────────────
// SERVER START
// ─────────────────────────────────────────────────

export function startMockVarianceServer(): () => void {
    const server = Bun.serve({
        port:  MOCK_SERVER_PORT,
        fetch: handleRequest,
    });

    console.log(
        `\x1b[36m[BFT-MOCK]\x1b[0m Mock variance server berjalan di ` +
        `\x1b[1mhttp://localhost:${MOCK_SERVER_PORT}\x1b[0m`
    );
    console.log(
        `\x1b[2m[BFT-MOCK] Data: /api/ai-sentinel (±15 AI) | /api/tvl-history (±0.5% TVL) | pass-through\x1b[0m`
    );
    console.log(
        `\x1b[2m[BFT-MOCK] Inject: POST /inject | DELETE /inject | GET /inject-state\x1b[0m`
    );

    return () => {
        server.stop();
        console.log("\x1b[2m[BFT-MOCK] Mock variance server dihentikan\x1b[0m");
    };
}
