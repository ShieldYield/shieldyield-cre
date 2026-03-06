/**
 * sim-inject-medium.ts
 * ─────────────────────────────────────────────────────────────
 * Injects a WARNING level scenario into the mock server.
 * Simulates a moderate AI threat score that should trigger a
 * partial withdrawal.
 * ─────────────────────────────────────────────────────────────
 */

import { MOCK_SERVER_PORT, type InjectedScenario } from "./bft/mock-variance-server";

const C = { r: "\x1b[0m", yellow: "\x1b[33m", bold: "\x1b[1m", dim: "\x1b[2m", cyan: "\x1b[36m" };

async function main() {
    const scenario: Omit<InjectedScenario, "injectedAt"> = {
        type: "warning",
        label: "AI Detected Suspicious GitHub Activity on Morpho",
        description: "AI Threat Score raised to 75 (WARNING) due to unresolved malicious commits.",
        aiScore: 75,
        // Using tvlChangePercent slightly negative to add to the score, but not enough to trigger CRITICAL
        tvlChangePercent: -5.5,
    };

    console.log(`\n${C.yellow}${"═".repeat(60)}${C.r}`);
    console.log(`${C.bold}${C.yellow}  Injecting Medium Risk Scenario (WARNING)${C.r}`);
    console.log(`${C.dim}  Target: MorphoAdapter${C.r}`);
    console.log(`${C.yellow}${"═".repeat(60)}${C.r}\n`);

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
