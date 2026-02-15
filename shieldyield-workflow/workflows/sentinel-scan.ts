import {
    type Runtime,
    Report,
} from "@chainlink/cre-sdk";
import {
    type Address,
    encodeFunctionData,
} from "viem";

import {
    readAllAdapters,
    fetchAllOffchainSignals,
    computeAllRiskScores,
    detectAllAnomalies,
    getHighestSeverity,
} from "../monitors";

import { RiskRegistry } from "../../contracts/abi";
import { createEvmClient, type Config } from "../types/config";

// ========================================
// WORKFLOW 1+2: SENTINEL SCAN + THREAT ASSESSMENT (CRON)
// ========================================

export const onCronTrigger = (runtime: Runtime<Config>): string => {
    runtime.log("=".repeat(60));
    runtime.log("🛡️  WORKFLOW 1+2: SENTINEL SCAN + THREAT ASSESSMENT");
    runtime.log("Trigger: Cron (scheduled monitoring)");
    runtime.log("=".repeat(60));

    const allResults: any[] = [];

    for (const evm of runtime.config.evms) {
        runtime.log(`\nMonitoring chain: ${evm.chainName}`);

        const addresses = evm.addresses[0];
        const evmClient = createEvmClient(evm.chainName);

        // ---- STEP 1: Read On-Chain Adapter Data ----
        runtime.log("Reading on-chain adapter data...");
        const adapters = readAllAdapters(runtime, evm.chainName, {
            aaveAdapter: addresses.aaveAdapter,
            compoundAdapter: addresses.compoundAdapter,
            morphoAdapter: addresses.morphoAdapter,
            yieldMaxAdapter: addresses.yieldMaxAdapter,
        });

        // ---- STEP 2: Fetch Off-Chain Signals ----
        runtime.log("Fetching off-chain signals...");
        const apisConfig = runtime.config.offchainApis;
        const primaryAdapter = apisConfig.adapters[apisConfig.primaryProtocol];
        if (!primaryAdapter) {
            runtime.log(`ERROR: Primary protocol '${apisConfig.primaryProtocol}' not found in adapter config`);
            return JSON.stringify({ status: "error", error: "Invalid primaryProtocol config" });
        }
        const goPlusUrl = `https://api.gopluslabs.io/api/v1/token_security/${apisConfig.goPlusChainId}?contract_addresses=${primaryAdapter.goPlusTokenAddress}`;
        const teamWalletUrl = `https://api.arbiscan.io/api?module=account&action=balance&address=${primaryAdapter.teamWallet}&tag=latest&apikey=YourApiKeyToken`;

        runtime.log(`Using primary protocol: ${apisConfig.primaryProtocol}`);
        const offchain = fetchAllOffchainSignals(runtime, {
            defiLlamaSlug: primaryAdapter.defiLlamaSlug,
            githubUrl: primaryAdapter.github,
            goPlusUrl,
            teamWalletUrl,
        });

        // ---- STEP 3: Compute Risk Scores ----
        runtime.log("Computing risk scores...");
        const riskScores = computeAllRiskScores(adapters, [], offchain);

        for (const [name, { score, level }] of Object.entries(riskScores)) {
            runtime.log(`${name}: score=${score}/100, level=${level}`);
        }

        // ---- STEP 4: Anomaly Detection ----
        runtime.log("Running anomaly detection...");
        const anomalies = detectAllAnomalies(adapters, offchain);
        const highestSeverity = getHighestSeverity(anomalies);

        if (anomalies.length > 0) {
            runtime.log(`Anomalies detected: ${anomalies.length}`);
            for (const a of anomalies) {
                runtime.log(`  [${a.severity}] ${a.type}: ${a.message}`);
            }
        } else {
            runtime.log("No anomalies detected");
        }

        // ---- STEP 5: Write Risk Scores On-Chain (if significant change) ----
        const hasWarningOrCritical = Object.values(riskScores).some(
            (r) => r.level === "WARNING" || r.level === "CRITICAL"
        );

        if (hasWarningOrCritical) {
            runtime.log("WARNING/CRITICAL detected — updating on-chain risk scores...");

            // Build batch update arrays
            const protocols: Address[] = [];
            const scores: number[] = [];
            const reasons: string[] = [];

            const adapterNameToAddress: Record<string, string> = {
                AaveAdapter: addresses.aaveAdapter,
                CompoundAdapter: addresses.compoundAdapter,
                MorphoAdapter: addresses.morphoAdapter,
                YieldMaxAdapter: addresses.yieldMaxAdapter,
            };

            for (const [name, { score, level }] of Object.entries(riskScores)) {
                const addr = adapterNameToAddress[name];
                if (addr) {
                    protocols.push(addr as Address);
                    scores.push(score);

                    // Build reason string from anomalies for this adapter
                    const adapterAnomalies = anomalies.filter((a) => a.adapter === name);
                    const reason =
                        adapterAnomalies.length > 0
                            ? adapterAnomalies.map((a) => `${a.type}: ${a.message}`).join("; ")
                            : `Risk score: ${score}, Level: ${level}`;
                    reasons.push(reason);
                }
            }

            try {
                // Write risk scores to RiskRegistry via batchUpdateRiskScores
                const txData = encodeFunctionData({
                    abi: RiskRegistry,
                    functionName: "batchUpdateRiskScores",
                    args: [protocols, scores, reasons],
                });

                // CRE writeReport: pass encoded calldata via Report with rawReport
                evmClient
                    .writeReport(runtime, {
                        receiver: addresses.riskRegistry,
                        report: new Report({ rawReport: txData }),
                    })
                    .result();

                runtime.log("Risk scores written on-chain successfully");
            } catch (err) {
                runtime.log(`Failed to write risk scores on-chain: ${err}`);
            }
        }

        allResults.push({
            chain: evm.chainName,
            adapters: adapters.map((a) => ({
                name: a.name,
                balance: a.balance.toString(),
                apy: a.apy.toString(),
                isHealthy: a.isHealthy,
            })),
            riskScores,
            anomalies: anomalies.map((a) => ({
                type: a.type,
                severity: a.severity,
                adapter: a.adapter,
                message: a.message,
            })),
            highestSeverity,
        });
    }

    return JSON.stringify({
        status: "monitoring_complete",
        timestamp: Date.now(),
        results: allResults,
    });
};
