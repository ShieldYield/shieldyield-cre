/**
 * sim-bft.ts
 * ─────────────────────────────────────────────────────────────
 * BFT Round Simulation for Frontend display.
 * Emulates the DON network executing the Sentinel Scan with 21 nodes.
 *
 * 1. Reads on-chain state deterministically
 * 2. Runs 21 worker nodes
 * 3. Calculates consensus (median scores)
 * 4. Checks if ≥ 15 nodes agree
 * 5. If consensus reached, writes to RiskRegistry
 * ─────────────────────────────────────────────────────────────
 */

import * as fs from "fs";
import * as path from "path";
import {
    createWalletClient,
    createPublicClient,
    http,
    type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia } from "viem/chains";

import { RiskRegistry } from "../../contracts/abi";
import { readAllAdaptersSim, readPriceFeedsSim, createSimPublicClient } from "./sim-reader";
import { runBftRound, type BftConfig } from "./bft/bft-runner";
import { MOCK_SERVER_PORT } from "./bft/mock-variance-server";

// ─────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────

const CONFIG_PATH = path.join(__dirname, "..", "config.staging.json");
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));

const PRIVATE_KEY = process.env.PRIVATE_KEY ?? process.env.CRE_ETH_PRIVATE_KEY;
const RPC_URL = process.env.RPC_URL || "https://sepolia-rollup.arbitrum.io/rpc";

const arbEvm = config.evms.find((e: any) => e.chainName === "ethereum-testnet-sepolia-arbitrum-1");
const addresses = arbEvm?.addresses[0] || {};
const priceFeeds = arbEvm?.priceFeeds || config.priceFeeds;

if (!PRIVATE_KEY) {
    console.error("❌ ERROR: Set CRE_ETH_PRIVATE_KEY=0x...");
    process.exit(1);
}

// ─────────────────────────────────────────────────
// VIEM CLIENTS
// ─────────────────────────────────────────────────

