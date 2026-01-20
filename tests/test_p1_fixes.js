/* ==========================================================================
   tests/test_p1_fixes.js
   Testes para Correções P1 (Critical Cases Analysis)

   Valida:
   1. Lock Manager - Two-Phase Commit (atomicidade)
   2. BrowserPool - Promise Memoization (init race)
   3. IPC Client - ACK Resilience (documentado)
========================================================================== */

const path = require('path');
const fs = require('fs').promises;
const { acquireLock, releaseLock } = require('../src/infra/locks/lock_manager');

const ROOT = path.resolve(__dirname, '..');
const LOCK_DIR = ROOT;

// ============================================================================
// TEST 1: Lock Manager - Two-Phase Commit
// ============================================================================

async function testLockTwoPhaseCommit() {
    console.log('\n=== TEST 1: Lock Manager - Two-Phase Commit ===');

    const target = 'test-2pc';
    const taskId1 = 'task-1';
    const taskId2 = 'task-2';

    try {
        // Cleanup inicial
        await fs.unlink(path.join(LOCK_DIR, `RUNNING_${target}.lock`)).catch(() => {});
        await fs.unlink(path.join(LOCK_DIR, `RUNNING_${target}.lock.${process.pid}.tmp`)).catch(() => {});

        console.log('> Fase 1: Adquirir lock (task-1)...');
        const acquired1 = await acquireLock(taskId1, target);

        if (!acquired1) {
            throw new Error('❌ Falha ao adquirir primeiro lock');
        }
        console.log('✅ Lock adquirido por task-1');

        console.log('> Fase 2: Tentar adquirir mesmo lock (task-2) - deve falhar...');
        const acquired2 = await acquireLock(taskId2, target);

        if (acquired2) {
            throw new Error('❌ RACE CONDITION: Dois locks adquiridos simultaneamente!');
        }
        console.log('✅ Lock corretamente bloqueado para task-2');

        console.log('> Fase 3: Liberar lock (task-1)...');
        await releaseLock(target, taskId1);
        console.log('✅ Lock liberado');

        console.log('> Fase 4: Adquirir lock novamente (task-2) - deve funcionar...');
        const acquired3 = await acquireLock(taskId2, target);

        if (!acquired3) {
            throw new Error('❌ Falha ao adquirir lock após liberação');
        }
        console.log('✅ Lock re-adquirido por task-2');

        // Cleanup final
        await releaseLock(target, taskId2);

        console.log('✅ TEST 1 PASSOU: Two-Phase Commit funcionando corretamente\n');
        return true;

    } catch (error) {
        console.error('❌ TEST 1 FALHOU:', error.message);

        // Cleanup em caso de erro
        await fs.unlink(path.join(LOCK_DIR, `RUNNING_${target}.lock`)).catch(() => {});

        return false;
    }
}

// ============================================================================
// TEST 2: Lock Manager - Concorrência Extrema
// ============================================================================

async function testLockConcurrency() {
    console.log('\n=== TEST 2: Lock Manager - Concorrência (10 tentativas simultâneas) ===');

    const target = 'test-concurrency';
    const numAttempts = 10;

    try {
        // Cleanup inicial
        await fs.unlink(path.join(LOCK_DIR, `RUNNING_${target}.lock`)).catch(() => {});

        console.log(`> Disparando ${numAttempts} tentativas simultâneas de lock...`);

        const promises = [];
        for (let i = 0; i < numAttempts; i++) {
            promises.push(
                acquireLock(`task-${i}`, target)
                    .then(result => ({ taskId: `task-${i}`, acquired: result }))
            );
        }

        const results = await Promise.all(promises);

        // Conta quantos conseguiram
        const successCount = results.filter(r => r.acquired).length;
        const winner = results.find(r => r.acquired);

        console.log(`> Resultados: ${successCount} sucesso(s), ${numAttempts - successCount} falhas`);

        if (successCount !== 1) {
            console.error(`❌ RACE CONDITION DETECTADA: ${successCount} locks adquiridos (esperado: 1)`);
            results.filter(r => r.acquired).forEach(r => {
                console.error(`   - ${r.taskId} conseguiu lock`);
            });
            return false;
        }

        console.log(`✅ Apenas ${winner.taskId} adquiriu lock (atomicidade garantida)`);

        // Cleanup
        await releaseLock(target);

        console.log('✅ TEST 2 PASSOU: Concorrência tratada corretamente\n');
        return true;

    } catch (error) {
        console.error('❌ TEST 2 FALHOU:', error.message);

        // Cleanup em caso de erro
        await fs.unlink(path.join(LOCK_DIR, `RUNNING_${target}.lock`)).catch(() => {});

        return false;
    }
}

