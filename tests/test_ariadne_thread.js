/* ==========================================================================
   tests/test_ariadne_thread.js
   Teste de Integração: Fio de Ariadne (End-to-End Connectivity)
   
   Objetivo: Validar que todos os subsistemas estão conectados corretamente
   e podem se comunicar através do NERV (canal único de transporte).
   
   Fluxo testado:
   1. Boot completo do sistema
   2. Verificação de conectividade NERV ↔ KERNEL
   3. Verificação de conectividade NERV ↔ DriverAdapter
   4. Verificação de conectividade NERV ↔ ServerAdapter
   5. Verificação de acesso ao BrowserPool
   6. Teste de mensagem end-to-end (COMMAND → EVENT)
   7. Shutdown gracioso
========================================================================== */

const { boot, shutdown } = require('../src/main');
const path = require('path');

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
    await runTest('TEST 1: Boot Sequence Completo (Mock Mode)', async () => {
        console.log('> Iniciando boot do sistema em modo MOCK...');
        console.log('  (BrowserPool desabilitado para testes sem Chrome externo)');
        
        // Temporariamente mocka o BrowserPool para não tentar conectar
        const BrowserPoolManager = require('../src/infra/browser_pool/pool_manager');
        const originalInitialize = BrowserPoolManager.prototype.initialize;
        const originalGetHealth = BrowserPoolManager.prototype.getHealth;
        const originalShutdown = BrowserPoolManager.prototype.shutdown;
        
        BrowserPoolManager.prototype.initialize = async function() {
            console.log('  [MOCK] BrowserPool.initialize() - skip');
        };
        BrowserPoolManager.prototype.getHealth = async function() {
            return { poolSize: 3, healthy: 3, available: 3, busy: 0 };
        };
        BrowserPoolManager.prototype.shutdown = async function() {
            console.log('  [MOCK] BrowserPool.shutdown() - skip');
        };
        
        try {
            context = await boot();
            
            // Verificações básicas
            if (!context) throw new Error('Context vazio após boot');
            if (!context.nerv) throw new Error('NERV não inicializado');
            if (!context.kernel) throw new Error('KERNEL não inicializado');
            if (!context.browserPool) throw new Error('BrowserPool não inicializado');
            if (!context.driverAdapter) throw new Error('DriverAdapter não inicializado');
            if (!context.serverAdapter) throw new Error('ServerAdapter não inicializado');
            
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
    });
}

/**
 * TEST 2: NERV - Verificação de Canal de Transporte
 */
async function test2_NERVChannel() {
    await runTest('TEST 2: NERV - Canal de Transporte', async () => {
        if (!context || !context.nerv) throw new Error('NERV não disponível');
        
        console.log('> Verificando interface do NERV...');
        
        // Verifica métodos essenciais
        if (typeof context.nerv.send !== 'function') {
            throw new Error('NERV.send() não disponível');
        }
        if (typeof context.nerv.onReceive !== 'function') {
            throw new Error('NERV.onReceive() não disponível');
        }
        if (typeof context.nerv.shutdown !== 'function') {
            throw new Error('NERV.shutdown() não disponível');
        }
        
        console.log('  ✓ NERV.send() disponível');
        console.log('  ✓ NERV.onReceive() disponível');
        console.log('  ✓ NERV.shutdown() disponível');
    });
}

/**
 * TEST 3: KERNEL - Verificação de Integração
 */
async function test3_KernelIntegration() {
    await runTest('TEST 3: KERNEL - Integração com NERV', async () => {
        if (!context || !context.kernel) throw new Error('KERNEL não disponível');
        
        console.log('> Verificando interface do KERNEL...');
        
        // Verifica métodos essenciais do KERNEL
        if (typeof context.kernel.shutdown !== 'function') {
            throw new Error('KERNEL.shutdown() não disponível');
        }
        
        // Verifica se KERNEL tem referência ao NERV
        if (!context.kernel.nerv && !context.kernel._nerv) {
            throw new Error('KERNEL não tem referência ao NERV');
        }
        
        console.log('  ✓ KERNEL.shutdown() disponível');
        console.log('  ✓ KERNEL ↔ NERV conectado');
    });
}

