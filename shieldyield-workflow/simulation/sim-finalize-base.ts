/**
 * sim-finalize-base.ts
 * ─────────────────────────────────────────────────────────────
 * Finalize Cross-Chain Claims on Base Sepolia.
 * 
 * This script simulates the Oracle/CRE node on the destination chain (Base).
 * It assigns bridged funds to a specific user address in the ShieldVault.
 * 
 * Usage:
 *   bun simulation/sim-finalize-base.ts <user_address> <amount_in_usdc>
 * ─────────────────────────────────────────────────────────────
 */

import {
    createWalletClient,
    createPublicClient,
    http,
    type Address,
    parseUnits,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import * as fs from "fs";
import * as path from "path";

// ─────────────────────────────────────────────────
// CONFIG & ENV
// ─────────────────────────────────────────────────

const ENV_PATH = path.join(__dirname, "../../.env");
if (fs.existsSync(ENV_PATH)) {
    const envFile = fs.readFileSync(ENV_PATH, "utf-8");
    envFile.split("\n").forEach(line => {
        const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
        if (match && !process.env[match[1]]) {
            process.env[match[1]] = match[2]?.trim() || "";
        }
    });
}

let PRIVATE_KEY = process.env.PRIVATE_KEY ?? process.env.CRE_ETH_PRIVATE_KEY;
if (PRIVATE_KEY && !PRIVATE_KEY.startsWith("0x")) {
    PRIVATE_KEY = `0x${PRIVATE_KEY}`;
}

const BASE_VAULT = "0x2EDEe329359aC421059B09C4049A750CD71831E1" as Address;

if (!PRIVATE_KEY) {
    console.error("❌ ERROR: Set CRE_ETH_PRIVATE_KEY in .env");
    process.exit(1);
}

// ─────────────────────────────────────────────────
// ARGUMENTS
// ─────────────────────────────────────────────────

const userAddress = process.argv[2] as Address;
const amountUsdc = process.argv[3] || "100";

if (!userAddress || !userAddress.startsWith("0x")) {
    console.log("Usage: bun simulation/sim-finalize-base.ts <user_address> <amount>");
    process.exit(1);
}

// ─────────────────────────────────────────────────
// SETUP
// ─────────────────────────────────────────────────

const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`);
const walletClient = createWalletClient({ account, chain: baseSepolia, transport: http("https://sepolia.base.org") });
const publicClient = createPublicClient({ chain: baseSepolia, transport: http("https://sepolia.base.org") });

const VAULT_ABI = [
    {
        name: "setCrossChainClaims",
        type: "function",
        stateMutability: "nonpayable",
        inputs: [
            { name: "users", type: "address[]" },
            { name: "amounts", type: "uint256[]" }
        ],
        outputs: []
    },
    {
        name: "totalCrossChainPool",
        type: "function",
        stateMutability: "view",
        inputs: [],
        outputs: [{ name: "", type: "uint256" }]
    },
    {
        name: "creAddress",
        type: "function",
        stateMutability: "view",
        inputs: [],
        outputs: [{ name: "", type: "address" }]
    }
] as const;

// ─────────────────────────────────────────────────
// EXECUTE
// ─────────────────────────────────────────────────

async function main() {
    console.log(`\n🛡️  Finalizing Claims on Base Sepolia`);
    console.log(`─────────────────────────────────────────────────`);
    console.log(`Vault: ${BASE_VAULT}`);
    console.log(`User:  ${userAddress}`);
    console.log(`Amount: ${amountUsdc} USDC\n`);

    try {
        // 1. Check pool balance
        const poolBalance = await publicClient.readContract({
            address: BASE_VAULT,
            abi: VAULT_ABI,
            functionName: "totalCrossChainPool"
        });
        
        console.log(`Current Pooled Funds on Base: ${Number(poolBalance) / 1e18} BnM`);

        const amountRaw = parseUnits(amountUsdc, 18); // BnM uses 18 decimals

        if (amountRaw > poolBalance) {
            console.warn(`⚠️  Warning: Amount to assign (${amountUsdc}) is greater than pooled funds (${Number(poolBalance)/1e18}). This might fail if the pool is empty.`);
        }

        // 2. Call setCrossChainClaims
        console.log(`\nSubmitting transaction from ${account.address}...`);
        
        const hash = await walletClient.writeContract({
            address: BASE_VAULT,
            abi: VAULT_ABI,
            functionName: "setCrossChainClaims",
            args: [[userAddress], [amountRaw]]
        });

        console.log(`✅ Transaction submitted: ${hash}`);
        console.log(`⏳ Waiting for confirmation...`);
        
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        console.log(`\n🎉 Success! Claims finalized in block ${receipt.blockNumber}`);
        console.log(`🔗 https://sepolia.basescan.org/tx/${hash}`);
        
        console.log(`\n👉 User can now click "Claim to Base Vault" on the dashboard.`);

    } catch (err: any) {
        console.error(`\n❌ Error: ${err.shortMessage || err.message}`);
        
        // Suggest fix if not authorized
        if (err.message.includes("ShieldVault: only CRE")) {
            console.log(`\n💡 TIP: You need to set the creAddress on the Base ShieldVault to your wallet.`);
            console.log(`Current wallet: ${account.address}`);
        }
    }
}

main().catch(console.error);
