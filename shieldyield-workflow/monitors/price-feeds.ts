import {
    EVMClient,
    encodeCallMsg,
    bytesToHex,
    LAST_FINALIZED_BLOCK_NUMBER,
    type Runtime,
} from "@chainlink/cre-sdk";
import {
    type Address,
    encodeFunctionData,
    decodeFunctionResult,
    zeroAddress,
} from "viem";

import { AggregatorV3 } from "../../contracts/abi";
import type { PriceSignal, PriceFeedsConfig } from "./types";

// ========================================
// HELPER: Read single Chainlink Price Feed
// ========================================

/**
 * Reads latest price from a Chainlink AggregatorV3 contract.
 * Returns price as a number (converted from 8 decimals).
 * Uses 1 ChainRead call.
 */
export function readSinglePriceFeed(
    runtime: Runtime<any>,
    evmClient: EVMClient,
    feedAddress: string
): { price: number; updatedAt: number } {
    const callData = encodeFunctionData({
        abi: AggregatorV3,
        functionName: "latestRoundData",
    });

    const result = evmClient
        .callContract(runtime, {
            call: encodeCallMsg({
                from: zeroAddress,
                to: feedAddress as Address,
                data: callData,
            }),
            blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
        })
        .result();

    const decoded = decodeFunctionResult({
        abi: AggregatorV3,
        functionName: "latestRoundData",
        data: bytesToHex(result.data),
    });

    // decoded: [roundId, answer, startedAt, updatedAt, answeredInRound]
    const answer = (decoded as any)[1] as bigint;   // int256 price with 8 decimals
    const updatedAt = (decoded as any)[3] as bigint; // uint256 timestamp

    // Convert from 8 decimals to standard number
    const price = Number(answer) / 1e8;

    return { price, updatedAt: Number(updatedAt) };
}

// ========================================
// MAIN: Fetch all Chainlink prices
// ========================================

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/**
 * Fetches ETH/USD, BTC/USD, and USDC/USD prices from on-chain Chainlink Price Feeds.
 * Uses 2 ChainRead calls (ETH + BTC). USDC falls back to 1.0 if feed not available.
 *
 * @param runtime - CRE runtime instance
 * @param evmClient - EVMClient for the target chain
 * @param feedAddresses - Price feed contract addresses from config
 * @returns PriceSignal with ETH, BTC, USDC prices
 */
export function readChainlinkPrices(
    runtime: Runtime<any>,
    evmClient: EVMClient,
    feedAddresses: PriceFeedsConfig
): PriceSignal {
    let ethUsd = 0;
    let btcUsd = 0;
    let usdcUsd = 1.0;

    // --- ETH/USD ---
    try {
        const ethData = readSinglePriceFeed(runtime, evmClient, feedAddresses.ETH_USD);
        ethUsd = ethData.price;
        runtime.log(`📈 ETH/USD: $${ethUsd.toFixed(2)} (updated: ${ethData.updatedAt})`);
    } catch (err) {
        runtime.log(`⚠️ Failed to fetch ETH/USD price: ${err}`);
    }

    // --- BTC/USD ---
    try {
        const btcData = readSinglePriceFeed(runtime, evmClient, feedAddresses.BTC_USD);
        btcUsd = btcData.price;
        runtime.log(`📈 BTC/USD: $${btcUsd.toFixed(2)} (updated: ${btcData.updatedAt})`);
    } catch (err) {
        runtime.log(`⚠️ Failed to fetch BTC/USD price: ${err}`);
    }

    // --- USDC/USD (fallback to 1.0 if not available on this chain) ---
    if (feedAddresses.USDC_USD && feedAddresses.USDC_USD !== ZERO_ADDRESS) {
        try {
            const usdcData = readSinglePriceFeed(runtime, evmClient, feedAddresses.USDC_USD);
            usdcUsd = usdcData.price;
            runtime.log(`📈 USDC/USD: $${usdcUsd.toFixed(6)} (updated: ${usdcData.updatedAt})`);
        } catch (err) {
            runtime.log(`⚠️ Failed to fetch USDC/USD price, using fallback 1.0: ${err}`);
        }
    } else {
        runtime.log("📈 USDC/USD: $1.000000 (no feed available, using fallback)");
    }

    return { ethUsd, btcUsd, usdcUsd };
}
