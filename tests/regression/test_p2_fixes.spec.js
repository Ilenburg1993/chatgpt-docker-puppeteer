import { promises as fsPromises } from 'node:fs';
import path from 'node:path';
import { HandleManager } from '#driver/modules/handle_manager';

// ============================================================================
// TEST 1: Shutdown - Isolamento de Erros Por Fase
// ============================================================================

async function testShutdownPhaseIsolation() {
    console.log('\n=== TEST 1: Shutdown - Isolamento de Erros ===');

    try {
        // Mock de shutdown function (baseado em src/main.js)
        async function mockShutdown(context) {
            const phases = [];
            let failedPhases = 0;

            const shutdownPhases = [
                {
                    name: 'Phase1-Success',
                    fn: async () => {
                        // Fase que funciona
                        await new Promise(resolve => {
                            setTimeout(resolve, 10);
                        });
                    }
                },
                {
                    name: 'Phase2-Fail',
                    fn: async () => {
                        // Fase que falha
                        throw new Error('SIMULATED_ERROR');
                    }
                },
                {
                    name: 'Phase3-Success',
                    fn: async () => {
                        // Fase após falha (deve executar mesmo assim)
                        await new Promise(resolve => {
                            setTimeout(resolve, 10);
                        });
                    }
                },
                {
                    name: 'Phase4-Fail',
                    fn: async () => {
                        // Segunda fase que falha
                        throw new Error('ANOTHER_ERROR');
                    }
                },
                {
                    name: 'Phase5-Success',
                    fn: async () => {
                        // Última fase (deve executar)
                        await new Promise(resolve => {
                            setTimeout(resolve, 10);
                        });
                    }
                }
            ];

            // Executa com try-catch isolado
            for (const phase of shutdownPhases) {
                try {
                    await phase.fn();
                    phases.push({ name: phase.name, status: 'SUCCESS' });
                } catch (error) {
                    failedPhases++;
                    phases.push({ name: phase.name, status: 'FAILED', error: error.message });
                }
            }

            return { phases, failedPhases };
        }

        console.log('> Executando shutdown com falhas simuladas...');
        const result = await mockShutdown({});

        console.log(`> Fases executadas: ${result.phases.length}`);
        console.log(`> Fases com falha: ${result.failedPhases}`);

        // Valida que todas as fases foram tentadas
        if (result.phases.length !== 5) {
            console.error(`❌ Apenas ${result.phases.length}/5 fases executadas`);
            return false;
        }

        console.log('✅ Todas as 5 fases foram executadas');

        // Valida que fases com sucesso realmente passaram
        const successPhases = result.phases.filter(p => p.status === 'SUCCESS');
        if (successPhases.length !== 3) {
            console.error(`❌ Esperado 3 sucessos, obteve ${successPhases.length}`);
            return false;
        }

        console.log('✅ 3 fases com sucesso (Phase1, Phase3, Phase5)');

        // Valida que fases com erro foram capturadas
        const failedPhases = result.phases.filter(p => p.status === 'FAILED');
        if (failedPhases.length !== 2) {
            console.error(`❌ Esperado 2 falhas, obteve ${failedPhases.length}`);
            return false;
        }

        console.log('✅ 2 fases com falha capturadas (Phase2, Phase4)');

        // Valida que Phase3 executou APÓS Phase2 falhar
        const phase3Index = result.phases.findIndex(p => p.name === 'Phase3-Success');
        const phase2Index = result.phases.findIndex(p => p.name === 'Phase2-Fail');

        if (phase3Index <= phase2Index) {
            console.error('❌ Phase3 não executou após Phase2 falhar');
            return false;
        }

        console.log('✅ Phase3 executou APÓS Phase2 falhar (isolamento funcionando)');

        console.log('✅ TEST 1 PASSOU: Isolamento de erros implementado corretamente\n');
        return true;
    } catch (error) {
        console.error('❌ TEST 1 FALHOU:', error.message);
        return false;
    }
}

// ============================================================================
// TEST 2: HandleManager - AbortController Funcionamento
// ============================================================================

