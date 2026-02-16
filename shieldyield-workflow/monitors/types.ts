/**
 * Snapshot data on-chain dari satu adapter (Aave, Compound, Morpho, YieldMax)
 * Diambil via EVMClient.callContract()
 */
export interface AdapterSnapshot {
    name: string;
    address: string;
    balance: bigint;
    apy: bigint;
    isHealthy: boolean;
    principal: bigint;
    accruedYield: bigint;
}

/**
 * Data risk per-protocol dari RiskRegistry contract
 * Diambil via EVMClient.callContract() → getProtocolRisk(address)
 */
export interface ProtocolRiskSnapshot {
    address: string;
    riskScore: number;
    threatLevel: number; // 0=SAFE, 1=WATCH, 2=WARNING, 3=CRITICAL
    lastUpdated: bigint;
    isActive: boolean;
}

/**
 * Sinyal off-chain yang diambil via HTTPClient
 */

// --- Chainlink Data Streams: Real-time price feeds ---
export interface PriceSignal {
    ethUsd: number;  // ETH/USD price (18 decimals)
    btcUsd: number;  // BTC/USD price (18 decimals)
    usdcUsd: number; // USDC/USD price (18 decimals)
}

// --- GitHub: Code Risk ---
export interface GithubSignal {
    recentCommits: number;
    openIssues: number;
    lastPushDaysAgo: number;
}

// --- GoPlus: Security flags ---
export interface SecuritySignal {
    isHoneypot: boolean;
    isOpenSource: boolean;
    isProxy: boolean;
    ownerCanChangeBalance: boolean;
    isMintable: boolean;
}

// --- Etherscan: Admin wallet ---
export interface TeamWalletSignal {
    balanceEth: number;
    recentLargeOutflows: boolean;
}

export interface OffchainSignals {
    prices: PriceSignal;
    github: GithubSignal;
    security: SecuritySignal;
    teamWallet: TeamWalletSignal;
}

/**
 * Hasil monitoring lengkap per chain
 */
export interface MonitoringResult {
    timestamp: number;
    chainName: string;
    adapters: AdapterSnapshot[];
    risks: ProtocolRiskSnapshot[];
    offchain: OffchainSignals;
    computedRiskScores: Record<string, { score: number; level: string }>;
}

/**
 * Per-adapter off-chain API configuration
 */
export interface AdapterApiConfig {
    defiLlamaSlug: string;
    github: string;
    goPlusTokenAddress: string;
    teamWallet: string;
}

/**
 * Off-chain APIs configuration with per-adapter support
 */
export interface OffchainApisConfig {
    /** URL of the Next.js price proxy (handles Data Streams HMAC auth) */
    priceProxyUrl: string;
    /** Which adapter key to use as primary for off-chain fetching (HTTP limit: 5) */
    primaryProtocol: string;
    /** GoPlus chain ID (shared across adapters on same chain) */
    goPlusChainId: string;
    /** Per-adapter API config */
    adapters: Record<string, AdapterApiConfig>;
}

/**
 * Chainlink Data Streams configuration
 */
export interface DataStreamsConfig {
    /** Data Streams API key */
    apiKey: string;
    /** Data Streams API secret */
    apiSecret: string;
    /** Price feed IDs */
    feeds: {
        ETH_USD: string;
        BTC_USD: string;
        USDC_USD: string;
    };
}

/**
 * Shield configuration for rebalancing and emergency actions
 */
export interface ShieldConfig {
    /** Percentage to withdraw on WARNING level (basis points, e.g. 3000 = 30%) */
    warningWithdrawPercent: number;
    /** Key name of the safe haven adapter in addresses config */
    safeHavenAdapter: string;
    /** Max allocation to any single adapter (basis points, e.g. 5000 = 50%) */
    maxSingleAdapterAllocation: number;
    /** Minimum risk score change to trigger rebalance */
    rebalanceThresholdScoreChange: number;
}
