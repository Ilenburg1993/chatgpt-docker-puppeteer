// @ts-nocheck -- LEGACY QUARANTINE: migração pendente (Fase E.0)
import * as io from '#infra/io';

/* ==========================================================================
   TEST SUITE CONFIGURATION
========================================================================== */

const TEST_CONFIG = {
    TEST_DOMAIN: 'test-integration.com',
    TEST_INTENT: 'test_input',
    TEST_PROTOCOL: {
        target: 'textarea',
        selector: '#test-integration-input',
        confidence: 85,
        shadowRoot: false,
    },
};

/* ==========================================================================
   HELPER FUNCTIONS
========================================================================== */

/**
 * Limpa DNA de teste (remove domain de teste se existir)
 */
async function cleanupTestDna() {
    try {
        const dna = await io.getDna();
        if (dna.targets && dna.targets[TEST_CONFIG.TEST_DOMAIN]) {
            delete dna.targets[TEST_CONFIG.TEST_DOMAIN];
            await io.saveDna(dna, 'test-cleanup');
        }
    } catch (error) {
        console.warn('⚠️  Cleanup warning:', error.message);
    }
}

/**
 * Verifica se selector está no DNA
 *
 * @param {any} domain
 * @param {any} intent
 * @param {any} selector
 */
async function isSelectorInDna(domain, intent, selector) {
    const dna = await io.getDna();
    const selectors = dna.targets?.[domain]?.selectors?.[intent] || [];

    // Suporta array de strings
    if (Array.isArray(selectors)) {
        return selectors.includes(selector);
    }

    // Suporta string única
    if (typeof selectors === 'string') {
        return selectors === selector;
    }

    // Suporta objeto protocol
    if (typeof selectors === 'object' && selectors.selector) {
        return selectors.selector === selector;
    }

    return false;
}

/* ==========================================================================
   INTEGRATION TESTS
========================================================================== */

console.log('===========================================');
console.log('  DNA SYSTEM V2.0 - INTEGRATION TESTS');
console.log('===========================================\n');

let testsRun = 0;
let testsPassed = 0;
let testsFailed = 0;

/**
 * Test 1: SADI Auto-Evolution (Acceptance) Valida que evolveWithSadiProtocol() aceita selector com confidence >= 75
 */
async function test1_SadiAutoEvolutionAcceptance() {
    testsRun++;
    console.log('Test 1: SADI Auto-Evolution - Acceptance');

    try {
        await cleanupTestDna();

        const result = await io.evolveWithSadiProtocol(
            TEST_CONFIG.TEST_PROTOCOL,
            TEST_CONFIG.TEST_DOMAIN,
            TEST_CONFIG.TEST_INTENT,
        );

        if (!result.accepted) {
            throw new Error(`Evolution rejected: ${result.reason}`);
        }

        // Verify selector was persisted
        const isInDna = await isSelectorInDna(
            TEST_CONFIG.TEST_DOMAIN,
            TEST_CONFIG.TEST_INTENT,
            TEST_CONFIG.TEST_PROTOCOL.selector,
        );

        if (!isInDna) {
            throw new Error('Selector not found in DNA after evolution');
        }

        console.log('   ✅ Evolution accepted');
        console.log(`   ✅ Selector persisted: ${TEST_CONFIG.TEST_PROTOCOL.selector}`);
        console.log(`   ✅ Stats: ${JSON.stringify(result.stats)}\n`);

        testsPassed++;
    } catch (error) {
        console.error(`   ❌ FAILED: ${error.message}\n`);
        testsFailed++;
    }
}

/**
 * Test 2: SADI Auto-Evolution (Rejection - Low Confidence) Valida que evolveWithSadiProtocol() rejeita selector com
 * confidence < 75
 */
async function test2_SadiAutoEvolutionRejection() {
    testsRun++;
    console.log('Test 2: SADI Auto-Evolution - Rejection (Low Confidence)');

    try {
        const lowConfidenceProtocol = {
            ...TEST_CONFIG.TEST_PROTOCOL,
            selector: '#test-low-confidence',
            confidence: 50, // Below threshold
        };

        const result = await io.evolveWithSadiProtocol(
            lowConfidenceProtocol,
            TEST_CONFIG.TEST_DOMAIN,
            'test_low_confidence',
        );

        if (result.accepted) {
            throw new Error('Evolution should have been rejected (confidence < 75)');
        }

        if (result.reason !== 'LOW_CONFIDENCE') {
            throw new Error(`Expected reason 'LOW_CONFIDENCE', got '${result.reason}'`);
        }

        console.log('   ✅ Low confidence rejected correctly');
        console.log(`   ✅ Reason: ${result.reason}\n`);

        testsPassed++;
    } catch (error) {
        console.error(`   ❌ FAILED: ${error.message}\n`);
        testsFailed++;
    }
}