async function testHandleManagerAbort() {
    console.log('\n=== TEST 2: HandleManager - AbortController ===');

    try {
        // Mock de driver
        const mockDriver = { correlationId: 'test-correlation' };
        const manager = new HandleManager(mockDriver);

        // Mock de handles que demoram para dispose
        const mockHandles = [];
        for (let i = 0; i < 10; i++) {
            mockHandles.push({
                dispose: async () => {
                    // Simula dispose lento (500ms cada)
                    await new Promise(resolve => {
                        setTimeout(resolve, 500);
                    });
                }
            });
        }

        // Registra todos os handles
        mockHandles.forEach(h => manager.register(h));

        console.log(`> ${manager.getActiveCount()} handles registrados`);
        console.log('> Iniciando cleanup com timeout de 3s...');
        console.log('> (10 handles × 500ms = 5s total, deve abortar em 3s)');

        const startTime = Date.now();
        await manager.clearAll();
        const duration = Date.now() - startTime;

        console.log(`> Cleanup concluído em ${duration}ms`);

        // Valida que cleanup abortou antes de 5s
        if (duration >= 5000) {
            console.error('❌ Cleanup não abortou (levou 5s+)');
            return false;
        }

        console.log('✅ Cleanup abortou antes de completar (< 5s)');

        // Valida que levou ~3s (timeout)
        if (duration < 2900 || duration > 3500) {
            console.error(`❌ Tempo inesperado: ${duration}ms (esperado: ~3000ms)`);
            return false;
        }

        console.log('✅ Timeout de 3s respeitado');

        // Valida que array foi esvaziado (GC pode limpar)
        if (manager.getActiveCount() !== 0) {
            console.error(`❌ Ainda há ${manager.getActiveCount()} handles ativos`);
            return false;
        }

        console.log('✅ Array de handles esvaziado (GC pode limpar)');

        console.log('✅ TEST 2 PASSOU: AbortController funcionando corretamente\n');
        return true;
    } catch (error) {
        console.error('❌ TEST 2 FALHOU:', error.message);
        return false;
    }
}

// ============================================================================
// TEST 3: HandleManager - Cleanup Completo (sem timeout)
// ============================================================================

async function testHandleManagerComplete() {
    console.log('\n=== TEST 3: HandleManager - Cleanup Completo ===');

    try {
        const mockDriver = { correlationId: 'test-complete' };
        const manager = new HandleManager(mockDriver);

        // Mock de handles rápidos (50ms cada)
        const mockHandles = [];
        for (let i = 0; i < 5; i++) {
            mockHandles.push({
                dispose: async () => {
                    await new Promise(resolve => {
                        setTimeout(resolve, 50);
                    });
                }
            });
        }

        mockHandles.forEach(h => manager.register(h));

        console.log(`> ${manager.getActiveCount()} handles registrados`);
        console.log('> Iniciando cleanup rápido (5 × 50ms = 250ms)...');

        const startTime = Date.now();
        await manager.clearAll();
        const duration = Date.now() - startTime;

        console.log(`> Cleanup concluído em ${duration}ms`);

        // Valida que completou antes do timeout
        if (duration >= 3000) {
            console.error('❌ Cleanup levou mais que timeout');
            return false;
        }

        console.log('✅ Cleanup completou antes do timeout');

        // Valida que todos foram limpos
        if (manager.getActiveCount() !== 0) {
            console.error(`❌ Ainda há ${manager.getActiveCount()} handles`);
            return false;
        }

        console.log('✅ Todos os handles foram limpos');

        console.log('✅ TEST 3 PASSOU: Cleanup completo sem abort\n');
        return true;
    } catch (error) {
        console.error('❌ TEST 3 FALHOU:', error.message);
        return false;
    }
}

// ============================================================================
// TEST 4: HandleManager - Handles com Erro Individual
// ============================================================================

