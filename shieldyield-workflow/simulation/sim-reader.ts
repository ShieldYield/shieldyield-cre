/**
 * sim-reader.ts
 * ─────────────────────────────────────────────────────────────
 * On-chain reads untuk simulasi daemon.
 * Menggantikan EVMClient.callContract() dari CRE SDK dengan
 * viem publicClient.readContract() yang berjalan secara async.
 *
 * File ini TERPISAH dari kode CRE asli (monitors/onchain.ts).
 * ─────────────────────────────────────────────────────────────
 */

import { createPublicClient, http, type Address, type Chain } from "viem";
import { arbitrumSepolia } from "viem/chains";

import {
    AaveAdapter,
    CompoundAdapter,
    MorphoAdapter,
    YieldMaxAdapter,
    AggregatorV3,
} from "../../contracts/abi";
import type { AdapterSnapshot, PriceSignal } from "../monitors/types";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

// ─────────────────────────────────────────────────
// CLIENT FACTORY
// ─────────────────────────────────────────────────

export function createSimPublicClient(rpcUrl: string, chain: Chain = arbitrumSepolia) {
    return createPublicClient({
        chain,
        transport: http(rpcUrl),
    });
}

export type SimPublicClient = ReturnType<typeof createSimPublicClient>;

// ─────────────────────────────────────────────────
// BACA SATU ADAPTER
// ─────────────────────────────────────────────────

async function readOneAdapter(
    client: SimPublicClient,
    name: string,
    address: Address,
    abi: typeof AaveAdapter
): Promise<AdapterSnapshot> {
    // Paralel: ambil getCurrentAPY, isHealthy, getBalanceBreakdown sekaligus
    const [apy, isHealthy, breakdown] = await Promise.all([
        client.readContract({ address, abi, functionName: "getCurrentAPY" }),
        client.readContract({ address, abi, functionName: "isHealthy" }),
        client.readContract({ address, abi, functionName: "getBalanceBreakdown" }),
    ]);

    // getBalanceBreakdown returns: (principal, accruedYield, currentBalance)
    const [principal, accruedYield, balance] = breakdown as [bigint, bigint, bigint];

    return {
        name,
        address,
        balance,
        apy: apy as bigint,
        isHealthy: isHealthy as boolean,
        principal,
        accruedYield,
    };
}

// ─────────────────────────────────────────────────
// BACA SEMUA ADAPTER
// ─────────────────────────────────────────────────

export async function readAllAdaptersSim(
    client: SimPublicClient,
    addresses: {
        aaveAdapter?: string;
        compoundAdapter?: string;
        morphoAdapter?: string;
        yieldMaxAdapter?: string;
    }
): Promise<AdapterSnapshot[]> {
    const configs = [
        { name: "AaveAdapter",     address: addresses.aaveAdapter,     abi: AaveAdapter },
        { name: "CompoundAdapter", address: addresses.compoundAdapter,  abi: CompoundAdapter },
        { name: "MorphoAdapter",   address: addresses.morphoAdapter,    abi: MorphoAdapter },
        { name: "YieldMaxAdapter", address: addresses.yieldMaxAdapter,  abi: YieldMaxAdapter },
    ].filter((c) => !!c.address);

    // Baca semua adapter secara paralel
    const results = await Promise.all(
        configs.map((c) =>
            readOneAdapter(
                client,
                c.name,
                c.address as Address,
                c.abi as typeof AaveAdapter
            )
        )
    );

    return results;
}

// ─────────────────────────────────────────────────
// BACA CHAINLINK PRICE FEEDS
// ─────────────────────────────────────────────────

async function readOneFeed(client: SimPublicClient, address: string): Promise<number> {
    if (!address || address === ZERO_ADDRESS) return 0;
    try {
        const data = await client.readContract({
            address: address as Address,
            abi: AggregatorV3,
            functionName: "latestRoundData",
        });
        // data: [roundId, answer, startedAt, updatedAt, answeredInRound]
        // answer menggunakan 8 decimal places
        return Number(data[1]) / 1e8;
    } catch {
        return 0;
    }
}

export async function readPriceFeedsSim(
    client: SimPublicClient,
    feeds: { ETH_USD: string; BTC_USD: string; USDC_USD: string }
): Promise<PriceSignal> {
    const [ethUsd, btcUsd, usdcUsdRaw] = await Promise.all([
        readOneFeed(client, feeds.ETH_USD),
        readOneFeed(client, feeds.BTC_USD),
        readOneFeed(client, feeds.USDC_USD),
    ]);

    return {
        ethUsd,
        btcUsd,
        usdcUsd: usdcUsdRaw || 1.0, // fallback ke 1.0 jika tidak tersedia
    };
}
