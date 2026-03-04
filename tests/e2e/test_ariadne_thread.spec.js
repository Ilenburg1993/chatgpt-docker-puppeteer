// @ts-check
// NOTE: This is an E2E test and requires external dependencies (Chrome proxy).
// It is not part of the default CI/unit/integration/regression test run.

import { boot, shutdown } from '#main';
import path from 'node:path';

console.log(`
╔══════════════════════════════════════════════════════════════╗
║        TESTE DO FIO DE ARIADNE (End-to-End)                  ║
║        Validação de Conectividade Completa                   ║
╚══════════════════════════════════════════════════════════════╝
`);

let testsPassed = 0;
let testsFailed = 0;
let context = null;

/**
 * Helper para executar testes com timeout
 * @param {string} name
 * @param {*} testFn
 * @param {*} [timeoutMs]
 */
async function runTest(name, testFn, timeoutMs = 5000) {
    process.stdout.write(`\n=== ${name} ===\n`);

    try {
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Timeout')), timeoutMs);
        });

        await Promise.race([testFn(), timeoutPromise]);

        console.log('✅ PASSOU\n');
        testsPassed++;
        return true;
    } catch (error) {
        console.log(`❌ FALHOU: ${error.message}\n`);
        testsFailed++;
        return false;
    }
}

/**
 * TEST 1: Boot Sequence Completo
 */
async function test1_BootSequence() {
    await runTest(
        'TEST 1: Boot Sequence Completo (Mock Mode)',
        async () => {
            console.log('> Iniciando boot do sistema em modo MOCK...');
            console.log('  (BrowserPool desabilitado para testes sem Chrome externo)');

            // Temporariamente mocka o BrowserPool para não tentar conectar
            const BrowserPoolManager = await import('#infra/browser_pool/pool_manager').then(m => m.default ?? m);
            const originalInitialize = BrowserPoolManager.prototype.initialize;
            const originalGetHealth = BrowserPoolManager.prototype.getHealth;
            const originalShutdown = BrowserPoolManager.prototype.shutdown;

            BrowserPoolManager.prototype.initialize = async function () {
                console.log('  [MOCK] BrowserPool.initialize() - skip');
            };
            BrowserPoolManager.prototype.getHealth = async function () {
                return { poolSize: 3, healthy: 3, available: 3, busy: 0 };
            };
            BrowserPoolManager.prototype.shutdown = async function () {
                console.log('  [MOCK] BrowserPool.shutdown() - skip');
            };

            try {
                context = await boot();

                // Verificações básicas
                if (!context) {
                    throw new Error('Context vazio após boot');
                }
                if (!context.nerv) {
                    throw new Error('NERV não inicializado');
                }
                if (!context.kernel) {
                    throw new Error('KERNEL não inicializado');
                }
                if (!context.browserPool) {
                    throw new Error('BrowserPool não inicializado');
                }
                if (!context.driverAdapter) {
                    throw new Error('DriverAdapter não inicializado');
                }
                if (!context.serverAdapter) {
                    throw new Error('ServerAdapter não inicializado');
                }

                console.log('  ✓ NERV online');
                console.log('  ✓ KERNEL online');
                console.log('  ✓ BrowserPool online (mock)');
                console.log('  ✓ DriverAdapter online');
                console.log('  ✓ ServerAdapter online');
                console.log(`  ✓ Boot duration: ${context.bootDuration}ms`);
            } finally {
                // Restaura métodos originais
                BrowserPoolManager.prototype.initialize = originalInitialize;
                BrowserPoolManager.prototype.getHealth = originalGetHealth;
                BrowserPoolManager.prototype.shutdown = originalShutdown;
            }
        },
        20000
    );
}

/**
 * TEST 2: NERV - Verificação de Canal de Transporte
 */
async function test2_NERVChannel() {
    await runTest('TEST 2: NERV - Canal de Transporte', async () => {
        if (!context || !context.nerv) {
            throw new Error('NERV não disponível');
        }

        console.log('> Verificando interface do NERV...');

        // Verifica métodos essenciais
        if (typeof context.nerv.send !== 'function') {
            throw new Error('NERV.send() não disponível');
        }
        if (typeof context.nerv.getStatus !== 'function') {
            throw new Error('NERV.getStatus() não disponível');
        }

        const status = context.nerv.getStatus();
        console.log('  Status:', status);

        if (!status || status.mode !== 'local') {
            throw new Error(`Modo de transporte incorreto: ${status?.mode}`);
        }

        console.log('  ✓ NERV em modo local');
        console.log('  ✓ Canal ativo');
    });
}

/**
 * TEST 3: Shutdown Sequence
 */
async function test3_Shutdown() {
    await runTest(
        'TEST 3: Shutdown Gracioso',
        async () => {
            if (!context) {
                throw new Error('Context não disponível');
            }

            console.log('> Iniciando shutdown...');
            await shutdown(context);
            console.log('  ✓ Shutdown completado');
        },
        15000
    );
}

/**
 * MAIN
 */
(async () => {
    // Ensure artifacts folder
    const artifacts = path.join(process.cwd(), 'tmp', 'e2e');
    await import('node:fs/promises').then(fs => fs.mkdir(artifacts, { recursive: true }));

    await test1_BootSequence();
    await test2_NERVChannel();
    await test3_Shutdown();

    console.log('\n══════════════════════════════════════════════════════════════');
    console.log(`✅ Passou: ${testsPassed}`);
    console.log(`❌ Falhou: ${testsFailed}`);
    console.log('══════════════════════════════════════════════════════════════\n');

    process.exit(testsFailed > 0 ? 1 : 0);
})();