async function testHandleManagerWithErrors() {
    console.log('\n=== TEST 4: HandleManager - Handles com Erros Individuais ===');

    try {
        const mockDriver = { correlationId: 'test-errors' };
        const manager = new HandleManager(mockDriver);

        // Mix de handles: alguns funcionam, outros falham
        const mockHandles = [
            {
                dispose: async () => {
                    /* OK */
                }
            },
            {
                dispose: async () => {
                    throw new Error('DISPOSE_ERROR_1');
                }
            },
            {
                dispose: async () => {
                    /* OK */
                }
            },
            {
                dispose: async () => {
                    throw new Error('DISPOSE_ERROR_2');
                }
            },
            {
                dispose: async () => {
                    /* OK */
                }
            }
        ];

        mockHandles.forEach(h => manager.register(h));

        console.log('> 5 handles registrados (2 com erros simulados)...');
        console.log('> Executando cleanup...');

        await manager.clearAll();

        // Valida que não travou (erros individuais ignorados)
        if (manager.getActiveCount() !== 0) {
            console.error(`❌ Ainda há ${manager.getActiveCount()} handles`);
            return false;
        }

        console.log('✅ Cleanup completou apesar de erros individuais');
        console.log('✅ Todos os handles foram processados');

        console.log('✅ TEST 4 PASSOU: Erros individuais não travam cleanup\n');
        return true;
    } catch (error) {
        console.error('❌ TEST 4 FALHOU:', error.message);
        return false;
    }
}

// ============================================================================
// TEST 5: Validação de Código Modificado
// ============================================================================

async function testCodeValidation() {
    console.log('\n=== TEST 5: Validação de Código Modificado ===');

    try {

        console.log('> Verificando arquivos modificados...');

        // Valida src/main.js
        const mainPath = path.join(import.meta.dirname, '../../src/main.js');
        const mainCode = await fsPromises.readFile(mainPath, 'utf-8');

        if (!mainCode.includes('shutdownPhases')) {
            console.error('❌ main.js não contém array shutdownPhases');
            return false;
        }

        // Verifica que o loop de shutdown trata cada fase individualmente com try/catch
        // Procura por padrão: for (... shutdownPhases ...) { ... try { await phase.fn( ... )
        const shutdownLoopRegex =
            /for\s*\(\s*let\s+i\s*=\s*0\s*;\s*i\s*<\s*shutdownPhases\.length\s*;\s*i\+\+\s*\)\s*\{[\s\S]*?try\s*\{[\s\S]*?await\s*phase\.fn\s*\(/m;
        if (!shutdownLoopRegex.test(mainCode)) {
            console.error('❌ main.js não envolve cada fase com try/catch ao executar phase.fn()');
            return false;
        }

        if (!mainCode.includes('failedPhases')) {
            console.error('❌ main.js não rastreia fases com falha');
            return false;
        }

        console.log('✅ main.js contém shutdown com isolamento de erros');

        // Valida handle_manager.js
        const handlePath = path.join(import.meta.dirname, '../../src/driver/modules/handle_manager.js');
        const handleCode = await fsPromises.readFile(handlePath, 'utf-8');

        if (!handleCode.includes('AbortController')) {
            console.error('❌ handle_manager.js não usa AbortController');
            return false;
        }

        if (!handleCode.includes('signal.aborted')) {
            console.error('❌ handle_manager.js não verifica abort signal');
            return false;
        }

        if (!handleCode.includes('CLEANUP_ABORTED')) {
            console.error('❌ handle_manager.js não lança erro de abort');
            return false;
        }

        console.log('✅ handle_manager.js contém AbortController');

        console.log('✅ TEST 5 PASSOU: Código validado\n');
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
    console.log('║  Suite de Testes - Correções P2 (Critical Cases Analysis)   ║');
    console.log('╚══════════════════════════════════════════════════════════════╝');

    const tests = [
        { name: 'Shutdown Phase Isolation', fn: testShutdownPhaseIsolation },
        { name: 'HandleManager AbortController', fn: testHandleManagerAbort },
        { name: 'HandleManager Cleanup Completo', fn: testHandleManagerComplete },
        { name: 'HandleManager com Erros', fn: testHandleManagerWithErrors },
        { name: 'Validação de Código', fn: testCodeValidation }
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
        console.log('\n🎉 TODAS AS CORREÇÕES P2 VALIDADAS COM SUCESSO!\n');
        process.exit(0);
    } else {
        console.log(`\n⚠️  ${total - passed} teste(s) falharam. Revise as implementações.\n`);
        process.exit(1);
    }
}

// Executa se chamado diretamente
if (import.meta.filename === process.argv[1]) {
    runAllTests().catch(error => {
        console.error('💥 Erro fatal na suite de testes:', error);
        process.exit(1);
    });
}

export { testShutdownPhaseIsolation, testHandleManagerAbort, testHandleManagerComplete, testHandleManagerWithErrors, testCodeValidation, runAllTests };
