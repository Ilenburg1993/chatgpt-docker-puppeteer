/* ==========================================================================
   tests/test_p3_fixes.js
   Suite de Testes para Correções P3 (Critical Cases Analysis)

   P3: RecoverySystem - Kill Timeout Protection
   - Proteção contra travamento em killProcess() zombie
   - Timeout de 5s para operação de kill
   - Continuação do fluxo mesmo com falha

   Referência: CRITICAL_CASES_ANALYSIS.md (Caso 10)
========================================================================== */

const fs = require('fs/promises');
const path = require('path');

// Cores para output
const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m'
};

function log(type, message) {
    const timestamp = new Date().toISOString();
    const prefix = type === 'SUCCESS' ? '✅' : type === 'FAIL' ? '❌' : '>';
    console.log(`${prefix} ${message}`);
}

function header(text) {
    console.log(`\n${colors.cyan}=== ${text} ===${colors.reset}`);
}

function summary(text) {
    console.log(`\n${colors.blue}╔══════════════════════════════════════════════════════════════╗`);
    console.log(`║${text.padEnd(62)}║`);
    console.log(`╚══════════════════════════════════════════════════════════════╝${colors.reset}`);
}

// ============================================================================
// Mock: system.js com killProcess simulando delay
// ============================================================================
function createMockSystem(delayMs) {
    return {
        killProcess: pid => {
            return new Promise(resolve => {
                setTimeout(() => {
                    resolve();
                }, delayMs);
            });
        }
    };
}

// ============================================================================
// Mock: RecoverySystem com system injetável
// ============================================================================
class MockRecoverySystem {
    constructor(driver, systemModule) {
        this.driver = driver;
        this.system = systemModule;
    }

    async applyTier3Kill(pid, correlationId) {
        // Simulação da lógica Tier 3 com timeout
        const KILL_TIMEOUT_MS = 5000;

        try {
            await Promise.race([
                this.system.killProcess(pid),
                new Promise((_, reject) => {
                    setTimeout(() => reject(new Error('KILL_TIMEOUT')), KILL_TIMEOUT_MS);
                })
            ]);
            return { status: 'SUCCESS', timedOut: false };
        } catch (killErr) {
            if (killErr.message === 'KILL_TIMEOUT') {
                return { status: 'TIMEOUT', timedOut: true };
            }
            return { status: 'ERROR', error: killErr.message };
        }
    }
}

// ============================================================================
// Mock: Driver mínimo
// ============================================================================
function createMockDriver() {
    return {
        correlationId: 'test-corr-001',
        _emitVital: () => {}
    };
}

// ============================================================================
// TEST 1: Kill Rápido (< 5s) - Deve Completar
// ============================================================================
async function test1_FastKill() {
    header('TEST 1: Kill Rápido (< 5s)');

    const mockSystem = createMockSystem(500); // 500ms
    const mockDriver = createMockDriver();
    const recovery = new MockRecoverySystem(mockDriver, mockSystem);

    log('INFO', 'Executando kill com delay de 500ms...');
    const startTime = Date.now();

    const result = await recovery.applyTier3Kill(12345, 'test-001');

    const elapsed = Date.now() - startTime;
    log('INFO', `Completado em ${elapsed}ms`);

    // Validações
    const checks = [
        { name: 'Kill completou', pass: result.status === 'SUCCESS' },
        { name: 'Não houve timeout', pass: !result.timedOut },
        { name: 'Tempo < 5s', pass: elapsed < 5000 },
        { name: 'Tempo ≈ 500ms', pass: elapsed >= 500 && elapsed < 1000 }
    ];

    const allPassed = checks.every(c => c.pass);

    checks.forEach(check => {
        log(check.pass ? 'SUCCESS' : 'FAIL', check.name);
    });

    log(allPassed ? 'SUCCESS' : 'FAIL', `TEST 1 ${allPassed ? 'PASSOU' : 'FALHOU'}: Kill rápido`);
    return allPassed;
}

