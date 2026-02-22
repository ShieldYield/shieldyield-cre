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

// --- TVL: Calculated from on-chain balance * Chainlink price, tracked over time ---
export interface TvlSignal {
    /** Current TVL in USD (adapter balance * usdcPrice) */
    currentTvl: number;
    /** TVL change% from historical snapshot (via tvl-history proxy), fallback to balance vs principal */
    tvlChangePercent: number;
}

// --- Chainlink Price Feeds: On-chain price data ---
export interface PriceSignal {
    ethUsd: number;  // ETH/USD price
    btcUsd: number;  // BTC/USD price
    usdcUsd: number; // USDC/USD price
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

// --- DeFi Protocol Metrics: Fetched via Next.js proxy (Phase 2) ---
export interface AaveMetricsSignal {
    totalSupplied: string;   // USDC amount
    totalBorrowed: string;   // USDC amount
    supplyApy: number;       // %
    borrowApy: number;       // %
    utilization: number;     // %
}

export interface CompoundMetricsSignal {
    totalSupply: string;     // USDC amount
    totalBorrow: string;     // USDC amount
    utilization: number;     // %
    supplyApr: number;       // %
    borrowApr: number;       // %
}

export interface DefiMetricsSignal {
    aave: AaveMetricsSignal | null;
    compound: CompoundMetricsSignal | null;
}

export interface OffchainSignals {
    prices: PriceSignal;
    tvl: TvlSignal;
    defiMetrics: DefiMetricsSignal;
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
    /** URL of the TVL history proxy for historical tracking */
    tvlHistoryUrl: string;
    /** URL of the DeFi metrics proxy (AAVE/Compound lending data) */
    defiMetricsUrl: string;
    /** Which adapter key to use as primary for off-chain fetching (HTTP limit: 5) */
    primaryProtocol: string;
    /** GoPlus chain ID (shared across adapters on same chain) */
    goPlusChainId: string;
    /** Per-adapter API config */
    adapters: Record<string, AdapterApiConfig>;
}

/**
 * Chainlink On-Chain Price Feed addresses per chain
 */
export interface PriceFeedsConfig {
    /** ETH/USD AggregatorV3 contract address */
    ETH_USD: string;
    /** BTC/USD AggregatorV3 contract address */
    BTC_USD: string;
    /** USDC/USD AggregatorV3 contract address (zero address = fallback to 1.0) */
    USDC_USD: string;
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
