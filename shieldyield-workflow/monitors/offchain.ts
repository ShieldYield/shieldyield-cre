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
    PriceSignal,
    GithubSignal,
    SecuritySignal,
    TeamWalletSignal,
    OffchainSignals,
} from "./types";

// ========================================
// FUNGSI 1: Fetch Price Data via Next.js Proxy
// ========================================
// The Next.js proxy handles Chainlink Data Streams HMAC auth
// and returns clean JSON: { ethUsd, btcUsd, usdcUsd, timestamp }
function fetchPriceProxy(
    sendRequester: HTTPSendRequester,
    proxyUrl: string
): PriceSignal {
    try {
        const resp = sendRequester
            .sendRequest({
                url: proxyUrl,
                method: "GET" as const,
                headers: {
                    "Content-Type": "application/json",
                },
                timeout: "8s",
            })
            .result();

        if (!ok(resp)) {
            return { ethUsd: 0, btcUsd: 0, usdcUsd: 1.0 };
        }

        const data = json(resp) as any;
        return {
            ethUsd: Number(data.ethUsd) || 0,
            btcUsd: Number(data.btcUsd) || 0,
            usdcUsd: Number(data.usdcUsd) || 1.0,
        };
    } catch {
        return { ethUsd: 0, btcUsd: 0, usdcUsd: 1.0 };
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
        priceProxyUrl: string;
        githubUrl: string;
        goPlusUrl: string;
        teamWalletUrl: string;
    }
): OffchainSignals {
    const httpClient = new HTTPClient();

    // --- Chainlink Data Streams: Price feeds via Next.js Proxy ---
    runtime.log("Fetching prices from Data Streams proxy...");

    const prices = httpClient
        .sendRequest(
            runtime,
            fetchPriceProxy,
            ConsensusAggregationByFields<PriceSignal>({
                ethUsd: median,
                btcUsd: median,
                usdcUsd: median,
            })
        )(config.priceProxyUrl)
        .result();

    runtime.log(
        `📈 Data Streams: ETH=$${prices.ethUsd.toFixed(2)}, BTC=$${prices.btcUsd.toFixed(2)}, USDC=$${prices.usdcUsd.toFixed(6)}`
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

    return { prices, github, security, teamWallet };
}