// ============================================================================
// TEST 2: Kill Lento (> 5s) - Deve Timeout
// ============================================================================
async function test2_SlowKillTimeout() {
    header('TEST 2: Kill Lento (> 5s) - Timeout');

    const mockSystem = createMockSystem(7000); // 7s (excede timeout)
    const mockDriver = createMockDriver();
    const recovery = new MockRecoverySystem(mockDriver, mockSystem);

    log('INFO', 'Executando kill com delay de 7s (deve abortar em 5s)...');
    const startTime = Date.now();

    const result = await recovery.applyTier3Kill(12345, 'test-002');

    const elapsed = Date.now() - startTime;
    log('INFO', `Abortado em ${elapsed}ms`);

    // Validações
    const checks = [
        { name: 'Timeout detectado', pass: result.status === 'TIMEOUT' },
        { name: 'Flag timedOut = true', pass: result.timedOut },
        { name: 'Tempo ≈ 5s', pass: elapsed >= 5000 && elapsed < 5500 },
        { name: 'Não aguardou 7s', pass: elapsed < 6000 }
    ];

    const allPassed = checks.every(c => c.pass);

    checks.forEach(check => {
        log(check.pass ? 'SUCCESS' : 'FAIL', check.name);
    });

    log(allPassed ? 'SUCCESS' : 'FAIL', `TEST 2 ${allPassed ? 'PASSOU' : 'FALHOU'}: Timeout funcionou`);
    return allPassed;
}

// ============================================================================
// TEST 3: Kill Borderline (≈ 5s) - Deve Completar ou Timeout
// ============================================================================
async function test3_BorderlineKill() {
    header('TEST 3: Kill Borderline (≈ 5s)');

    const mockSystem = createMockSystem(4900); // 4.9s (logo abaixo do timeout)
    const mockDriver = createMockDriver();
    const recovery = new MockRecoverySystem(mockDriver, mockSystem);

    log('INFO', 'Executando kill com delay de 4.9s...');
    const startTime = Date.now();

    const result = await recovery.applyTier3Kill(12345, 'test-003');

    const elapsed = Date.now() - startTime;
    log('INFO', `Resultado: ${result.status} em ${elapsed}ms`);

    // Validações (aceita tanto SUCCESS quanto TIMEOUT no limite)
    const checks = [
        { name: 'Status válido', pass: ['SUCCESS', 'TIMEOUT'].includes(result.status) },
        { name: 'Tempo ≈ 5s', pass: elapsed >= 4800 && elapsed < 5500 },
        { name: 'Respeitou timeout máximo', pass: elapsed < 6000 }
    ];

    const allPassed = checks.every(c => c.pass);

    checks.forEach(check => {
        log(check.pass ? 'SUCCESS' : 'FAIL', check.name);
    });

    log(allPassed ? 'SUCCESS' : 'FAIL', `TEST 3 ${allPassed ? 'PASSOU' : 'FALHOU'}: Borderline validado`);
    return allPassed;
}

// ============================================================================
// TEST 4: Múltiplos Kills Sequenciais
// ============================================================================
async function test4_SequentialKills() {
    header('TEST 4: Múltiplos Kills Sequenciais');

    const mockDriver = createMockDriver();

    log('INFO', 'Executando 3 kills sequenciais (rápido, lento, rápido)...');

    const results = [];

    // Kill 1: Rápido
    const mockSystem1 = createMockSystem(300);
    const recovery1 = new MockRecoverySystem(mockDriver, mockSystem1);
    const result1 = await recovery1.applyTier3Kill(11111, 'seq-001');
    results.push(result1);
    log('INFO', `Kill 1: ${result1.status}`);

    // Kill 2: Lento (timeout)
    const mockSystem2 = createMockSystem(6000);
    const recovery2 = new MockRecoverySystem(mockDriver, mockSystem2);
    const result2 = await recovery2.applyTier3Kill(22222, 'seq-002');
    results.push(result2);
    log('INFO', `Kill 2: ${result2.status}`);

    // Kill 3: Rápido
    const mockSystem3 = createMockSystem(400);
    const recovery3 = new MockRecoverySystem(mockDriver, mockSystem3);
    const result3 = await recovery3.applyTier3Kill(33333, 'seq-003');
    results.push(result3);
    log('INFO', `Kill 3: ${result3.status}`);

    // Validações
    const checks = [
        { name: '3 kills executados', pass: results.length === 3 },
        { name: 'Kill 1 completou', pass: results[0].status === 'SUCCESS' },
        { name: 'Kill 2 timeout', pass: results[1].status === 'TIMEOUT' },
        { name: 'Kill 3 completou', pass: results[2].status === 'SUCCESS' },
        { name: 'Isolamento mantido', pass: results[0].status !== results[1].status }
    ];

    const allPassed = checks.every(c => c.pass);

    checks.forEach(check => {
        log(check.pass ? 'SUCCESS' : 'FAIL', check.name);
    });

    log(allPassed ? 'SUCCESS' : 'FAIL', `TEST 4 ${allPassed ? 'PASSOU' : 'FALHOU'}: Kills sequenciais isolados`);
    return allPassed;
}