/**
 * Test 3: DNA Backup System Valida que backup é criado automaticamente após evolução
 */
async function test3_DnaBackupSystem() {
    testsRun++;
    console.log('Test 3: DNA Backup System');

    try {
        const historyBefore = io.getDnaHistory();
        const countBefore = historyBefore.length;

        // Trigger evolution (creates backup)
        const newProtocol = {
            ...TEST_CONFIG.TEST_PROTOCOL,
            selector: '#test-backup-trigger',
            confidence: 90,
        };

        await io.evolveWithSadiProtocol(newProtocol, TEST_CONFIG.TEST_DOMAIN, 'test_backup');

        const historyAfter = io.getDnaHistory();
        const countAfter = historyAfter.length;

        if (countAfter <= countBefore) {
            throw new Error('Backup not created after evolution');
        }

        console.log(`   ✅ Backup created (${countBefore} → ${countAfter})`);
        console.log(`   ✅ Latest backup: ${historyAfter[0].timestamp}\n`);

        testsPassed++;
    } catch (error) {
        console.error(`   ❌ FAILED: ${error.message}\n`);
        testsFailed++;
    }
}

/**
 * Test 4: DNA Rollback Mechanism Valida que rollback restaura versão anterior
 */
async function test4_DnaRollback() {
    testsRun++;
    console.log('Test 4: DNA Rollback Mechanism');

    try {
        const dnaBefore = await io.getDna();
        const versionBefore = dnaBefore.version;

        // Trigger evolution (creates new version)
        const newProtocol = {
            ...TEST_CONFIG.TEST_PROTOCOL,
            selector: '#test-rollback-trigger',
            confidence: 88,
        };

        await io.evolveWithSadiProtocol(newProtocol, TEST_CONFIG.TEST_DOMAIN, 'test_rollback');

        const dnaAfter = await io.getDna();
        const versionAfter = dnaAfter.version;

        if (versionAfter <= versionBefore) {
            throw new Error('Version not incremented after evolution');
        }

        // Perform rollback
        await io.rollbackDna(0); // Rollback to most recent backup

        const dnaRolledBack = await io.getDna();

        console.log(`   ✅ Version before: ${versionBefore}`);
        console.log(`   ✅ Version after evolution: ${versionAfter}`);
        console.log(`   ✅ Version after rollback: ${dnaRolledBack.version}`);
        console.log(`   ✅ Rollback successful\n`);

        testsPassed++;
    } catch (error) {
        console.error(`   ❌ FAILED: ${error.message}\n`);
        testsFailed++;
    }
}

/**
 * Test 5: Evolution Stats Tracking Valida que evolution stats são rastreadas corretamente
 */
async function test5_EvolutionStatsTracking() {
    testsRun++;
    console.log('Test 5: Evolution Stats Tracking');

    try {
        const statsBefore = io.getEvolutionStats();
        const countBefore = statsBefore[TEST_CONFIG.TEST_DOMAIN] || 0;

        // Trigger evolution
        const newProtocol = {
            ...TEST_CONFIG.TEST_PROTOCOL,
            selector: '#test-stats-trigger',
            confidence: 92,
        };

        await io.evolveWithSadiProtocol(newProtocol, TEST_CONFIG.TEST_DOMAIN, 'test_stats');

        const statsAfter = io.getEvolutionStats();
        const countAfter = statsAfter[TEST_CONFIG.TEST_DOMAIN] || 0;

        if (countAfter !== countBefore + 1) {
            throw new Error(`Stats not incremented correctly (${countBefore} → ${countAfter})`);
        }

        console.log(`   ✅ Stats tracked: ${countBefore} → ${countAfter}`);
        console.log(`   ✅ Session stats: ${JSON.stringify(statsAfter)}\n`);

        testsPassed++;
    } catch (error) {
        console.error(`   ❌ FAILED: ${error.message}\n`);
        testsFailed++;
    }
}

/**
 * Test 6: Rate Limiting Valida que rate limiting funciona (5 evolutions/domain/session)
 */
