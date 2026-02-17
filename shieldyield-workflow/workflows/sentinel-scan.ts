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
    readChainlinkPrices,
    readSinglePriceFeed,
    fetchAllOffchainSignals,
    fetchTvlHistory,
    computeAllRiskScores,
    detectAllAnomalies,
    getHighestSeverity,
} from "../monitors";
import type { OffchainSignals, PriceSignal } from "../monitors";

import { RiskRegistry } from "../../contracts/abi";
import { createEvmClient, type Config } from "../types/config";

// CRE limits
const MAX_CHAIN_READS = 15;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

// ========================================
// HELPERS
// ========================================

/** Check if a chain config has any adapter addresses configured */
function hasAdapters(addresses: Record<string, string | undefined>): boolean {
    return !!(
        addresses.aaveAdapter ||
        addresses.compoundAdapter ||
        addresses.morphoAdapter ||
        addresses.yieldMaxAdapter
    );
}

/** Count how many adapters are configured (each uses 3 ChainRead calls) */
function countAdapters(addresses: Record<string, string | undefined>): number {
    let count = 0;
    if (addresses.aaveAdapter) count++;
    if (addresses.compoundAdapter) count++;
    if (addresses.morphoAdapter) count++;
    if (addresses.yieldMaxAdapter) count++;
    return count;
}

/** Count how many price feed reads a chain needs */
function countPriceFeedReads(priceFeeds: { ETH_USD: string; BTC_USD: string; USDC_USD: string }): number {
    let count = 0;
    if (priceFeeds.ETH_USD && priceFeeds.ETH_USD !== ZERO_ADDRESS) count++;
    if (priceFeeds.BTC_USD && priceFeeds.BTC_USD !== ZERO_ADDRESS) count++;
    if (priceFeeds.USDC_USD && priceFeeds.USDC_USD !== ZERO_ADDRESS) count++;
    return count;
}

// ========================================
// WORKFLOW 1+2: SENTINEL SCAN + THREAT ASSESSMENT (CRON)
// ========================================