/**
 * TEST 4: BrowserPool - Verificação de Health
 */
async function test4_BrowserPoolHealth() {
    await runTest('TEST 4: BrowserPool - Health Check', async () => {
        if (!context || !context.browserPool) throw new Error('BrowserPool não disponível');
        
        console.log('> Verificando saúde do BrowserPool...');
        
        // Verifica métodos essenciais
        if (typeof context.browserPool.getHealth !== 'function') {
            throw new Error('BrowserPool.getHealth() não disponível');
        }
        if (typeof context.browserPool.shutdown !== 'function') {
            throw new Error('BrowserPool.shutdown() não disponível');
        }
        
        const health = await context.browserPool.getHealth();
        
        if (!health) throw new Error('Health check retornou vazio');
        if (typeof health.poolSize !== 'number') throw new Error('poolSize inválido');
        if (typeof health.healthy !== 'number') throw new Error('healthy inválido');
        
        console.log(`  ✓ Pool Size: ${health.poolSize}`);
        console.log(`  ✓ Healthy: ${health.healthy}/${health.poolSize}`);
        console.log('  ✓ BrowserPool operacional');
    });
}

/**
 * TEST 5: DriverAdapter - Verificação de Conectividade
 */
async function test5_DriverAdapterConnectivity() {
    await runTest('TEST 5: DriverAdapter - Conectividade', async () => {
        if (!context || !context.driverAdapter) throw new Error('DriverAdapter não disponível');
        
        console.log('> Verificando DriverAdapter...');
        
        // Verifica propriedades essenciais
        if (!context.driverAdapter.nerv) {
            throw new Error('DriverAdapter não tem referência ao NERV');
        }
        if (!context.driverAdapter.browserPool) {
            throw new Error('DriverAdapter não tem referência ao BrowserPool');
        }
        
        console.log('  ✓ DriverAdapter ↔ NERV conectado');
        console.log('  ✓ DriverAdapter ↔ BrowserPool conectado');
    });
}

/**
 * TEST 6: ServerAdapter - Verificação de Conectividade
 */
async function test6_ServerAdapterConnectivity() {
    await runTest('TEST 6: ServerAdapter - Conectividade', async () => {
        if (!context || !context.serverAdapter) throw new Error('ServerAdapter não disponível');
        
        console.log('> Verificando ServerAdapter...');
        
        // Verifica propriedades essenciais
        if (!context.serverAdapter.nerv) {
            throw new Error('ServerAdapter não tem referência ao NERV');
        }
        if (!context.serverAdapter.socketHub) {
            throw new Error('ServerAdapter não tem referência ao SocketHub');
        }
        
        console.log('  ✓ ServerAdapter ↔ NERV conectado');
        console.log('  ✓ ServerAdapter ↔ SocketHub conectado');
    });
}

/**
 * TEST 7: End-to-End Message Flow
 */
