import {
    HTTPClient,
    ConsensusAggregationByFields,
    median,
    identical,
    type Runtime,
    type HTTPSendRequester,
    ok,
    json,
} from "@chainlink/cre-sdk";

import type {
    TvlSignal,
    GithubSignal,
    SecuritySignal,
    TeamWalletSignal,
    OffchainSignals,
} from "./types";

// ========================================
// FUNGSI 1: Fetch TVL Data — DeFiLlama
// ========================================
function fetchTvlData(
    sendRequester: HTTPSendRequester,
    protocolSlug: string
): TvlSignal {
    try {
        const resp = sendRequester
            .sendRequest({
                url: `https://api.llama.fi/protocol/${protocolSlug}`,
                method: "GET" as const,
                timeout: "8s",
            })
            .result();

        if (!ok(resp)) {
            return { currentTvl: 0, tvlChange24hPercent: 0 };
        }

        const data = json(resp) as any;
        const currentTvl: number = data.tvl || 0;

        // Calculate 24h change from TVL history
        const tvlHistory: { date: number; totalLiquidityUSD: number }[] = data.tvls || [];

        if (tvlHistory.length >= 2) {
            const latest = tvlHistory[tvlHistory.length - 1].totalLiquidityUSD;
            const dayAgo = tvlHistory[tvlHistory.length - 2].totalLiquidityUSD;
            const changePercent = dayAgo > 0
                ? ((latest - dayAgo) / dayAgo) * 100
                : 0;
            return { currentTvl, tvlChange24hPercent: changePercent };
        }

        return { currentTvl, tvlChange24hPercent: 0 };
    } catch {
        return { currentTvl: 0, tvlChange24hPercent: 0 };
    }
}

// ========================================
// FUNGSI 2: Fetch GitHub Activity
// ========================================
function fetchGitHubData(
    sendRequester: HTTPSendRequester,
    githubUrl: string
): GithubSignal {
    try {
        const resp = sendRequester
            .sendRequest({
                url: githubUrl,
                method: "GET" as const,
                headers: {
                    "User-Agent": "ShieldYield-CRE-Monitor",
                },
                timeout: "8s",
            })
            .result();

        if (!ok(resp)) {
            return { recentCommits: 0, openIssues: 0, lastPushDaysAgo: 999 };
        }

        const data = json(resp) as any;

        const lastPush = new Date(data.pushed_at || Date.now());
        const daysSincePush = Math.floor(
            (Date.now() - lastPush.getTime()) / (1000 * 60 * 60 * 24)
        );

        return {
            recentCommits: data.open_issues_count || 0,
            openIssues: data.open_issues_count || 0,
            lastPushDaysAgo: daysSincePush,
        };
    } catch {
        return { recentCommits: 0, openIssues: 0, lastPushDaysAgo: 999 };
    }
}

// ========================================
// FUNGSI 3: Fetch Security Data — GoPlus
// ========================================
function fetchSecurityData(
    sendRequester: HTTPSendRequester,
    goPlusUrl: string
): SecuritySignal {
    try {
        const resp = sendRequester
            .sendRequest({
                url: goPlusUrl,
                method: "GET" as const,
                timeout: "8s",
            })
            .result();

        if (!ok(resp)) {
            return {
                isHoneypot: false,
                isOpenSource: true,
                isProxy: false,
                ownerCanChangeBalance: false,
                isMintable: false,
            };
        }

        const data = json(resp) as any;

        // GoPlus returns: { result: { "0xAddress": { ...flags } } }
        const results = data.result || {};
        const firstKey = Object.keys(results)[0];
        const flags = firstKey ? results[firstKey] : {};

        return {
            isHoneypot: flags.is_honeypot === "1",
            isOpenSource: flags.is_open_source === "1",
            isProxy: flags.is_proxy === "1",
            ownerCanChangeBalance: flags.owner_change_balance === "1",
            isMintable: flags.is_mintable === "1",
        };
    } catch {
        return {
            isHoneypot: false,
            isOpenSource: true,
            isProxy: false,
            ownerCanChangeBalance: false,
            isMintable: false,
        };
    }
}

// ========================================
// FUNGSI 4: Fetch Team Wallet — Etherscan
// ========================================
function fetchTeamWalletData(
    sendRequester: HTTPSendRequester,
    teamWalletUrl: string
): TeamWalletSignal {
    try {
        const resp = sendRequester
            .sendRequest({
                url: teamWalletUrl,
                method: "GET" as const,
                timeout: "8s",
            })
            .result();

        if (!ok(resp)) {
            return { balanceEth: 0, recentLargeOutflows: false };
        }

        const data = json(resp) as any;
        const balanceWei = BigInt(data.result || "0");
        const balanceEth = Number(balanceWei) / 1e18;

        return {
            balanceEth,
            recentLargeOutflows: false, // Would need tx history for this
        };
    } catch {
        return { balanceEth: 0, recentLargeOutflows: false };
    }
}

// ========================================
// FUNGSI UTAMA: Fetch semua off-chain signals
// ========================================
export function fetchAllOffchainSignals(
    runtime: Runtime<any>,
    config: {
        defiLlamaSlug: string;
        githubUrl: string;
        goPlusUrl: string;
        teamWalletUrl: string;
    }
): OffchainSignals {
    const httpClient = new HTTPClient();

    // --- DeFiLlama: TVL velocity ---
    const tvl = httpClient
        .sendRequest(
            runtime,
            fetchTvlData,
            ConsensusAggregationByFields<TvlSignal>({
                currentTvl: median,
                tvlChange24hPercent: median,
            })
        )(config.defiLlamaSlug)
        .result();
    runtime.log(
        `📈 TVL: $${Math.round(tvl.currentTvl).toLocaleString()}, 24h change: ${tvl.tvlChange24hPercent.toFixed(2)}%`
    );

    // --- GitHub: Code Risk ---
    const github = httpClient
        .sendRequest(
            runtime,
            fetchGitHubData,
            ConsensusAggregationByFields<GithubSignal>({
                recentCommits: median,
                openIssues: median,
                lastPushDaysAgo: median,
            })
        )(config.githubUrl)
        .result();
    runtime.log(
        `📦 GitHub: issues=${github.openIssues}, lastPush=${github.lastPushDaysAgo}d`
    );

    // --- GoPlus: Security flags ---
    const security = httpClient
        .sendRequest(
            runtime,
            fetchSecurityData,
            ConsensusAggregationByFields<SecuritySignal>({
                isHoneypot: identical,
                isOpenSource: identical,
                isProxy: identical,
                ownerCanChangeBalance: identical,
                isMintable: identical,
            })
        )(config.goPlusUrl)
        .result();
    runtime.log(
        `🔒 Security: honeypot=${security.isHoneypot}, openSource=${security.isOpenSource}, proxy=${security.isProxy}`
    );

    // --- Etherscan: Team Wallet ---
    const teamWallet = httpClient
        .sendRequest(
            runtime,
            fetchTeamWalletData,
            ConsensusAggregationByFields<TeamWalletSignal>({
                balanceEth: median,
                recentLargeOutflows: identical,
            })
        )(config.teamWalletUrl)
        .result();
    runtime.log(
        `👛 TeamWallet: balance=${teamWallet.balanceEth.toFixed(4)}ETH`
    );

    return { tvl, github, security, teamWallet };
}
