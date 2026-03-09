/**
 * sim-finalize-base.ts
 * ─────────────────────────────────────────────────────────────
 * Oracle Instruction: Finalize Cross-Chain Claims on Base.
 * 
 * This script assigns globally pooled funds to individual users.
 * Run this after CCIP status is SUCCESS to enable the "Claim" button.
 * 
 * Usage:
 *   bun simulation/sim-finalize-base.ts <user_wallet> <amount>
 * ─────────────────────────────────────────────────────────────
 */

import {
    createWalletClient,
    createPublicClient,
    http,
    type Address,
    parseUnits,
    formatUnits,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import * as fs from "fs";
import * as path from "path";

// ─────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────

const BASE_VAULT = "0xf723cf2629a7461ad92c7ef6cad51cd853d332a7" as Address;

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

let PK = process.env.PRIVATE_KEY ?? process.env.CRE_ETH_PRIVATE_KEY;
if (PK && !PK.startsWith("0x")) PK = `0x${PK}`;

if (!PK) {
    console.error("❌ ERROR: CRE_ETH_PRIVATE_KEY not set.");
    process.exit(1);
}

// ─────────────────────────────────────────────────
// ARGS
// ─────────────────────────────────────────────────

const user = process.argv[2] as Address;
const amount = process.argv[3];

if (!user || !amount) {
    console.log("Usage: bun simulation/sim-finalize-base.ts <user_wallet> <amount_usdc>");
    process.exit(1);
}

// ─────────────────────────────────────────────────
// EXECUTE
// ─────────────────────────────────────────────────

async function main() {
    const account = privateKeyToAccount(PK as `0x${string}`);
    const wallet = createWalletClient({ account, chain: baseSepolia, transport: http("https://sepolia.base.org") });
    const publicClient = createPublicClient({ chain: baseSepolia, transport: http("https://sepolia.base.org") });

    console.log(`\n🤖 ORACLE INSTRUCTION — Assigning Claims on Base`);
    console.log(`─────────────────────────────────────────────────`);
    console.log(`Target User : ${user}`);
    console.log(`Amount USDC : ${amount}`);
    console.log(`Oracle Node : ${account.address}\n`);

    try {
        const poolBalance = await publicClient.readContract({
            address: BASE_VAULT,
            abi: [{ name: "totalCrossChainPool", type: "function", inputs: [], outputs: [{ type: "uint256" }] }],
            functionName: "totalCrossChainPool"
        });

        console.log(`Current Vault Pool: ${formatUnits(poolBalance, 18)} USDC`);

        const amountRaw = parseUnits(amount, 18);
        if (amountRaw > poolBalance) {
            console.warn(`⚠️  Warning: Assigning more than available in pool!`);
        }

        console.log(`\nSubmitting setCrossChainClaims...`);
        const hash = await wallet.writeContract({
            address: BASE_VAULT,
            abi: [{
                name: "setCrossChainClaims",
                type: "function",
                stateMutability: "nonpayable",
                inputs: [{ name: "users", type: "address[]" }, { name: "amounts", type: "uint256[]" }],
                outputs: []
            }],
            functionName: "setCrossChainClaims",
            args: [[user], [amountRaw]]
        });

        console.log(`✅ Success! Tx Hash: ${hash}`);
        console.log(`⏳ Waiting for confirmation...`);
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        console.log(`🎉 Confirmed in block ${receipt.blockNumber}`);
        console.log(`\n👉 Dashboard will now show "$0.00 (+$${amount} PENDING CLAIM)"`);

    } catch (err: any) {
        console.error(`\n❌ Failed: ${err.shortMessage || err.message}`);
    }
}

main().catch(console.error);