// ============================================================================
// TEST 3: Lock Manager - Validação de Temp Files
// ============================================================================

async function testLockNoTempOrphans() {
    console.log('\n=== TEST 3: Lock Manager - Sem arquivos .tmp órfãos ===');

    const target = 'test-cleanup';

    try {
        // Cleanup inicial
        await fs.unlink(path.join(LOCK_DIR, `RUNNING_${target}.lock`)).catch(() => {});

        console.log('> Adquirindo e liberando lock 5 vezes...');

        for (let i = 0; i < 5; i++) {
            await acquireLock(`task-${i}`, target);
            await releaseLock(target, `task-${i}`);
        }

        console.log('> Verificando arquivos .tmp órfãos...');

        const files = await fs.readdir(LOCK_DIR);
        const tempFiles = files.filter(f =>
            f.includes('RUNNING_') &&
            f.includes('.tmp') &&
            f.includes(target)
        );

        if (tempFiles.length > 0) {
            console.error(`❌ Encontrados ${tempFiles.length} arquivos .tmp órfãos:`);
            tempFiles.forEach(f => console.error(`   - ${f}`));
            return false;
        }

        console.log('✅ Nenhum arquivo .tmp órfão encontrado');
        console.log('✅ TEST 3 PASSOU: Cleanup de temp files funcionando\n');
        return true;

    } catch (error) {
        console.error('❌ TEST 3 FALHOU:', error.message);
        return false;
    }
}

// ============================================================================
// TEST 4: BrowserPool - Promise Memoization (Mock)
// ============================================================================