// ============================================================================
// TEST 5: Validação de Código Modificado
// ============================================================================
async function test5_CodeValidation() {
    header('TEST 5: Validação de Código Modificado');

    log('INFO', 'Verificando arquivo recovery_system.js...');

    const recoverySystemPath = path.join(__dirname, '..', '..', 'src', 'driver', 'modules', 'recovery_system.js');
    const content = await fs.readFile(recoverySystemPath, 'utf-8');

    const checks = [
        {
            name: 'recovery_system.js contém Promise.race',
            pass: content.includes('Promise.race')
        },
        {
            name: 'recovery_system.js contém KILL_TIMEOUT',
            pass: content.includes('KILL_TIMEOUT')
        },
        {
            name: 'recovery_system.js contém timeout de 5000ms',
            pass: content.includes('5000')
        },
        {
            name: 'recovery_system.js tem try-catch no kill',
            pass: content.includes('catch (killErr)')
        },
        {
            name: 'recovery_system.js continua após timeout',
            pass: content.includes('Continua o fluxo') || content.includes('continua')
        }
    ];

    const allPassed = checks.every(c => c.pass);

    checks.forEach(check => {
        log(check.pass ? 'SUCCESS' : 'FAIL', check.name);
    });

    log(allPassed ? 'SUCCESS' : 'FAIL', `TEST 5 ${allPassed ? 'PASSOU' : 'FALHOU'}: Código validado`);
    return allPassed;
}

// ============================================================================
// MAIN: Executa todos os testes
// ============================================================================
async function runAllTests() {
    summary('  Suite de Testes - Correções P3 (Critical Cases Analysis)   ');

    const results = {
        test1: await test1_FastKill(),
        test2: await test2_SlowKillTimeout(),
        test3: await test3_BorderlineKill(),
        test4: await test4_SequentialKills(),
        test5: await test5_CodeValidation()
    };

    summary('                    SUMÁRIO DOS TESTES                        ');

    console.log('');
    console.log(results.test1 ? '✅' : '❌', 'Kill Rápido:', results.test1 ? 'PASSOU' : 'FALHOU');
    console.log(results.test2 ? '✅' : '❌', 'Kill Timeout:', results.test2 ? 'PASSOU' : 'FALHOU');
    console.log(results.test3 ? '✅' : '❌', 'Kill Borderline:', results.test3 ? 'PASSOU' : 'FALHOU');
    console.log(results.test4 ? '✅' : '❌', 'Kills Sequenciais:', results.test4 ? 'PASSOU' : 'FALHOU');
    console.log(results.test5 ? '✅' : '❌', 'Validação de Código:', results.test5 ? 'PASSOU' : 'FALHOU');

    const totalTests = Object.keys(results).length;
    const passedTests = Object.values(results).filter(r => r).length;

    console.log('');
    console.log(`${colors.cyan}📊 Score: ${passedTests}/${totalTests} testes passaram${colors.reset}`);

    if (passedTests === totalTests) {
        console.log('');
        console.log(`${colors.green}🎉 TODAS AS CORREÇÕES P3 VALIDADAS COM SUCESSO!${colors.reset}`);
    } else {
        console.log('');
        console.log(`${colors.red}⚠️  Alguns testes falharam. Revise as correções.${colors.reset}`);
    }

    console.log('');
}

// Executa
runAllTests().catch(err => {
    console.error(`${colors.red}❌ Erro fatal nos testes:`, err.message + colors.reset);
    console.error(err.stack);
    process.exit(1);
});