export const onCronTrigger = (runtime: Runtime<Config>): string => {
    runtime.log("=".repeat(60));
    runtime.log("🛡️  WORKFLOW 1+2: SENTINEL SCAN + THREAT ASSESSMENT");
    runtime.log("Trigger: Cron (scheduled monitoring)");
    runtime.log(`Chains configured: ${runtime.config.evms.length}`);
    runtime.log("=".repeat(60));

    let chainReadsUsed = 0;
    const allResults: any[] = [];

    // Collect cross-chain prices for resolution
    const crossChainPrices: { chainName: string; prices: PriceSignal }[] = [];

    // ============================================================
    // PHASE 1: Read on-chain data from all chains (budget-aware)
    // ============================================================

    // Track primary chain data (first chain with adapters)
    let primaryChainAdapters: ReturnType<typeof readAllAdapters> = [];
    let primaryChainPrices: PriceSignal = { ethUsd: 0, btcUsd: 0, usdcUsd: 1.0 };
    let primaryChainName = "";
    let primaryAddresses: Record<string, string | undefined> = {};

    // Track global prices to save budget
    let globalPrices: PriceSignal | null = null;

    for (const evm of runtime.config.evms) {
        const addresses = evm.addresses[0] || {};
        const priceFeeds = evm.priceFeeds || runtime.config.priceFeeds;
        const chainHasAdapters = hasAdapters(addresses);

        runtime.log(`\n${"─".repeat(50)}`);
        runtime.log(`📡 Chain: ${evm.chainName}`);
        runtime.log(`   Adapters: ${chainHasAdapters ? countAdapters(addresses) : "none"}`);
        runtime.log(`   ChainReads used: ${chainReadsUsed}/${MAX_CHAIN_READS}`);

        // ---- 1. Read Adapter Data (3 reads per adapter) ----
        if (chainHasAdapters) {
            const adapterCount = countAdapters(addresses);
            const adapterReads = adapterCount * 3;

            if (chainReadsUsed + adapterReads <= MAX_CHAIN_READS) {
                const adapters = readAllAdapters(runtime, evm.chainName, addresses);
                chainReadsUsed += adapterReads;

                if (primaryChainAdapters.length === 0) {
                    primaryChainAdapters = adapters;
                    primaryChainName = evm.chainName;
                    primaryAddresses = addresses;
                }
            } else {
                runtime.log(`⚠️ Budget exhausted — skipping adapter reads on ${evm.chainName}`);
            }
        }

        // ---- 2. Read Price Feeds (Only if globalPrices not yet fetched) ----
        if (priceFeeds && !globalPrices) {
            const feedReads = countPriceFeedReads(priceFeeds);

            if (chainReadsUsed + feedReads <= MAX_CHAIN_READS) {
                runtime.log("📈 Fetching master prices...");
                const evmClient = createEvmClient(evm.chainName);
                globalPrices = readChainlinkPrices(runtime, evmClient, priceFeeds);
                chainReadsUsed += feedReads;

                if (evm.chainName === primaryChainName || primaryChainName === "") {
                    primaryChainPrices = globalPrices;
                }
            }
        }

        // ---- 3. Cross-chain price proxy fallback (if globalPrices still null) ----
        if (!globalPrices) {
            runtime.log(`⏭️ Skipping price reads on ${evm.chainName} (budget optimization)`);
        }
    }

    // Set fallback if still null
    if (globalPrices) {
        primaryChainPrices = globalPrices;
    }

    runtime.log(`\n${"─".repeat(50)}`);
    runtime.log(`📊 Total ChainReads used: ${chainReadsUsed}/${MAX_CHAIN_READS}`);

    // ============================================================
    // PHASE 2: Cross-chain price resolution
    // ============================================================

    // If primary chain USDC is fallback (1.0 from zero address), look for cross-chain USDC
    if (primaryChainPrices.usdcUsd === 1.0) {
        for (const { chainName, prices } of crossChainPrices) {
            if (chainName !== primaryChainName && prices.usdcUsd !== 1.0 && prices.usdcUsd > 0) {
                runtime.log(`🔗 Cross-chain USDC/USD: $${prices.usdcUsd.toFixed(6)} (from ${chainName})`);
                primaryChainPrices = { ...primaryChainPrices, usdcUsd: prices.usdcUsd };
                break;
            }
        }
    }

    // If primary chain has no ETH/BTC prices, try cross-chain
    if (primaryChainPrices.ethUsd === 0) {
        for (const { chainName, prices } of crossChainPrices) {
            if (prices.ethUsd > 0) {
                primaryChainPrices = { ...primaryChainPrices, ethUsd: prices.ethUsd };
                runtime.log(`🔗 Cross-chain ETH/USD: $${prices.ethUsd.toFixed(2)} (from ${chainName})`);
                break;
            }
        }
    }
    if (primaryChainPrices.btcUsd === 0) {
        for (const { chainName, prices } of crossChainPrices) {
            if (prices.btcUsd > 0) {
                primaryChainPrices = { ...primaryChainPrices, btcUsd: prices.btcUsd };
                runtime.log(`🔗 Cross-chain BTC/USD: $${prices.btcUsd.toFixed(2)} (from ${chainName})`);
                break;
            }
        }
    }

    // ============================================================
    // PHASE 3: Risk assessment (on primary chain adapters)
    // ============================================================

    if (primaryChainAdapters.length === 0) {
        runtime.log("No adapters found on any chain — nothing to assess");
        return JSON.stringify({
            status: "monitoring_complete",
            timestamp: Date.now(),
            chainReadsUsed,
            results: [],
        });
    }

    runtime.log(`\n${"=".repeat(60)}`);
    runtime.log(`🔍 Risk Assessment — ${primaryChainName}`);
    runtime.log(`   Adapters: ${primaryChainAdapters.length}, Prices: ETH=$${primaryChainPrices.ethUsd.toFixed(2)} BTC=$${primaryChainPrices.btcUsd.toFixed(2)} USDC=$${primaryChainPrices.usdcUsd.toFixed(6)}`);

    // ---- Fetch Off-Chain Signals (HTTP: GitHub, GoPlus, Etherscan) ----
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
    const httpSignals = fetchAllOffchainSignals(runtime, {
        githubUrl: primaryAdapter.github,
        goPlusUrl,
        teamWalletUrl,
    });

    // ---- Compute TVL from on-chain balance + price ----
    const usdcPrice = primaryChainPrices.usdcUsd || 1.0;
    let totalBalance = 0n;
    let totalPrincipal = 0n;
    for (const a of primaryChainAdapters) {
        totalBalance += a.balance;
        totalPrincipal += a.principal;
    }
    const currentTvl = Number(totalBalance) * usdcPrice / 1e6;

    const fallbackChangePercent = totalPrincipal > 0n
        ? ((Number(totalBalance) - Number(totalPrincipal)) / Number(totalPrincipal)) * 100
        : 0;

    // ---- Record TVL snapshot & get historical change ----
    let tvlChangePercent = fallbackChangePercent;
    try {
        const tvlHistoryUrl = apisConfig.tvlHistoryUrl;
        if (tvlHistoryUrl) {
            runtime.log("Recording TVL snapshot & fetching historical change...");
            const tvlHistory = fetchTvlHistory(
                runtime, tvlHistoryUrl, currentTvl, Math.floor(Date.now() / 1000)
            );
            if (tvlHistory.tvlChangePercent !== 0 || tvlHistory.currentTvl > 0) {
                tvlChangePercent = tvlHistory.tvlChangePercent;
                runtime.log(`📊 TVL History: change=${tvlChangePercent.toFixed(2)}% (from ~1hr ago)`);
            } else {
                runtime.log(`📊 TVL History: no prior data yet, using fallback`);
            }
        }
    } catch (err) {
        runtime.log(`⚠️ TVL history unavailable, using fallback: ${err}`);
    }

    // Assemble full OffchainSignals
    const offchain: OffchainSignals = {
        prices: primaryChainPrices,
        tvl: { currentTvl, tvlChangePercent },
        ...httpSignals,
    };
    runtime.log(`📊 TVL: $${currentTvl.toFixed(2)}, change=${tvlChangePercent.toFixed(2)}%`);

    // ---- Compute Risk Scores ----
    runtime.log("Computing risk scores...");
    const riskScores = computeAllRiskScores(primaryChainAdapters, [], offchain);

    for (const [name, { score, level }] of Object.entries(riskScores)) {
        runtime.log(`${name}: score=${score}/100, level=${level}`);
    }

    // ---- Anomaly Detection ----
    runtime.log("Running anomaly detection...");
    const anomalies = detectAllAnomalies(primaryChainAdapters, offchain);
    const highestSeverity = getHighestSeverity(anomalies);

    if (anomalies.length > 0) {
        runtime.log(`Anomalies detected: ${anomalies.length}`);
        for (const a of anomalies) {
            runtime.log(`  [${a.severity}] ${a.type}: ${a.message}`);
        }
    } else {
        runtime.log("No anomalies detected");
    }

    // ---- Write Risk Scores On-Chain (if significant change) ----
    const hasWarningOrCritical = Object.values(riskScores).some(
        (r) => r.level === "WARNING" || r.level === "CRITICAL"
    );

    if (hasWarningOrCritical && primaryAddresses.riskRegistry) {
        runtime.log("WARNING/CRITICAL detected — updating on-chain risk scores...");

        const evmClient = createEvmClient(primaryChainName);
        const protocols: Address[] = [];
        const scores: number[] = [];
        const reasons: string[] = [];

        const adapterNameToAddress: Record<string, string | undefined> = {
            AaveAdapter: primaryAddresses.aaveAdapter,
            CompoundAdapter: primaryAddresses.compoundAdapter,
            MorphoAdapter: primaryAddresses.morphoAdapter,
            YieldMaxAdapter: primaryAddresses.yieldMaxAdapter,
        };

        for (const [name, { score, level }] of Object.entries(riskScores)) {
            const addr = adapterNameToAddress[name];
            if (addr) {
                protocols.push(addr as Address);
                scores.push(score);

                const adapterAnomalies = anomalies.filter((a) => a.adapter === name);
                const reason =
                    adapterAnomalies.length > 0
                        ? adapterAnomalies.map((a) => `${a.type}: ${a.message}`).join("; ")
                        : `Risk score: ${score}, Level: ${level}`;
                reasons.push(reason);
            }
        }

        try {
            const txData = encodeFunctionData({
                abi: RiskRegistry,
                functionName: "batchUpdateRiskScores",
                args: [protocols, scores, reasons],
            });

            evmClient
                .writeReport(runtime, {
                    receiver: primaryAddresses.riskRegistry,
                    report: new Report({ rawReport: txData }),
                })
                .result();

            runtime.log("Risk scores written on-chain successfully");
        } catch (err) {
            runtime.log(`Failed to write risk scores on-chain: ${err}`);
        }
    }

    allResults.push({
        chain: primaryChainName,
        chainsMonitored: runtime.config.evms.map((e) => e.chainName),
        chainReadsUsed,
        crossChainPricesUsed: crossChainPrices
            .filter((c) => c.chainName !== primaryChainName)
            .map((c) => c.chainName),
        adapters: primaryChainAdapters.map((a) => ({
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

    return JSON.stringify({
        status: "monitoring_complete",
        timestamp: Date.now(),
        chainReadsUsed,
        results: allResults,
    });
};
