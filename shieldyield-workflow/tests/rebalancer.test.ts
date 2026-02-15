/**
 * ShieldYield Rebalancer — Unit Tests
 *
 * Run with: npx tsx tests/rebalancer.test.ts
 */

import {
    calculateOptimalAllocations,
    shouldRebalance,
    type PoolAllocation,
    type AdapterRiskInfo,
} from "../rebalancer";
import type { ShieldConfig } from "../monitors/types";

// =============================================
// MOCK DATA FACTORIES
// =============================================

const DEFAULT_SHIELD_CONFIG: ShieldConfig = {
    warningWithdrawPercent: 3000,
    safeHavenAdapter: "aaveAdapter",
    maxSingleAdapterAllocation: 5000, // 50%
    rebalanceThresholdScoreChange: 15,
};

function makePools(): PoolAllocation[] {
    return [
        {
            adapter: "0xAaveAdapter000000000000000000000000000001",
            tier: 0, // LOW
            targetWeight: 3000n,
            currentAmount: 3000000n,
            isActive: true,
        },
        {
            adapter: "0xCompoundAdapter00000000000000000000000002",
            tier: 0, // LOW
            targetWeight: 3000n,
            currentAmount: 3000000n,
            isActive: true,
        },
        {
            adapter: "0xMorphoAdapter0000000000000000000000000003",
            tier: 1, // MEDIUM
            targetWeight: 2000n,
            currentAmount: 2000000n,
            isActive: true,
        },
        {
            adapter: "0xYieldMaxAdapter000000000000000000000000004",
            tier: 2, // HIGH
            targetWeight: 2000n,
            currentAmount: 2000000n,
            isActive: true,
        },
    ];
}

function makeAllSafeRisks(): AdapterRiskInfo[] {
    return [
        { address: "0xAaveAdapter000000000000000000000000000001", riskScore: 5, threatLevel: "SAFE", apy: 300n },
        { address: "0xCompoundAdapter00000000000000000000000002", riskScore: 10, threatLevel: "SAFE", apy: 350n },
        { address: "0xMorphoAdapter0000000000000000000000000003", riskScore: 15, threatLevel: "SAFE", apy: 500n },
        { address: "0xYieldMaxAdapter000000000000000000000000004", riskScore: 20, threatLevel: "SAFE", apy: 800n },
    ];
}

// =============================================
// TEST HELPERS
// =============================================

let testCount = 0;
let passCount = 0;
let failCount = 0;

function assert(condition: boolean, message: string) {
    testCount++;
    if (!condition) {
        failCount++;
        console.error(`  FAIL: ${message}`);
    } else {
        passCount++;
        console.log(`  PASS: ${message}`);
    }
}

// =============================================
// TESTS
// =============================================

