/**
 * sim-inject-critical.ts
 * ─────────────────────────────────────────────────────────────
 * Injects a CRITICAL level scenario into the mock server.
 * Simulates a severe TVL drop and Honeypot detection that
 * should trigger a full emergency withdrawal.
 * ─────────────────────────────────────────────────────────────
 */

import { MOCK_SERVER_PORT, type InjectedScenario } from "./bft/mock-variance-server";

const C = { r: "\x1b[0m", red: "\x1b[31m", bold: "\x1b[1m", dim: "\x1b[2m", cyan: "\x1b[36m" };

async function main() {
    const scenario: Omit<InjectedScenario, "injectedAt"> = {
        type: "critical",
        label: "Massive TVL Outflow on YieldMax (Bank Run)",
        description: "Detected >20% TVL drop. Suspected exploit or bank run in progress.",
        // A drop of more than 20% triggers the BANK_RUN anomaly (CRITICAL)
        tvlChangePercent: -25.5,
        aiScore: 90,
    };

    console.log(`\n${C.red}${"═".repeat(60)}${C.r}`);
    console.log(`${C.bold}${C.red}  Injecting Critical Risk Scenario (CRITICAL)${C.r}`);
    console.log(`${C.dim}  Target: YieldMaxAdapter${C.r}`);
    console.log(`${C.red}${"═".repeat(60)}${C.r}\n`);

    try {
        const res = await fetch(`http://localhost:${MOCK_SERVER_PORT}/inject`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(scenario),
        });

        if (res.ok) {
            console.log(`✅ ${C.bold}Scenario successfully injected into Mock Server!${C.r}`);
            console.log(`${C.dim}The next BFT Simulation round will see these modified values.${C.r}`);
            console.log(`\n${C.cyan}👉 Next step: Run the BFT Simulation to reach consensus on this threat.${C.r}`);
        } else {
            console.error(`${C.red}Failed to inject scenario: ${res.statusText}${C.r}`);
            const text = await res.text();
            console.error(text);
        }
    } catch (e) {
        console.error(`❌ Could not connect to Mock Server. Is 'sim:daemon' running?`);
        console.error(e);
        process.exit(1);
    }
}

main().catch(console.error);