const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`);
const walletClient = createWalletClient({ account, chain: arbitrumSepolia, transport: http(RPC_URL) });
const publicClient = createPublicClient({ chain: arbitrumSepolia, transport: http(RPC_URL) });
const simClient = createSimPublicClient(RPC_URL);

// ─────────────────────────────────────────────────
// LOGGER
// ─────────────────────────────────────────────────

const C = {
    r: "\x1b[0m", dim: "\x1b[2m", bold: "\x1b[1m",
    cyan: "\x1b[36m", green: "\x1b[32m", yellow: "\x1b[33m", red: "\x1b[31m",
};

// ─────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────

async function main() {
    console.log(`\n${C.cyan}${"═".repeat(60)}${C.r}`);
    console.log(`${C.bold}${C.cyan}  ShieldYield — Interactive BFT Consensus Simulation${C.r}`);
    console.log(`${C.dim}  Triggering 21-Node Decentralized Oracle Network...${C.r}`);
    console.log(`${C.cyan}${"═".repeat(60)}${C.r}\n`);

    // 1. Fetch deterministic on-chain data
    console.log(`${C.dim}Fetching current on-chain state for all nodes...${C.r}`);
    const adapters = await readAllAdaptersSim(simClient, addresses);
    const prices = await readPriceFeedsSim(simClient, priceFeeds);

    let totalBalance = 0n;
    for (const a of adapters) {
        totalBalance += a.balance;
    }
    const usdcPrice = prices.usdcUsd || 1.0;
    const currentTvl = Number(totalBalance) * usdcPrice / 1e6;

    console.log(`${C.green}✓ On-chain data fetched (TVL: $${currentTvl.toFixed(2)})${C.r}`);

    // Try to get injected scenario protocol to target specifically
    let targetedProtocol = config.offchainApis.primaryProtocol;
    try {
        const stateRes = await fetch(`http://localhost:${MOCK_SERVER_PORT}/inject-state`);
        if (stateRes.ok) {
            const data = await stateRes.json() as any;
            if (data.scenario?.label?.toLowerCase().includes("aave")) targetedProtocol = "AaveAdapter";
            else if (data.scenario?.label?.toLowerCase().includes("morpho")) targetedProtocol = "MorphoAdapter";
            else if (data.scenario?.label?.toLowerCase().includes("compound")) targetedProtocol = "CompoundAdapter";
            else if (data.scenario?.label?.toLowerCase().includes("yieldmax")) targetedProtocol = "YieldMaxAdapter";
        }
    } catch (e) {
        // mock server might not be running
    }

    const bftCfg: BftConfig = {
        mockBaseUrl: `http://localhost:${MOCK_SERVER_PORT}`,
        directApis: {
            goPlusUrl: `https://api.gopluslabs.io/api/v1/token_security/${config.offchainApis.goPlusChainId}?contract_addresses=${config.offchainApis.adapters[targetedProtocol]?.goPlusTokenAddress || ""}`,
            teamWalletUrl: `https://api.arbiscan.io/api?module=account&action=balance&address=${config.offchainApis.adapters[targetedProtocol]?.teamWallet || ""}&tag=latest&apikey=YourApiKeyToken`,
        },
        primaryProtocol: targetedProtocol,
        currentTvl,
        timestamp: Math.floor(Date.now() / 1000),
    };

    // 2. Run BFT Round
    console.log(`\n${C.yellow}Starting 21-node DON execution...${C.r}\n`);
    const consensus = await runBftRound(bftCfg, adapters);

    // 3. Check consensus and write
    if (!consensus.reached) {
        console.error(`\n${C.red}❌ Consensus NOT reached. No action taken.${C.r}`);
        process.exit(1);
    }

    console.log(`\n${C.green}✅ Consensus reached! Preparing to write median scores to blockchain...${C.r}`);

    const protocols: Address[] = [];
    const scoreValues: number[] = [];
    const reasons: string[] = [];

    for (const [name, { score }] of Object.entries(consensus.medianScores)) {
        // Find adapter address
        const adapterAddr = Object.entries(addresses).find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1];
        if (adapterAddr) {
            protocols.push(adapterAddr as Address);
            scoreValues.push(score);
            reasons.push(consensus.highestSeverity ? `Targeted threat detected` : `Routine evaluation`);
        }
    }

    if (protocols.length === 0) {
        console.log(`${C.dim}No protocols to update.${C.r}`);
        return;
    }

    const registryAddr = addresses.riskRegistry as Address;
    console.log(`\n${C.cyan}Submitting transaction to RiskRegistry (${registryAddr})...${C.r}`);

    try {
        const nonce = await publicClient.getTransactionCount({ address: account.address, blockTag: "pending" });
        const hash = await walletClient.writeContract({
            address: registryAddr,
            abi: RiskRegistry,
            functionName: "batchUpdateRiskScores",
            args: [protocols, scoreValues, reasons],
            nonce,
        });

        console.log(`${C.yellow}TX submitted: ${hash}${C.r}`);
        console.log(`${C.dim}Waiting for confirmation...${C.r}`);
        const receipt = await publicClient.waitForTransactionReceipt({ hash });

        console.log(`\n${C.green}✅ Transaction confirmed in block ${receipt.blockNumber}!${C.r}`);
        console.log(`${C.green}🔎 https://sepolia.arbiscan.io/tx/${hash}${C.r}`);

        if (consensus.highestSeverity === "WARNING" || consensus.highestSeverity === "CRITICAL") {
            console.log(`\n${C.red}${C.bold}⚠️  SHIELD TRIGGERED ON-CHAIN! ⚠️${C.r}`);
            console.log(`${C.dim}The smart contract is now executing the automated defense mechanism...${C.r}`);
        }

    } catch (err: any) {
        console.error(`\n${C.red}❌ Write failed: ${err?.message || err}${C.r}`);
        process.exit(1);
    }
}

main().catch(err => {
    console.error("Fatal error:", err);
    process.exit(1);
});