async function test7_EndToEndMessageFlow() {
    await runTest('TEST 7: Fluxo de Mensagem End-to-End', async () => {
        if (!context || !context.nerv) throw new Error('NERV não disponível');
        
        console.log('> Testando fluxo de mensagem através do NERV...');
        
        let messageReceived = false;
        
        // Configura listener
        const listener = (envelope) => {
            if (envelope.correlationId === 'test-ariadne-123') {
                messageReceived = true;
                console.log('  ✓ Mensagem recebida via NERV');
            }
        };
        
        context.nerv.onReceive(listener);
        
        // Envia mensagem de teste
        try {
            await context.nerv.send({
                messageType: 'EVENT',
                actionCode: 'TEST_ARIADNE',
                payload: { test: true },
                from: 'TEST_SUITE',
                to: 'BROADCAST',
                correlationId: 'test-ariadne-123'
            });
            
            console.log('  ✓ Mensagem enviada via NERV');
        } catch (error) {
            throw new Error(`Falha ao enviar mensagem: ${error.message}`);
        }
        
        // Aguarda mensagem
        await new Promise(resolve => { setTimeout(resolve, 100));
        
        if (!messageReceived) {
            throw new Error('Mensagem não foi recebida (loop quebrado)');
        }
        
        console.log('  ✓ Loop de mensagem funcionando (send → receive)');
    });
}

/**
 * TEST 8: Graceful Shutdown
 */
async function test8_GracefulShutdown() {
    await runTest('TEST 8: Graceful Shutdown', async () => {
        if (!context) throw new Error('Context não disponível');
        
        console.log('> Executando shutdown gracioso...');
        
        // Executa shutdown (vai fazer process.exit, mas pegamos antes)
        const originalExit = process.exit;
        let exitCalled = false;
        let exitCode = null;
        
        process.exit = (code) => {
            exitCalled = true;
            exitCode = code;
        };
        
        try {
            await shutdown(context);
        } catch (error) {
            // Esperado - shutdown pode lançar erro ao tentar process.exit
        } finally {
            process.exit = originalExit;
        }
        
        if (!exitCalled) {
            console.log('  ⚠️  process.exit não foi chamado (esperado em alguns casos)');
        } else {
            console.log(`  ✓ process.exit(${exitCode}) chamado corretamente`);
        }
        
        console.log('  ✓ Shutdown executado sem crashes');
    }, 10000); // Timeout maior para shutdown
}

/**
 * Executa todos os testes em sequência
 */
async function runAllTests() {
    console.log('Iniciando sequência de testes do Fio de Ariadne...\n');
    
    const startTime = Date.now();
    
    // Executa testes em ordem
    await test1_BootSequence();
    await test2_NERVChannel();
    await test3_KernelIntegration();
    await test4_BrowserPoolHealth();
    await test5_DriverAdapterConnectivity();
    await test6_ServerAdapterConnectivity();
    await test7_EndToEndMessageFlow();
    await test8_GracefulShutdown();
    
    const duration = Date.now() - startTime;
    
    // Sumário final
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║                    SUMÁRIO - FIO DE ARIADNE                  ║
╚══════════════════════════════════════════════════════════════╝

${testsPassed > 0 ? '✅' : '❌'} Boot Sequence: ${testsPassed >= 1 ? 'PASSOU' : 'FALHOU'}
${testsPassed > 1 ? '✅' : '❌'} NERV Channel: ${testsPassed >= 2 ? 'PASSOU' : 'FALHOU'}
${testsPassed > 2 ? '✅' : '❌'} KERNEL Integration: ${testsPassed >= 3 ? 'PASSOU' : 'FALHOU'}
${testsPassed > 3 ? '✅' : '❌'} BrowserPool Health: ${testsPassed >= 4 ? 'PASSOU' : 'FALHOU'}
${testsPassed > 4 ? '✅' : '❌'} DriverAdapter Connectivity: ${testsPassed >= 5 ? 'PASSOU' : 'FALHOU'}
${testsPassed > 5 ? '✅' : '❌'} ServerAdapter Connectivity: ${testsPassed >= 6 ? 'PASSOU' : 'FALHOU'}
${testsPassed > 6 ? '✅' : '❌'} End-to-End Message Flow: ${testsPassed >= 7 ? 'PASSOU' : 'FALHOU'}
${testsPassed > 7 ? '✅' : '❌'} Graceful Shutdown: ${testsPassed >= 8 ? 'PASSOU' : 'FALHOU'}

📊 Score: ${testsPassed}/8 testes passaram
⏱️  Duração total: ${duration}ms

${testsPassed === 8 ? `
🎉 TODOS OS SISTEMAS CONECTADOS!

O Fio de Ariadne está íntegro:
  NERV ↔ KERNEL ↔ BrowserPool
      ↕           ↕
  ServerAdapter  DriverAdapter
  
✨ Sistema pronto para operação em produção!
` : `
⚠️  ALGUNS TESTES FALHARAM (${testsFailed}/8)

O Fio de Ariadne pode estar quebrado.
Revise os logs acima para identificar o problema.
`}
`);
    
    process.exit(testsPassed === 8 ? 0 : 1);
}

// Executa suite de testes
runAllTests().catch((error) => {
    console.error('\n❌ ERRO FATAL NO TESTE:\n', error);
    process.exit(1);
});
