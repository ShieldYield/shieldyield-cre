import {
    EVMClient,
    getNetwork,
} from "@chainlink/cre-sdk";
import {
    keccak256,
    toBytes,
} from "viem";

import type { ShieldConfig, OffchainApisConfig, PriceFeedsConfig } from "../monitors/types";

// ========================================
// TYPE DEFINITIONS
// ========================================

export type Addresses = {
    mockUSDC?: string;
    faucet?: string;
    riskRegistry?: string;
    shieldVault?: string;
    shieldBridge?: string;
    aaveAdapter?: string;
    compoundAdapter?: string;
    morphoAdapter?: string;
    yieldMaxAdapter?: string;
};

export type EvmConfig = {
    chainName: string;
    priceFeeds?: PriceFeedsConfig;
    addresses: Addresses[];
};

export type Config = {
    schedule: string;
    evms: EvmConfig[];
    offchainApis: OffchainApisConfig;
    priceFeeds: PriceFeedsConfig;
    shieldConfig: ShieldConfig;
};

// ========================================
// SHARED HELPERS & CONSTANTS
// ========================================

export function createEvmClient(chainName: string): EVMClient {
    const network = getNetwork({
        chainFamily: "evm",
        chainSelectorName: chainName,
        isTestnet: true,
    });

    if (!network) {
        throw new Error(`Network not found: ${chainName}`);
    }

    return new EVMClient(network.chainSelector.selector);
}

/** RiskScoreUpdated(address indexed protocol, uint8 oldScore, uint8 newScore, ThreatLevel threatLevel) */
export const RISK_SCORE_UPDATED_SIG = keccak256(
    toBytes("RiskScoreUpdated(address,uint8,uint8,uint8)")
);

// Threat level enum values matching Solidity
export const THREAT_LEVEL = {
    SAFE: 0,
    WATCH: 1,
    WARNING: 2,
    CRITICAL: 3,
} as const;