function runTests() {
    console.log("\nShieldYield Rebalancer — Unit Tests\n");
    console.log("=".repeat(55));

    // ---- Test 1: All SAFE — allocations based on inverse risk ----
    console.log("\nTest 1: All SAFE — allocations based on inverse risk");
    const allSafe = calculateOptimalAllocations(makePools(), makeAllSafeRisks(), DEFAULT_SHIELD_CONFIG);
    assert(allSafe.length === 4, `Expected 4 allocations, got ${allSafe.length}`);
    const totalWeight = allSafe.reduce((sum, a) => sum + a.newWeight, 0);
    assert(totalWeight === 10000, `Total weight should be 10000, got ${totalWeight}`);

    // Lower risk adapters should get higher allocation
    const aaveAlloc = allSafe.find((a) => a.adapter.includes("Aave"))!;
    const yieldMaxAlloc = allSafe.find((a) => a.adapter.includes("YieldMax"))!;
    assert(
        aaveAlloc.newWeight >= yieldMaxAlloc.newWeight,
        `Aave (low risk) should get >= YieldMax (higher risk): ${aaveAlloc.newWeight} vs ${yieldMaxAlloc.newWeight}`
    );

    // ---- Test 2: One adapter WARNING — gets 0 allocation ----
    console.log("\nTest 2: One WARNING adapter gets 0 allocation");
    const risksWithWarning = makeAllSafeRisks();
    risksWithWarning[3].riskScore = 60;
    risksWithWarning[3].threatLevel = "WARNING";
    const warningResult = calculateOptimalAllocations(makePools(), risksWithWarning, DEFAULT_SHIELD_CONFIG);
    const warningAdapter = warningResult.find((a) => a.adapter.includes("YieldMax"))!;
    assert(warningAdapter.newWeight === 0, `WARNING adapter should get 0, got ${warningAdapter.newWeight}`);
    const warningTotal = warningResult.reduce((sum, a) => sum + a.newWeight, 0);
    assert(warningTotal === 10000, `Total should still be 10000, got ${warningTotal}`);

    // ---- Test 3: One adapter CRITICAL — gets 0 allocation ----
    console.log("\nTest 3: One CRITICAL adapter gets 0 allocation");
    const risksWithCritical = makeAllSafeRisks();
    risksWithCritical[2].riskScore = 90;
    risksWithCritical[2].threatLevel = "CRITICAL";
    const criticalResult = calculateOptimalAllocations(makePools(), risksWithCritical, DEFAULT_SHIELD_CONFIG);
    const criticalAdapter = criticalResult.find((a) => a.adapter.includes("Morpho"))!;
    assert(criticalAdapter.newWeight === 0, `CRITICAL adapter should get 0, got ${criticalAdapter.newWeight}`);

    // ---- Test 4: Max allocation cap enforced ----
    console.log("\nTest 4: Max allocation cap (50%) enforced");
    // With 2 adapters gone (WARNING+CRITICAL), remaining 2 should be capped at 50%
    const risksWithTwoDown = makeAllSafeRisks();
    risksWithTwoDown[2].riskScore = 60;
    risksWithTwoDown[2].threatLevel = "WARNING";
    risksWithTwoDown[3].riskScore = 90;
    risksWithTwoDown[3].threatLevel = "CRITICAL";
    const cappedResult = calculateOptimalAllocations(makePools(), risksWithTwoDown, DEFAULT_SHIELD_CONFIG);
    for (const alloc of cappedResult) {
        assert(
            alloc.newWeight <= DEFAULT_SHIELD_CONFIG.maxSingleAdapterAllocation,
            `${alloc.adapter.slice(0, 10)}... weight ${alloc.newWeight} should be <= ${DEFAULT_SHIELD_CONFIG.maxSingleAdapterAllocation}`
        );
    }

    // ---- Test 5: All adapters WARNING/CRITICAL — all get 0 ----
    console.log("\nTest 5: All WARNING/CRITICAL — all get 0");
    const allBadRisks: AdapterRiskInfo[] = makeAllSafeRisks().map((r) => ({
        ...r,
        riskScore: 80,
        threatLevel: "CRITICAL",
    }));
    const allBadResult = calculateOptimalAllocations(makePools(), allBadRisks, DEFAULT_SHIELD_CONFIG);
    const allZero = allBadResult.every((a) => a.newWeight === 0);
    assert(allZero, "All adapters should get 0 allocation when all are CRITICAL");

    // ---- Test 6: Empty pools ----
    console.log("\nTest 6: Empty pools");
    const emptyResult = calculateOptimalAllocations([], makeAllSafeRisks(), DEFAULT_SHIELD_CONFIG);
    assert(emptyResult.length === 0, `Expected 0 allocations, got ${emptyResult.length}`);

    // ---- Test 7: shouldRebalance — no change ----
    console.log("\nTest 7: shouldRebalance — no significant change");
    const pools = makePools();
    const sameOptimal = pools.map((p) => ({
        adapter: p.adapter,
        newWeight: Number(p.targetWeight),
    }));
    assert(!shouldRebalance(pools, sameOptimal, 500), "Should NOT rebalance when weights match");

    // ---- Test 8: shouldRebalance — significant change ----
    console.log("\nTest 8: shouldRebalance — significant change detected");
    const changedOptimal = pools.map((p) => ({
        adapter: p.adapter,
        newWeight: Number(p.targetWeight) + 1000, // +10% change
    }));
    assert(shouldRebalance(pools, changedOptimal, 500), "Should rebalance when weights differ by >5%");

    // ---- Test 9: shouldRebalance — small change below threshold ----
    console.log("\nTest 9: shouldRebalance — small change below threshold");
    const smallChangeOptimal = pools.map((p) => ({
        adapter: p.adapter,
        newWeight: Number(p.targetWeight) + 200, // +2% change
    }));
    assert(!shouldRebalance(pools, smallChangeOptimal, 500), "Should NOT rebalance for <5% change");

    // ---- Summary ----
    console.log("\n" + "=".repeat(55));
    console.log(`\nResults: ${passCount}/${testCount} passed, ${failCount} failed\n`);

    if (failCount > 0) {
        console.log("SOME TESTS FAILED!");
        process.exit(1);
    } else {
        console.log("All tests passed!");
    }
}

runTests();
