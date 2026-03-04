/**
 * ============================================================================
 * 🛡️ ShieldYield — LOCAL CRE E2E TEST (SELF-CONTAINED)
 * ============================================================================
 *
 * Script ini melakukan 5 tahap secara berurutan:
 *
 *   TAHAP 1: Claim Test USDC dari Faucet
 *   TAHAP 2: Approve & Deposit USDC ke ShieldVault
 *   TAHAP 3: Simulasi Serangan — Update Risk Score → CRITICAL
 *   TAHAP 4: Jalankan CRE Workflow Lokal (Simulator)
 *   TAHAP 5: Eksekusi Keputusan CRE ke On-Chain + Log WorkflowId
 *
 * Setiap tahap memiliki jeda (tekan ENTER) agar Anda bisa memeriksa
 * perubahan di FE Dashboard dan Arbiscan.
 *
 * ============================================================================
 */

import {
    createWalletClient,
    createPublicClient,
    http,
    formatUnits,
    parseAbi,
    keccak256,
    toHex,
    encodeFunctionData,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia } from "viem/chains";
import { execSync } from "child_process";
import * as readline from "readline";

// Bun loads .env automatically

// ========================================
// CONTRACT ADDRESSES (Arbitrum Sepolia)
// ========================================
const MOCK_USDC = "0x4d107C58DCda55ea6ea2B162d9C434F710E42038" as const;
const FAUCET = "0x6E860FF2C4ea6b01815D74E54859Cdd9DD172256" as const;
const RISK_REGISTRY = "0xa23BE1297F836FF7D4E3297320ff16dbc7903e6D" as const;
const SHIELD_VAULT = "0xcFBd47c63D284A8F824e586596Df4d5c57326c8B" as const;
const YIELDMAX_ADAPTER = "0x5EbD6F3DA76C2B9C9d6aAC89DA08c388EaB2B3cb" as const;
const AAVE_ADAPTER = "0xB81961aA49d7E834404e299e688B3Dc09a5EFe5a" as const;
const WORKFLOW_LOGGER = "0xc874515881928b0ef35164843542f91d9ccfd2f3" as const;

// USDC has 6 decimals
const DEPOSIT_AMOUNT = 10_000n * 1_000_000n; // 10,000 USDC

// Action constants (matches WorkflowLogger.sol)
const ACTION_EMERGENCY_WITHDRAW = 2;

// ========================================
// MINIMAL ABIs
// ========================================
const ERC20_ABI = parseAbi([
    "function balanceOf(address) view returns (uint256)",
    "function approve(address spender, uint256 amount) returns (bool)",
]);
const FAUCET_ABI = parseAbi(["function claim() external"]);
const RISK_REGISTRY_ABI = parseAbi([
    "function updateRiskScore(address protocol, uint8 newScore, string reason) external",
]);
const SHIELD_VAULT_ABI = parseAbi([
    "function deposit(uint256 amount) external returns (uint256 shares)",
    "function emergencyWithdraw(address adapter, string reason) external",
]);

// WorkflowLogger uses a struct input — we define the full ABI
const WORKFLOW_LOGGER_ABI = [
    {
        type: "function" as const,
        name: "logExecution",
        inputs: [
            {
                name: "report",
                type: "tuple" as const,
                components: [
                    { name: "workflowId", type: "bytes32" as const },
                    { name: "action", type: "uint8" as const },
                    { name: "adapter", type: "address" as const },
                    { name: "protocolName", type: "string" as const },
                    { name: "riskScore", type: "uint8" as const },
                    { name: "threatLevel", type: "uint8" as const },
                    { name: "actionDescription", type: "string" as const },
                    { name: "resolutionCriteria", type: "string" as const },
                    { name: "dataSources", type: "string" as const },
                ],
            },
        ],
        outputs: [],
        stateMutability: "nonpayable" as const,
    },
] as const;

// ========================================
// COLORS & HELPERS
// ========================================
const C = {
    reset: "\x1b[0m",
    bright: "\x1b[1m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    cyan: "\x1b[36m",
    magenta: "\x1b[35m",
    dim: "\x1b[2m",
};

function fmtUsdc(amount: bigint): string {
    return formatUnits(amount, 6);
}

/** Prompt user to press ENTER before continuing */
function waitForEnter(message: string): Promise<void> {
    return new Promise((resolve) => {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });
        rl.question(`\n  ${C.magenta}⏸️  ${message}${C.reset}\n  ${C.dim}Tekan ENTER untuk melanjutkan...${C.reset}`, () => {
            rl.close();
            resolve();
        });
    });
}

