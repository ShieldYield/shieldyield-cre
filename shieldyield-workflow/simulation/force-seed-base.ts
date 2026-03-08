import { createWalletClient, createPublicClient, http, type Address, parseUnits, erc20Abi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import * as fs from "fs";
import * as path from "path";

// 1. Load .env
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

const BASE_VAULT = "0x2EDEe329359aC421059B09C4049A750CD71831E1" as Address;
const BASE_BNM = "0x88A2d74F47a237a62e7A51cdDa67270CE381555e" as Address;

async function main() {
    if (!PK) {
        console.error("❌ ERROR: CRE_ETH_PRIVATE_KEY not found in .env");
        process.exit(1);
    }

    const account = privateKeyToAccount(PK as `0x${string}`);
    const wallet = createWalletClient({ account, chain: baseSepolia, transport: http("https://sepolia.base.org") });
    const publicClient = createPublicClient({ chain: baseSepolia, transport: http("https://sepolia.base.org") });

    console.log("🚀 Force Seeding Base Vault Pool with 10 USDC (BnM)...");
    console.log(`Using Wallet: ${account.address}`);

    try {
        let currentNonce = await publicClient.getTransactionCount({ address: account.address, blockTag: "pending" });

        // --- PART 0: Ensure we have at least 10 BnM ---
        const targetAmount = parseUnits("10", 18);
        let balance = await publicClient.readContract({
            address: BASE_BNM,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [account.address]
        });

        if (balance < targetAmount) {
            console.log(`💧 Balance: ${Number(balance)/1e18} USDC. Need 10. Starting Drips...`);
            while (balance < targetAmount) {
                console.log(`   Dripping 1 unit... (Current: ${Number(balance)/1e18})`);
                const dripTx = await wallet.writeContract({
                    address: BASE_BNM,
                    abi: [{ name: "drip", type: "function", inputs: [{ name: "to", type: "address" }], outputs: [] }],
                    functionName: "drip",
                    args: [account.address],
                    nonce: currentNonce++
                });
                await publicClient.waitForTransactionReceipt({ hash: dripTx });
                
                balance = await publicClient.readContract({
                    address: BASE_BNM,
                    abi: erc20Abi,
                    functionName: "balanceOf",
                    args: [account.address]
                });
            }
            console.log("✅ 10 USDC obtained.");
        }

        // 1. Get original bridge
        const originalBridge = await publicClient.readContract({
            address: BASE_VAULT,
            abi: [{ name: "shieldBridge", type: "function", inputs: [], outputs: [{ type: "address" }] }],
            functionName: "shieldBridge"
        }) as Address;

        // 2. Hijack
        console.log(`Hijacking bridge address... (Nonce: ${currentNonce})`);
        const tx1 = await wallet.writeContract({
            address: BASE_VAULT,
            abi: [{ name: "setBridgeAddress", type: "function", inputs: [{ name: "_bridge", type: "address" }], outputs: [] }],
            functionName: "setBridgeAddress",
            args: [account.address],
            nonce: currentNonce++
        });

        // 3. Approve
        console.log(`Approving 10 USDC... (Nonce: ${currentNonce})`);
        const tx2 = await wallet.writeContract({
            address: BASE_BNM,
            abi: erc20Abi,
            functionName: "approve",
            args: [BASE_VAULT, targetAmount],
            nonce: currentNonce++
        });

        // 4. Seed Pool
        console.log(`Seeding pool with 10 USDC... (Nonce: ${currentNonce})`);
        const tx3 = await wallet.writeContract({
            address: BASE_VAULT,
            abi: [{ name: "depositFor", type: "function", inputs: [{ name: "user", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "uint256" }] }],
            functionName: "depositFor",
            args: [BASE_VAULT, targetAmount],
            nonce: currentNonce++
        });

        // 5. Restore
        console.log(`Restoring bridge address... (Nonce: ${currentNonce})`);
        const tx4 = await wallet.writeContract({
            address: BASE_VAULT,
            abi: [{ name: "setBridgeAddress", type: "function", inputs: [{ name: "_bridge", type: "address" }], outputs: [] }],
            functionName: "setBridgeAddress",
            args: [originalBridge],
            nonce: currentNonce++
        });
        
        console.log("\n⏳ Confirming...");
        await Promise.all([
            publicClient.waitForTransactionReceipt({ hash: tx1 }),
            publicClient.waitForTransactionReceipt({ hash: tx2 }),
            publicClient.waitForTransactionReceipt({ hash: tx3 }),
            publicClient.waitForTransactionReceipt({ hash: tx4 })
        ]);

        console.log("\n🎉 Pool Successfully Seeded with 10 USDC!");
    } catch (err: any) {
        console.error("\n❌ Error:", err.shortMessage || err.message);
    }
}
main();
