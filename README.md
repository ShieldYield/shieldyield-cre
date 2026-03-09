# 🤖 ShieldYield AI Risk Engine (CRE)

The "Brain" of ShieldYield. This repository contains the **Chainlink Runtime Environment (CRE)** workflows that monitor DeFi protocols, calculate risk scores, and execute emergency protection actions.

## 🧠 Core SDK & Tech Stack

- **Chainlink SDK**: `@chainlink/cre-sdk`
- **Runtime**: Bun / TypeScript
- **Network**: Arbitrum Sepolia (Staging) / CCIP Integration

## 🔄 Workflows Explained

The engine runs three primary workflows defined in `main.ts`:

### 1. 🔍 Sentinel Scan (`sentinel-scan.ts`)
- **Trigger**: Cron (Every 5 minutes).
- **Function**: 
    - Scans all active protocol adapters (Aave, Compound, etc.).
    - Fetches TVL data, utilization rates, and external AI threat scores.
    - Aggregates signals into a 0-100 **Risk Score**.
    - If the score deviates significantly, it performs an on-chain **broadcast** to the `RiskRegistry`.

### 2. ⚖️ AI Rebalancer (`rebalancer.ts`)
- **Trigger**: On-Chain Event (`RiskScoreUpdated`).
- **Function**:
    - Listens for updates in the `RiskRegistry`.
    - If risk levels change (e.g., from SAFE to WATCH), it calculates new optimal weights.
    - Calls `ShieldVault.rebalance()` to shift funds between protocols for optimal yield-to-risk ratio.

### 3. 🛡️ Shield Execute (`shield-execute.ts`)
- **Trigger**: On-Chain Event (`RiskScoreUpdated`).
- **Function**:
    - Handles high-risk scenarios (WARNING/CRITICAL).
    - **WARNING**: Triggers `partialWithdraw` (50%) from the affected protocol to the vault's internal cash reserve.
    - **CRITICAL**: Triggers `emergencyWithdraw` (100%) and moves funds to the **Safe Haven**.
    - **EXTREME**: Initiates `bridgeToSafeChain` via **CCIP** to evacuate funds to another blockchain.

## 🧪 Simulation Suite

Located in `shieldyield-workflow/simulation/`, these scripts allow for end-to-end testing without waiting for real-world exploits:

- **`sim-daemon.ts`** 🧊: Starts the local simulation environment including a mock variance server.
- **`sim-inject.ts`** 💉: The primary CLI tool to inject risk scenarios.
    - `bun simulation/sim-inject.ts warning --trigger`: Simulate a protocol warning.
    - `bun simulation/sim-inject.ts critical --trigger`: Simulate a critical exploit.
- **`sim-finalize-base.ts`** ✅: Oracle instruction to finalize cross-chain claims on the destination chain (Base).
- **`sim-fetcher.ts`** 📡: Mocks the ingestion of external DeFi metrics (TVL, APY).

## 🚀 Setup & Run

### Install Dependencies
```bash
bun install
```

### Run Simulation Daemon
```bash
bun run sim:daemon
```

### Deploy Workflow to Staging
```bash
bun run sim:broadcast:staging
```

---
🤖 *Automated Intelligence. Decentralized Security.*
