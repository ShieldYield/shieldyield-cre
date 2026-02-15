import type { ShieldConfig } from "../monitors/types";

// ========================================
// TYPES
// ========================================

export interface PoolAllocation {
    adapter: string;   // address
    tier: number;      // 0=LOW, 1=MEDIUM, 2=HIGH
    targetWeight: bigint;
    currentAmount: bigint;
    isActive: boolean;
}

export interface AdapterRiskInfo {
    address: string;
    riskScore: number;
    threatLevel: string; // "SAFE" | "WATCH" | "WARNING" | "CRITICAL"
    apy: bigint;
}

export interface AllocationResult {
    adapter: string;
    newWeight: number; // basis points
}

// ========================================
// CONSTANTS
// ========================================

const BASIS_POINTS = 10000;

// ========================================
// REBALANCER LOGIC
// ========================================

/**
 * Calculate optimal allocations based on current risk scores and APY data.
 *
 * Strategy:
 * - Adapters with WARNING/CRITICAL get 0 allocation
 * - Remaining adapters split proportionally by inverse risk score * APY bonus
 * - No single adapter exceeds maxSingleAdapterAllocation
 * - Weights must sum to 10000 (100%)
 */
export function calculateOptimalAllocations(
    pools: PoolAllocation[],
    riskInfo: AdapterRiskInfo[],
    config: ShieldConfig
): AllocationResult[] {
    const activePools = pools.filter((p) => p.isActive);

    if (activePools.length === 0) {
        return [];
    }

    // Build a map of risk info by address (lowercase for comparison)
    const riskMap = new Map<string, AdapterRiskInfo>();
    for (const r of riskInfo) {
        riskMap.set(r.address.toLowerCase(), r);
    }

    // Step 1: Calculate raw scores for each pool
    // Higher score = more desirable allocation
    const poolScores: { adapter: string; score: number }[] = [];

    for (const pool of activePools) {
        const risk = riskMap.get(pool.adapter.toLowerCase());

        // Skip adapters with WARNING or CRITICAL threat level
        if (risk && (risk.threatLevel === "WARNING" || risk.threatLevel === "CRITICAL")) {
            poolScores.push({ adapter: pool.adapter, score: 0 });
            continue;
        }

        // Inverse risk score: lower risk = higher desirability
        const riskScore = risk?.riskScore ?? 0;
        const inverseRisk = Math.max(1, 100 - riskScore);

        // APY bonus: higher APY = slightly more desirable (capped to prevent chasing yield)
        const apyBps = risk ? Number(risk.apy) : 0;
        const apyBonus = Math.min(apyBps / 100, 20); // Max 20 points from APY

        const desirability = inverseRisk + apyBonus;
        poolScores.push({ adapter: pool.adapter, score: desirability });
    }

    // Step 2: Normalize to basis points
    const totalScore = poolScores.reduce((sum, p) => sum + p.score, 0);

    if (totalScore === 0) {
        // All adapters are WARNING/CRITICAL — return zero allocations
        return poolScores.map((p) => ({ adapter: p.adapter, newWeight: 0 }));
    }

    const maxAlloc = config.maxSingleAdapterAllocation;
    let results: AllocationResult[] = poolScores.map((p) => ({
        adapter: p.adapter,
        newWeight: Math.round((p.score / totalScore) * BASIS_POINTS),
    }));

    // Step 3: Cap any single adapter at maxSingleAdapterAllocation
    let capped = true;
    while (capped) {
        capped = false;
        let excess = 0;
        let uncappedCount = 0;

        for (const r of results) {
            if (r.newWeight > maxAlloc) {
                excess += r.newWeight - maxAlloc;
                r.newWeight = maxAlloc;
                capped = true;
            } else if (r.newWeight > 0) {
                uncappedCount++;
            }
        }

        // Redistribute excess to uncapped pools
        if (excess > 0 && uncappedCount > 0) {
            const perPool = Math.floor(excess / uncappedCount);
            for (const r of results) {
                if (r.newWeight > 0 && r.newWeight < maxAlloc) {
                    r.newWeight += perPool;
                }
            }
        }
    }

    // Step 4: Ensure weights sum to exactly 10000
    const totalWeight = results.reduce((sum, r) => sum + r.newWeight, 0);
    if (totalWeight > 0 && totalWeight !== BASIS_POINTS) {
        const diff = BASIS_POINTS - totalWeight;
        // Add/subtract the difference from the highest-weighted pool
        const largest = results.reduce((max, r) =>
            r.newWeight > max.newWeight ? r : max
        );
        largest.newWeight += diff;
    }

    return results;
}

/**
 * Determine if rebalancing is needed based on current vs optimal allocations.
 */
export function shouldRebalance(
    currentPools: PoolAllocation[],
    optimal: AllocationResult[],
    thresholdBps: number = 500 // 5% default threshold
): boolean {
    for (const pool of currentPools) {
        const optimalEntry = optimal.find(
            (o) => o.adapter.toLowerCase() === pool.adapter.toLowerCase()
        );
        if (!optimalEntry) continue;

        const currentWeight = Number(pool.targetWeight);
        const diff = Math.abs(currentWeight - optimalEntry.newWeight);

        if (diff >= thresholdBps) {
            return true;
        }
    }
    return false;
}