// ========================================
// MAIN
// ========================================
async function run() {
    console.log("");
    console.log(`${C.cyan}${"═".repeat(66)}${C.reset}`);
    console.log(`${C.bright}${C.cyan}  🛡️  ShieldYield — LOCAL CRE E2E TEST (SELF-CONTAINED)${C.reset}`);
    console.log(`${C.cyan}${"═".repeat(66)}${C.reset}`);
    console.log("");

    // ── Load Private Key ──
    const privateKey = process.env.CRE_ETH_PRIVATE_KEY;
    if (!privateKey) {
        console.error(`${C.red}❌ CRE_ETH_PRIVATE_KEY belum diset di file .env!${C.reset}`);
        process.exit(1);
    }

    const account = privateKeyToAccount(privateKey as `0x${string}`);
    console.log(`  ${C.dim}Wallet : ${account.address}${C.reset}`);
    console.log(`  ${C.dim}Network: Arbitrum Sepolia${C.reset}`);

    const rpc = "https://sepolia-rollup.arbitrum.io/rpc";
    const publicClient = createPublicClient({ chain: arbitrumSepolia, transport: http(rpc) });
    const walletClient = createWalletClient({ account, chain: arbitrumSepolia, transport: http(rpc) });

    // ════════════════════════════════════════════════════════════════
    // TAHAP 1: CLAIM TEST USDC DARI FAUCET
    // ════════════════════════════════════════════════════════════════
    console.log("");
    console.log(`${C.bright}${C.cyan}  ▶ TAHAP 1/5: CLAIM TEST USDC DARI FAUCET${C.reset}`);
    console.log(`${C.dim}  ${"─".repeat(60)}${C.reset}`);

    const usdcBefore = await publicClient.readContract({
        address: MOCK_USDC, abi: ERC20_ABI, functionName: "balanceOf", args: [account.address],
    });
    console.log(`  ${C.dim}Saldo USDC sebelum: ${fmtUsdc(usdcBefore)} USDC${C.reset}`);

    try {
        const claimHash = await walletClient.writeContract({
            address: FAUCET, abi: FAUCET_ABI, functionName: "claim",
        });
        console.log(`  ${C.dim}⏳ Tx claim: ${claimHash}${C.reset}`);
        await publicClient.waitForTransactionReceipt({ hash: claimHash });
        console.log(`  ${C.green}✅ Claim berhasil!${C.reset}`);
    } catch (e: any) {
        console.log(`  ${C.yellow}⚠️  Faucet claim gagal (mungkin cooldown): ${e.shortMessage || e.message}${C.reset}`);
        console.log(`  ${C.dim}   Melanjutkan dengan saldo yang ada...${C.reset}`);
    }

    const usdcAfter = await publicClient.readContract({
        address: MOCK_USDC, abi: ERC20_ABI, functionName: "balanceOf", args: [account.address],
    });
    console.log(`  ${C.green}Saldo USDC sekarang: ${fmtUsdc(usdcAfter)} USDC${C.reset}`);

    await waitForEnter("Cek saldo USDC Anda di Arbiscan. Lalu lanjut ke Deposit.");

    // ════════════════════════════════════════════════════════════════
    // TAHAP 2: APPROVE & DEPOSIT KE SHIELDVAULT
    // ════════════════════════════════════════════════════════════════
    console.log("");
    console.log(`${C.bright}${C.cyan}  ▶ TAHAP 2/5: APPROVE & DEPOSIT ${fmtUsdc(DEPOSIT_AMOUNT)} USDC KE SHIELDVAULT${C.reset}`);
    console.log(`${C.dim}  ${"─".repeat(60)}${C.reset}`);

    console.log(`  📝 Meng-approve ShieldVault untuk menarik ${fmtUsdc(DEPOSIT_AMOUNT)} USDC...`);
    const approveHash = await walletClient.writeContract({
        address: MOCK_USDC, abi: ERC20_ABI, functionName: "approve",
        args: [SHIELD_VAULT, DEPOSIT_AMOUNT],
    });
    console.log(`  ${C.dim}⏳ Tx approve: ${approveHash}${C.reset}`);
    await publicClient.waitForTransactionReceipt({ hash: approveHash });
    console.log(`  ${C.green}✅ Approve berhasil!${C.reset}`);

    console.log(`  💰 Mendepositkan ${fmtUsdc(DEPOSIT_AMOUNT)} USDC ke ShieldVault...`);
    const depositHash = await walletClient.writeContract({
        address: SHIELD_VAULT, abi: SHIELD_VAULT_ABI, functionName: "deposit",
        args: [DEPOSIT_AMOUNT],
    });
    console.log(`  ${C.dim}⏳ Tx deposit: ${depositHash}${C.reset}`);
    const depositReceipt = await publicClient.waitForTransactionReceipt({ hash: depositHash });
    console.log(`  ${C.green}✅ Deposit berhasil! Block: ${depositReceipt.blockNumber}${C.reset}`);
    console.log(`  ${C.yellow}   Event Deposited(wallet, ${fmtUsdc(DEPOSIT_AMOUNT)} USDC, shares) emitted!${C.reset}`);
    console.log(`  ${C.dim}   Dana didistribusikan: Aave 25% | Compound 25% | Morpho 30% | YieldMax 20%${C.reset}`);

    await waitForEnter(
        "Cek FE Dashboard (localhost:3000) → Saldo ShieldVault naik.\n" +
        "     Cek Arbiscan tx: " + depositHash + "\n" +
        "     Lalu lanjut ke Serangan."
    );

    // ════════════════════════════════════════════════════════════════
    // TAHAP 3: SIMULASI SERANGAN — UPDATE RISK SCORE → CRITICAL
    // ════════════════════════════════════════════════════════════════
    console.log("");
    console.log(`${C.bright}${C.red}  ▶ TAHAP 3/5: 🔥 SIMULASI SERANGAN — RISK SCORE → CRITICAL (96)${C.reset}`);
    console.log(`${C.dim}  ${"─".repeat(60)}${C.reset}`);

    const attackHash = await walletClient.writeContract({
        address: RISK_REGISTRY, abi: RISK_REGISTRY_ABI, functionName: "updateRiskScore",
        args: [
            YIELDMAX_ADAPTER,
            96,
            "SIMULATED HACK: Liquidity pool drained, unauthorized access detected",
        ],
    });
    console.log(`  ${C.dim}⏳ Tx serangan: ${attackHash}${C.reset}`);
    const attackReceipt = await publicClient.waitForTransactionReceipt({ hash: attackHash });
    console.log(`  ${C.red}💀 Serangan BERHASIL! Block: ${attackReceipt.blockNumber}${C.reset}`);
    console.log(`  ${C.yellow}   Event RiskScoreUpdated(YieldMax, ..., 96, CRITICAL) emitted!${C.reset}`);

    await waitForEnter(
        "Cek FE Dashboard → Risk Badge YieldMax berubah jadi CRITICAL.\n" +
        "     Cek Arbiscan tx: " + attackHash + "\n" +
        "     Lalu lanjut ke CRE Simulator."
    );

    // ════════════════════════════════════════════════════════════════
    // TAHAP 4: JALANKAN CRE WORKFLOW LOKAL (SIMULATOR)
    // ════════════════════════════════════════════════════════════════
    console.log("");
    console.log(`${C.bright}${C.cyan}  ▶ TAHAP 4/5: 🤖 MENJALANKAN CRE WORKFLOW LOKAL${C.reset}`);
    console.log(`${C.dim}  ${"─".repeat(60)}${C.reset}`);
    console.log(`  📡 Meneruskan TxHash serangan ke CRE Simulator...`);
    console.log(`  ${C.dim}   CRE akan membaca event log, menganalisis, dan mengambil keputusan.${C.reset}`);
    console.log("");

    console.log(`  ${C.dim}⏳ Menunggu 5 detik agar RPC sinkronasi...${C.reset}`);
    await new Promise((resolve) => setTimeout(resolve, 5000));

    const projectRoot = new URL("../", import.meta.url).pathname;
    const creCommand = [
        "cre workflow simulate ./shieldyield-workflow",
        "-T staging-settings",
        "--non-interactive",
        "--trigger-index 2",
        `--evm-tx-hash ${attackHash}`,
        "--evm-event-index 0",
        "--broadcast",
    ].join(" ");

    console.log(`  ${C.dim}$ cd ${projectRoot}`);
    console.log(`  ${C.dim}$ ${creCommand}${C.reset}`);
    console.log("");

    let creOutput = "";
    try {
        const outputBuffer = execSync(creCommand, {
            cwd: projectRoot,
            env: { ...process.env, PATH: `${process.env.HOME}/.cre/bin:${process.env.PATH}` },
        });
        creOutput = outputBuffer.toString();
        console.log(creOutput);
    } catch (error: any) {
        if (error.stdout) {
            creOutput = error.stdout.toString();
            console.log(creOutput);
        }
        console.error(`  ${C.red}❌ CRE Simulator error: ${error.message}${C.reset}`);
        process.exit(1);
    }

    // ── Parse CRE output ──
    let parsedResult: any;
    try {
        const match = creOutput.match(/Workflow Simulation Result:\n"(.+)"/s);
        if (match && match[1]) {
            const unescaped = match[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
            parsedResult = JSON.parse(unescaped);
        }
    } catch (e) {
        console.log(`  ${C.yellow}⚠️ Gagal mem-parsing output CRE.${C.reset}`);
    }

    if (!parsedResult || parsedResult.status !== "shield_activated") {
        console.log(`  ${C.yellow}CRE tidak mengambil aksi darurat. Status: ${parsedResult?.status}${C.reset}`);
        return;
    }

    console.log(`  ${C.green}⚡ CRE memutuskan: ${parsedResult.level} — ${parsedResult.message}${C.reset}`);
    if (parsedResult.workflowId) {
        console.log(`  ${C.cyan}🔑 Workflow ID: ${parsedResult.workflowId}${C.reset}`);
    }

    await waitForEnter(
        "CRE Lokal telah menganalisis dan memutuskan EMERGENCY WITHDRAWAL.\n" +
        "     Selanjutnya, keputusan ini akan di-broadcast ke Smart Contract\n" +
        "     DAN Workflow ID + detail lengkap akan dicatat on-chain.\n" +
        "     Lanjut?"
    );

    // ════════════════════════════════════════════════════════════════
    // TAHAP 5: EKSEKUSI KEPUTUSAN CRE KE ON-CHAIN + LOG WORKFLOW ID
    // ════════════════════════════════════════════════════════════════
    console.log("");
    console.log(`${C.bright}${C.green}  ▶ TAHAP 5/5: ⚡ EKSEKUSI ON-CHAIN + LOG WORKFLOW ID${C.reset}`);
    console.log(`${C.dim}  ${"─".repeat(60)}${C.reset}`);

    const withdrawAction = parsedResult.actions?.find((a: any) => a.type === "EMERGENCY_WITHDRAW");

    if (!withdrawAction) {
        console.log(`  ${C.yellow}Tidak ada aksi EMERGENCY_WITHDRAW di instruksi CRE.${C.reset}`);
        return;
    }

    // Determine workflowId
    const workflowIdHex = parsedResult.workflowId
        ? (parsedResult.workflowId.length === 66
            ? parsedResult.workflowId
            : keccak256(toHex(parsedResult.workflowId)))
        : keccak256(toHex("shieldyield-shield-execute-v1"));

    console.log(`  ${C.cyan}🔑 Workflow ID : ${workflowIdHex}${C.reset}`);
    console.log(`  ${C.dim}   Adapter      : ${withdrawAction.adapter}${C.reset}`);
    console.log("");

    // ── Step 5a: Execute emergencyWithdraw ──
    console.log(`  ${C.green}🛡️ [5a] Mengirim emergencyWithdraw ke ShieldVault...${C.reset}`);
    let shieldTxHash = "";
    try {
        const shieldHash = await walletClient.writeContract({
            address: SHIELD_VAULT,
            abi: SHIELD_VAULT_ABI,
            functionName: "emergencyWithdraw",
            args: [withdrawAction.adapter, withdrawAction.reason],
        });
        shieldTxHash = shieldHash;

        console.log(`  ${C.dim}⏳ Tx Shield: ${shieldHash}${C.reset}`);
        const shieldReceipt = await publicClient.waitForTransactionReceipt({ hash: shieldHash });
        console.log(`  ${C.green}✅ EmergencyWithdraw berhasil! Block: ${shieldReceipt.blockNumber}${C.reset}`);
        console.log(`  ${C.yellow}   Event: EmergencyWithdrawExecuted + ShieldActivated emitted!${C.reset}`);
        console.log("");
    } catch (e: any) {
        console.error(`  ${C.red}❌ EmergencyWithdraw gagal: ${e.shortMessage || e.message}${C.reset}`);
        return;
    }

    // ── Step 5b: Log full descriptive report via WorkflowLogger ──
    console.log(`  ${C.green}📋 [5b] Mencatat Laporan Lengkap ke WorkflowLogger on-chain...${C.reset}`);

    // Build descriptive report metadata
    const reportData = {
        workflowId: workflowIdHex as `0x${string}`,
        action: ACTION_EMERGENCY_WITHDRAW,
        adapter: withdrawAction.adapter as `0x${string}`,
        protocolName: "YieldMax (Mock High-Risk DeFi Protocol)",
        riskScore: 96,
        threatLevel: 3, // CRITICAL
        actionDescription:
            "Emergency withdrawal of 100% funds from YieldMax adapter. " +
            "All user funds moved to Aave V3 (safe haven) to prevent loss. " +
            "Triggered by ShieldYield CRE Workflow shield-execute-v1.",
        resolutionCriteria:
            "Risk score exceeded CRITICAL threshold (96/100 > 90). " +
            "Resolves automatically when protocol is audited and risk score drops below WARNING (50).",
        dataSources: JSON.stringify([
            "chainlink.com/cre-workflows",
            "shieldyield/risk-registry",
            "shieldyield/ai-sentinel",
            "defillama.com/yields",
        ]),
    };

    console.log(`  ${C.dim}   Protocol     : ${reportData.protocolName}${C.reset}`);
    console.log(`  ${C.dim}   Risk Score    : ${reportData.riskScore}/100${C.reset}`);
    console.log(`  ${C.dim}   Threat Level  : CRITICAL (${reportData.threatLevel})${C.reset}`);
    console.log(`  ${C.dim}   Data Sources  : ${reportData.dataSources}${C.reset}`);
    console.log("");

    try {
        const logHash = await walletClient.writeContract({
            address: WORKFLOW_LOGGER,
            abi: WORKFLOW_LOGGER_ABI,
            functionName: "logExecution",
            args: [reportData],
        });

        console.log(`  ${C.dim}⏳ Tx Log: ${logHash}${C.reset}`);
        const logReceipt = await publicClient.waitForTransactionReceipt({ hash: logHash });
        console.log(`  ${C.green}✅ Laporan tercatat on-chain! Block: ${logReceipt.blockNumber}${C.reset}`);
        console.log("");

        // ── Final Summary ──
        console.log(`${C.green}${"═".repeat(66)}${C.reset}`);
        console.log(`${C.bright}${C.green}  🎉 E2E TEST SELESAI — SEMUA TERCATAT DI ON-CHAIN!${C.reset}`);
        console.log(`${C.green}${"═".repeat(66)}${C.reset}`);
        console.log("");
        console.log(`  ${C.bright}Sekarang, periksa 3 hal berikut di Arbiscan:${C.reset}`);
        console.log("");
        console.log(`  ${C.cyan}  1. FE Dashboard (localhost:3000):${C.reset}`);
        console.log(`  ${C.dim}     → Saldo YieldMax = $0 (ditarik darurat)${C.reset}`);
        console.log(`  ${C.dim}     → Saldo Aave meningkat (uang diselamatkan ke safe haven)${C.reset}`);
        console.log(`  ${C.dim}     → Risk Badge YieldMax = CRITICAL (merah)${C.reset}`);
        console.log("");
        console.log(`  ${C.cyan}  2. Arbiscan — ShieldVault (${shieldTxHash}):${C.reset}`);
        console.log(`  ${C.dim}     → EmergencyWithdrawExecuted${C.reset}`);
        console.log(`  ${C.dim}     → ShieldActivated${C.reset}`);
        console.log("");
        console.log(`  ${C.cyan}  3. Arbiscan — WorkflowLogger (${logHash}):${C.reset}`);
        console.log(`  ${C.dim}     → ReportReceived(action=2, workflowId=0xe1a4...)${C.reset}`);
        console.log(`  ${C.dim}     → ShieldInterventionReport(workflowId, adapter,${C.reset}`);
        console.log(`  ${C.dim}         protocolName, riskScore, threatLevel,${C.reset}`);
        console.log(`  ${C.dim}         actionDescription, resolutionCriteria, dataSources)${C.reset}`);
        console.log(`  ${C.dim}     → WorkflowExecutionMeta(workflowId, executor, timestamp)${C.reset}`);
        console.log("");

    } catch (e: any) {
        console.error(`  ${C.red}❌ WorkflowLogger gagal: ${e.shortMessage || e.message}${C.reset}`);
    }
}

run().catch(console.error);