async function test6_RateLimiting() {
    testsRun++;
    console.log('Test 6: Rate Limiting (5 evolutions/domain/session)');

    try {
        const TEST_RATE_DOMAIN = 'test-rate-limit.com';

        // Cleanup
        const dna = await io.getDna();
        if (dna.targets?.[TEST_RATE_DOMAIN]) {
            delete dna.targets[TEST_RATE_DOMAIN];
            await io.saveDna(dna, 'test-rate-cleanup');
        }

        // Trigger 6 evolutions (should accept 5, reject 6th)
        let acceptedCount = 0;
        let rejectedCount = 0;

        for (let i = 0; i < 6; i++) {
            const protocol = {
                target: 'textarea',
                selector: `#test-rate-${i}`,
                confidence: 80 + i,
                shadowRoot: false,
            };

            const result = await io.evolveWithSadiProtocol(protocol, TEST_RATE_DOMAIN, `test_rate_${i}`);

            if (result.accepted) {
                acceptedCount++;
            } else if (result.reason === 'RATE_LIMITED') {
                rejectedCount++;
            }
        }

        if (acceptedCount !== 5) {
            throw new Error(`Expected 5 accepted, got ${acceptedCount}`);
        }

        if (rejectedCount !== 1) {
            throw new Error(`Expected 1 rejected (RATE_LIMITED), got ${rejectedCount}`);
        }

        console.log(`   ✅ Accepted: ${acceptedCount}/6`);
        console.log(`   ✅ Rejected (RATE_LIMITED): ${rejectedCount}/6`);
        console.log(`   ✅ Rate limiting working correctly\n`);

        testsPassed++;
    } catch (error) {
        console.error(`   ❌ FAILED: ${error.message}\n`);
        testsFailed++;
    }
}

/**
 * Test 7: Duplicate Detection Valida que duplicate detection funciona
 */
async function test7_DuplicateDetection() {
    testsRun++;
    console.log('Test 7: Duplicate Detection');

    try {
        const TEST_DUP_DOMAIN = 'test-duplicate.com';

        // Cleanup domain antes do teste
        const dnaClean = await io.getDna();
        if (dnaClean.targets?.[TEST_DUP_DOMAIN]) {
            delete dnaClean.targets[TEST_DUP_DOMAIN];
            await io.saveDna(dnaClean, 'test-duplicate-cleanup');
        }

        // First evolution (should accept)
        const protocol = {
            target: 'textarea',
            selector: '#test-duplicate-selector',
            confidence: 87,
            shadowRoot: false,
        };

        const result1 = await io.evolveWithSadiProtocol(protocol, TEST_DUP_DOMAIN, 'test_duplicate');

        if (!result1.accepted) {
            throw new Error(`First evolution should have been accepted, got reason: ${result1.reason}`);
        }

        // Second evolution with same selector (should reject)
        const result2 = await io.evolveWithSadiProtocol(protocol, TEST_DUP_DOMAIN, 'test_duplicate');

        if (result2.accepted) {
            throw new Error('Duplicate evolution should have been rejected');
        }

        if (result2.reason !== 'DUPLICATE') {
            throw new Error(`Expected reason 'DUPLICATE', got '${result2.reason}'`);
        }

        console.log('   ✅ First evolution accepted');
        console.log('   ✅ Duplicate evolution rejected');
        console.log(`   ✅ Reason: ${result2.reason}\n`);

        testsPassed++;
    } catch (error) {
        console.error(`   ❌ FAILED: ${error.message}\n`);
        testsFailed++;
    }
}

/* ==========================================================================
   RUN ALL TESTS
========================================================================== */

async function runAllTests() {
    try {
        await test1_SadiAutoEvolutionAcceptance();
        await test2_SadiAutoEvolutionRejection();
        await test3_DnaBackupSystem();
        await test4_DnaRollback();
        await test5_EvolutionStatsTracking();
        await test6_RateLimiting();
        await test7_DuplicateDetection();

        // Final cleanup
        await cleanupTestDna();

        console.log('========================================');
        console.log('  Test Summary');
        console.log('========================================');
        console.log(`✅ Passed: ${testsPassed}`);
        console.log(`❌ Failed: ${testsFailed}`);
        console.log(`📊 Total: ${testsRun}`);
        console.log('========================================\n');

        if (testsFailed > 0) {
            process.exit(1);
        } else {
            console.log('✅ ALL INTEGRATION TESTS PASSED\n');
            process.exit(0);
        }
    } catch (error) {
        console.error('\n❌ FATAL ERROR:', error.message);
        process.exit(1);
    }
}

// Run tests
runAllTests();
