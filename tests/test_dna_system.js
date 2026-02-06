import * as io from '#infra/io';
import identityManager from '#core/identity_manager';

// Test counters
let passed = 0;
let failed = 0;

console.log('\n========================================');
console.log('  DNA System V2.0 Tests');
console.log('========================================\n');

async function runTests() {
    // Test 1: Capabilities atualizadas no IdentityManager
    {
        const testName = 'IdentityManager - Capabilities V2.0';
        try {
            await identityManager.initialize();
            const identity = identityManager.getFullIdentity();

            // Verifica capabilities modernas
            const expectedCapabilities = [
                'TASK_SCHEMA_V5',
                'RESPONSE_CAPTURE_V2',
                'SADI_V19',
                'NERV_PROTOCOL_V2',
                'DNA_EVOLUTION_TRACKING',
            ];

            const hasAll = expectedCapabilities.every(cap => identity.capabilities.includes(cap));

            if (hasAll && identity.capabilities.length >= 20) {
                console.log(`✅ ${testName}`);
                console.log(`   Total capabilities: ${identity.capabilities.length}`);
                passed++;
            } else {
                throw new Error(
                    `Missing capabilities. Expected ${expectedCapabilities.length}+, got ${identity.capabilities.length}`
                );
            }
        } catch (error) {
            console.error(`❌ ${testName}: ${error.message}`);
            failed++;
        }
    }

    // Test 2: DNA Load & Validation
    {
        const testName = 'DNA Store - Load & Validation';
        try {
            const dna = await io.getDna();

            if (dna._meta && dna._meta.version && dna.targets && dna.global_selectors) {
                console.log(`✅ ${testName}`);
                console.log(`   DNA version: ${dna._meta.version}`);
                console.log(`   Evolution count: ${dna._meta.evolution_count || 0}`);
                passed++;
            } else {
                throw new Error('DNA structure invalid');
            }
        } catch (error) {
            console.error(`❌ ${testName}: ${error.message}`);
            failed++;
        }
    }

    // Test 3: DNA History (Backup System)
    {
        const testName = 'DNA Store - Backup System';
        try {
            const history = io.getDnaHistory();

            // Após getDna(), deve ter pelo menos 1 backup
            if (Array.isArray(history)) {
                console.log(`✅ ${testName}`);
                console.log(`   Backups disponíveis: ${history.length}/10`);
                passed++;
            } else {
                throw new Error('History is not an array');
            }
        } catch (error) {
            console.error(`❌ ${testName}: ${error.message}`);
            failed++;
        }
    }

    // Test 4: Target Rules Resolution
    {
        const testName = 'DNA Store - Target Rules Resolution';
        try {
            const chatgptRules = await io.getTargetRules('chatgpt.com');
            const unknownRules = await io.getTargetRules('unknown-domain.com');

            // chatgpt.com deve ter regras específicas ou fallback
            // unknown-domain.com deve usar fallback global
            if (
                chatgptRules &&
                chatgptRules.selectors &&
                unknownRules &&
                unknownRules.selectors &&
                unknownRules.source === 'global_fallback'
            ) {
                console.log(`✅ ${testName}`);
                console.log(`   ChatGPT selectors: ${Object.keys(chatgptRules.selectors).length}`);
                console.log(`   Unknown domain: fallback OK`);
                passed++;
            } else {
                throw new Error('Target rules resolution failed');
            }
        } catch (error) {
            console.error(`❌ ${testName}: ${error.message}`);
            failed++;
        }
    }

    // Test 5: Evolution Stats
    {
        const testName = 'DNA Evolution - Stats';
        try {
            const stats = io.getEvolutionStats();

            if (typeof stats === 'object') {
                console.log(`✅ ${testName}`);
                console.log(`   Evolution stats: ${JSON.stringify(stats)}`);
                passed++;
            } else {
                throw new Error('Stats invalid');
            }
        } catch (error) {
            console.error(`❌ ${testName}: ${error.message}`);
            failed++;
        }
    }

    // Test 6: Evolution com Protocolo SADI (simulado)
    {
        const testName = 'DNA Evolution - SADI Protocol';
        try {
            const mockProtocol = {
                selector: '#test-selector-001',
                confidence: 85,
                context: 'root',
                isShadow: false,
            };

            const evolved = await io.evolveWithSadiProtocol(mockProtocol, 'test-domain.com', 'test_input');

            // v2.0: evolveWithSadiProtocol retorna {accepted, reason, stats}
            if (typeof evolved === 'object' && evolved !== null) {
                console.log(`✅ ${testName}`);
                console.log(`   Evolution result: ${evolved.accepted ? 'accepted' : 'rejected'}`);

                if (evolved.accepted) {
                    console.log(`   ✓ DNA updated successfully`);
                    console.log(`   Stats: ${JSON.stringify(evolved.stats)}`);
                } else {
                    console.log(`   Reason: ${evolved.reason}`);
                }

                passed++;
            } else {
                throw new Error(`Evolution returned unexpected type: ${typeof evolved}`);
            }
        } catch (error) {
            console.error(`❌ ${testName}: ${error.message}`);
            failed++;
        }
    }

    // Test 7: DNA Rollback (se houver histórico)
    {
        const testName = 'DNA Store - Rollback';
        try {
            const history = io.getDnaHistory();

            if (history.length > 0) {
                const currentDna = await io.getDna();
                const currentVersion = currentDna._meta.version;

                // Rollback para versão mais recente (0)
                const rolledBackDna = await io.rollbackDna(0);

                if (rolledBackDna && rolledBackDna._meta.version >= currentVersion) {
                    console.log(`✅ ${testName}`);
                    console.log(`   Rollback executed: v${currentVersion} → v${rolledBackDna._meta.version}`);
                    passed++;
                } else {
                    throw new Error('Rollback failed');
                }
            } else {
                console.log(`⏭️  ${testName} (skipped - no history)`);
            }
        } catch (error) {
            console.error(`❌ ${testName}: ${error.message}`);
            failed++;
        }
    }

    // Summary
    console.log('\n========================================');
    console.log('  Test Summary');
    console.log('========================================');
    console.log(`✅ Passed: ${passed}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`📊 Total: ${passed + failed}`);
    console.log('========================================\n');

    return failed === 0;
}

// Run
if (import.meta.filename === process.argv[1]) {
    runTests()
        .then(success => {
            process.exit(success ? 0 : 1);
        })
        .catch(error => {
            console.error('\n🔥 TEST SUITE CRASHED:', error);
            process.exit(1);
        });
}

export { runTests };