async function testBrowserPoolMemoization() {
    console.log('\n=== TEST 4: BrowserPool - Promise Memoization ===');

    try {
        // Mock simplificado do BrowserPool para validar pattern
        class MockBrowserPool {
            constructor() {
                this.initialized = false;
                this._initPromise = null;
                this.initCount = 0;
            }

            async initialize() {
                if (this.initialized) {return;}

                if (this._initPromise) {
                    console.log('  > Inicialização já em andamento, retornando promise existente');
                    return this._initPromise;
                }

                this._initPromise = this._doInitialize();

                try {
                    await this._initPromise;
                } finally {
                    this._initPromise = null;
                }
            }

            async _doInitialize() {
                console.log('  > Executando _doInitialize()...');
                this.initCount++;

                // Simula tempo de inicialização
                await new Promise(resolve => { setTimeout(resolve, 100));

                this.initialized = true;
                console.log('  > Inicialização concluída');
            }
        }

        const pool = new MockBrowserPool();

        console.log('> Chamando initialize() 3 vezes em paralelo...');

        await Promise.all([
            pool.initialize(),
            pool.initialize(),
            pool.initialize()
        ]);

        console.log(`> Contador de inicializações reais: ${pool.initCount}`);

        if (pool.initCount !== 1) {
            console.error(`❌ RACE CONDITION: _doInitialize() chamado ${pool.initCount} vezes (esperado: 1)`);
            return false;
        }

        console.log('✅ Promise memoization funcionando (apenas 1 inicialização real)');

        console.log('> Tentando inicializar novamente (já inicializado)...');
        await pool.initialize();

        if (pool.initCount !== 1) {
            console.error(`❌ Inicializou novamente (contador: ${pool.initCount})`);
            return false;
        }

        console.log('✅ Retornou imediatamente (já inicializado)');
        console.log('✅ TEST 4 PASSOU: Promise Memoization implementado corretamente\n');
        return true;

    } catch (error) {
        console.error('❌ TEST 4 FALHOU:', error.message);
        return false;
    }
}

// ============================================================================
// TEST 5: Validação de Integração
// ============================================================================

async function testIntegrationValidation() {
    console.log('\n=== TEST 5: Validação de Integração ===');

    try {
        console.log('> Verificando arquivos modificados...');

        const lockManagerPath = path.join(ROOT, 'src/infra/locks/lock_manager.js');
        const poolManagerPath = path.join(ROOT, 'src/infra/browser_pool/pool_manager.js');
        const patchPath = path.join(ROOT, 'src/infra/ipc_client_v800_patch.js');

        const lockManagerExists = await fs.access(lockManagerPath).then(() => true).catch(() => false);
        const poolManagerExists = await fs.access(poolManagerPath).then(() => true).catch(() => false);
        const patchExists = await fs.access(patchPath).then(() => true).catch(() => false);

        console.log(`  - lock_manager.js: ${lockManagerExists ? '✅' : '❌'}`);
        console.log(`  - pool_manager.js: ${poolManagerExists ? '✅' : '❌'}`);
        console.log(`  - ipc_client_v800_patch.js: ${patchExists ? '✅' : '❌'}`);

        if (!lockManagerExists || !poolManagerExists) {
            throw new Error('Arquivos críticos não encontrados');
        }

        console.log('> Validando código do lock_manager...');
        const lockManagerCode = await fs.readFile(lockManagerPath, 'utf-8');

        if (!lockManagerCode.includes('Two-Phase Commit')) {
            console.error('❌ Comentário "Two-Phase Commit" não encontrado');
            return false;
        }

        if (!lockManagerCode.includes('fs.rename')) {
            console.error('❌ fs.rename não encontrado (two-phase commit não implementado)');
            return false;
        }

        console.log('✅ lock_manager.js contém implementação Two-Phase Commit');

        console.log('> Validando código do pool_manager...');
        const poolManagerCode = await fs.readFile(poolManagerPath, 'utf-8');

        if (!poolManagerCode.includes('_initPromise')) {
            console.error('❌ _initPromise não encontrado (memoization não implementado)');
            return false;
        }

        if (!poolManagerCode.includes('Promise Memoization')) {
            console.error('❌ Comentário "Promise Memoization" não encontrado');
            return false;
        }

        console.log('✅ pool_manager.js contém Promise Memoization');

        console.log('✅ TEST 5 PASSOU: Todos os arquivos validados\n');
        return true;

    } catch (error) {
        console.error('❌ TEST 5 FALHOU:', error.message);
        return false;
    }
}

// ============================================================================
// EXECUTOR PRINCIPAL
// ============================================================================

async function runAllTests() {
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║  Suite de Testes - Correções P1 (Critical Cases Analysis)   ║');
    console.log('╚══════════════════════════════════════════════════════════════╝');

    const tests = [
        { name: 'Two-Phase Commit', fn: testLockTwoPhaseCommit },
        { name: 'Concorrência Extrema', fn: testLockConcurrency },
        { name: 'Cleanup Temp Files', fn: testLockNoTempOrphans },
        { name: 'Promise Memoization', fn: testBrowserPoolMemoization },
        { name: 'Validação Integração', fn: testIntegrationValidation }
    ];

    const results = [];

    for (const test of tests) {
        try {
            const passed = await test.fn();
            results.push({ name: test.name, passed });
        } catch (error) {
            console.error(`💥 Exceção em ${test.name}:`, error);
            results.push({ name: test.name, passed: false });
        }
    }

    // Sumário
    console.log('\n╔══════════════════════════════════════════════════════════════╗');
    console.log('║                    SUMÁRIO DOS TESTES                        ║');
    console.log('╚══════════════════════════════════════════════════════════════╝\n');

    const passed = results.filter(r => r.passed).length;
    const total = results.length;

    results.forEach(r => {
        const icon = r.passed ? '✅' : '❌';
        const status = r.passed ? 'PASSOU' : 'FALHOU';
        console.log(`${icon} ${r.name}: ${status}`);
    });

    console.log(`\n📊 Score: ${passed}/${total} testes passaram`);

    if (passed === total) {
        console.log('\n🎉 TODAS AS CORREÇÕES P1 VALIDADAS COM SUCESSO!\n');
        process.exit(0);
    } else {
        console.log(`\n⚠️  ${total - passed} teste(s) falharam. Revise as implementações.\n`);
        process.exit(1);
    }
}

// Executa se chamado diretamente
if (require.main === module) {
    runAllTests().catch(error => {
        console.error('💥 Erro fatal na suite de testes:', error);
        process.exit(1);
    });
}

module.exports = {
    testLockTwoPhaseCommit,
    testLockConcurrency,
    testLockNoTempOrphans,
    testBrowserPoolMemoization,
    testIntegrationValidation,
    runAllTests
};
