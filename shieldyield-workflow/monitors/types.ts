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

// --- DeFiLlama: TVL velocity ---
export interface TvlSignal {
    currentTvl: number;
    tvlChange24hPercent: number; // negative = drop
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
    tvl: TvlSignal;
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
