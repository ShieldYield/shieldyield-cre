import { createWalletClient, http, createPublicClient, encodeFunctionData, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia } from "viem/chains";

const account = privateKeyToAccount(process.env.PK as any);
const publicClient = createPublicClient({ chain: arbitrumSepolia, transport: http("https://sepolia-rollup.arbitrum.io/rpc") });
const vaultAddr = "0xe6D20be65eA58e30eFCb8DBe677772959aAdFCd9" as `0x${string}`;

async function run() {
    const pos = await publicClient.readContract({
        address: vaultAddr,
        abi: [{ name: "getUserPosition", type: "function", stateMutability: "view", inputs: [{ name: "user", type: "address"}], outputs: [{ type: "tuple", components: [{ name: "totalDeposited", type: "uint256" }, { name: "totalShares", type: "uint256" }, { name: "lastDepositTime", type: "uint256" }]}] }],
        functionName: "getUserPosition",
        args: [account.address]
    }) as any;
    console.log("Shares:", pos.totalShares || pos[1]);
}
run();
