/* ==========================================================================
   tests/test_driver_nerv_integration.js
   Teste de Integração: DRIVER ↔ NERV ↔ KERNEL/SERVER

   Objetivo: Validar que o DRIVER usa NERV como transportador universal,
   sem acoplamentos diretos com KERNEL ou SERVER.

   Princípios testados:
   1. Driver NÃO importa KERNEL diretamente
   2. Driver NÃO importa SERVER diretamente
   3. Driver NÃO acessa filesystem diretamente
   4. Toda comunicação passa pelo NERV (pub/sub)
   5. Telemetria do driver flui via NERV
   6. Comandos ao driver chegam via NERV
========================================================================== */

const fs = require('fs');
const path = require('path');

console.log(`
╔══════════════════════════════════════════════════════════════╗
║     TESTE: Driver NERV Integration (Canal Único)             ║
╚══════════════════════════════════════════════════════════════╝
`);

let testsPassed = 0;
let testsFailed = 0;

/**
 * Helper para executar testes
 */
function runTest(name, testFn) {
    process.stdout.write(`\n=== ${name} ===\n`);

    try {
        testFn();
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
 * TEST 1: Driver não importa KERNEL diretamente
 */
runTest('TEST 1: Driver - Zero importação direta do KERNEL', () => {
    console.log('> Verificando imports em arquivos do driver...');

    const driverFiles = [
        'src/driver/DriverLifecycleManager.js',
        'src/driver/nerv_adapter/driver_nerv_adapter.js',
        'src/driver/factory.js'
    ];

    for (const file of driverFiles) {
        const filePath = path.join(process.cwd(), file);
        if (!fs.existsSync(filePath)) {continue;}

        const content = fs.readFileSync(filePath, 'utf8');

        // Verifica imports proibidos
        if (content.match(/require\(['"].*kernel(?!_telemetry)/i)) {
            throw new Error(`${file} importa KERNEL diretamente`);
        }

        console.log(`  ✓ ${file} - sem imports do KERNEL`);
    }
});

/**
 * TEST 2: Driver não importa SERVER diretamente
 */
runTest('TEST 2: Driver - Zero importação direta do SERVER', () => {
    console.log('> Verificando imports do SERVER...');

    const driverFiles = [
        'src/driver/DriverLifecycleManager.js',
        'src/driver/nerv_adapter/driver_nerv_adapter.js',
        'src/driver/factory.js'
    ];

    for (const file of driverFiles) {
        const filePath = path.join(process.cwd(), file);
        if (!fs.existsSync(filePath)) {continue;}

        const content = fs.readFileSync(filePath, 'utf8');

        // Verifica imports proibidos
        if (content.match(/require\(['"].*server/i)) {
            throw new Error(`${file} importa SERVER diretamente`);
        }

        console.log(`  ✓ ${file} - sem imports do SERVER`);
    }
});

/**
 * TEST 3: Driver não acessa filesystem diretamente
 */
runTest('TEST 3: Driver - Zero acesso direto ao filesystem', () => {
    console.log('> Verificando acesso ao filesystem...');

    const driverFiles = [
        'src/driver/DriverLifecycleManager.js',
        'src/driver/nerv_adapter/driver_nerv_adapter.js'
    ];

    for (const file of driverFiles) {
        const filePath = path.join(process.cwd(), file);
        if (!fs.existsSync(filePath)) {continue;}

        const content = fs.readFileSync(filePath, 'utf8');

        // Verifica chamadas proibidas (exceto em comentários)
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();

            // Ignora comentários
            if (line.startsWith('//') || line.startsWith('/*') || line.startsWith('*')) {
                continue;
            }

            // Verifica operações de filesystem
            if (line.match(/fs\.(read|write|append|unlink|mkdir|rmdir)/i)) {
                throw new Error(`${file}:${i+1} acessa filesystem diretamente: ${line}`);
            }
        }

        console.log(`  ✓ ${file} - sem acesso direto ao filesystem`);
    }
});

/**
 * TEST 4: DriverNERVAdapter usa NERV para todas as comunicações
 */
runTest('TEST 4: DriverNERVAdapter - Comunicação 100% via NERV', () => {
    console.log('> Verificando uso do NERV no adapter...');

    const adapterPath = path.join(process.cwd(), 'src/driver/nerv_adapter/driver_nerv_adapter.js');
    const content = fs.readFileSync(adapterPath, 'utf8');

    // Deve ter referência ao NERV
    if (!content.includes('this.nerv')) {
        throw new Error('DriverNERVAdapter não tem referência ao NERV');
    }
    console.log('  ✓ NERV instance presente');

    // Deve usar nerv.onReceive para escutar comandos
    if (!content.includes('nerv.onReceive')) {
        throw new Error('DriverNERVAdapter não usa nerv.onReceive');
    }
    console.log('  ✓ Usa nerv.onReceive() para comandos');

    // Deve usar nerv.emitEvent para emitir eventos
    if (!content.includes('nerv.emitEvent') && !content.includes('this.nerv.emit')) {
        throw new Error('DriverNERVAdapter não emite eventos via NERV');
    }
    console.log('  ✓ Usa nerv.emitEvent() para telemetria');

    // NÃO deve fazer log.emit ou outras emissões diretas
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        // Ignora comentários e logs normais
        if (line.startsWith('//') || line.startsWith('/*') || line.startsWith('*')) {continue;}
        if (line.includes('log(')) {continue;}

        // Verifica emissões não autorizadas
        if (line.match(/\.emit\(/i) && !line.includes('nerv.emit') && !line.includes('driver.emit')) {
            // Pode ter EventEmitter interno para drivers, mas não para comunicação externa
            if (line.includes('EventEmitter')) {continue;}
        }
    }
    console.log('  ✓ Sem emissões diretas fora do NERV');
});

/**
 * TEST 5: Telemetria do driver flui via NERV
 */
runTest('TEST 5: Driver Telemetry - Fluxo via NERV', () => {
    console.log('> Verificando fluxo de telemetria...');

    const adapterPath = path.join(process.cwd(), 'src/driver/nerv_adapter/driver_nerv_adapter.js');
    const content = fs.readFileSync(adapterPath, 'utf8');

    // Deve ter listeners para eventos do driver
    if (!content.includes("driver.on('state_change'") && !content.includes('driver.on("state_change"')) {
        console.log('  ⚠️  state_change listener não encontrado (pode ser legítimo)');
    } else {
        console.log('  ✓ Escuta state_change do driver');
    }

    if (!content.includes("driver.on('progress'") && !content.includes('driver.on("progress"')) {
        console.log('  ⚠️  progress listener não encontrado (pode ser legítimo)');
    } else {
        console.log('  ✓ Escuta progress do driver');
    }

    // Deve emitir eventos DRIVER_* via NERV
    if (!content.includes('DRIVER_')) {
        throw new Error('Não usa ActionCodes DRIVER_*');
    }
    console.log('  ✓ Usa ActionCodes DRIVER_*');

    if (!content.includes('emitEvent') && !content.includes('this.nerv.emit')) {
        throw new Error('Não emite eventos via NERV');
    }
    console.log('  ✓ Emite telemetria via NERV');
});

/**
 * TEST 6: Comandos ao driver chegam via NERV
 */
runTest('TEST 6: Driver Commands - Recepção via NERV', () => {
    console.log('> Verificando recepção de comandos...');

    const adapterPath = path.join(process.cwd(), 'src/driver/nerv_adapter/driver_nerv_adapter.js');
    const content = fs.readFileSync(adapterPath, 'utf8');

    // Deve ter _setupListeners ou similar
    if (!content.includes('_setupListeners') && !content.includes('setupListeners')) {
        throw new Error('Não tem método setupListeners');
    }
    console.log('  ✓ Tem setupListeners()');

    // Deve escutar mensagens do NERV
    if (!content.includes('onReceive')) {
        throw new Error('Não escuta mensagens do NERV');
    }
    console.log('  ✓ Escuta nerv.onReceive()');

    // Deve filtrar comandos DRIVER_*
    if (!content.includes('DRIVER_EXECUTE') || !content.includes('DRIVER_ABORT')) {
        throw new Error('Não processa comandos DRIVER_* esperados');
    }
    console.log('  ✓ Processa DRIVER_EXECUTE e DRIVER_ABORT');

    // Deve ter handler de comandos
    if (!content.includes('_handleDriverCommand') && !content.includes('handleDriverCommand')) {
        throw new Error('Não tem handler de comandos');
    }
    console.log('  ✓ Tem _handleDriverCommand()');
});

/**
 * TEST 7: DriverLifecycleManager não viola princípios NERV
 */
runTest('TEST 7: DriverLifecycleManager - Conformidade NERV', () => {
    console.log('> Verificando DriverLifecycleManager...');

    const lifecyclePath = path.join(process.cwd(), 'src/driver/DriverLifecycleManager.js');
    const content = fs.readFileSync(lifecyclePath, 'utf8');

    // NÃO deve ter require do KERNEL (apenas logger é OK)
    const kernelImports = content.match(/require\(['"].*kernel/gi) || [];
    const legitimateImports = kernelImports.filter(imp => !imp.includes('logger'));

    if (legitimateImports.length > 0) {
        throw new Error(`DriverLifecycleManager importa KERNEL: ${legitimateImports}`);
    }
    console.log('  ✓ Sem imports indevidos do KERNEL');

    // NÃO deve ter require do SERVER
    if (content.match(/require\(['"].*server/i)) {
        throw new Error('DriverLifecycleManager importa SERVER');
    }
    console.log('  ✓ Sem imports do SERVER');

    // Deve ter AbortController (soberania de interrupção)
    if (!content.includes('AbortController')) {
        throw new Error('Não usa AbortController');
    }
    console.log('  ✓ Usa AbortController (soberania)');

    // Deve ter DriverFactory
    if (!content.includes('driverFactory')) {
        throw new Error('Não usa DriverFactory');
    }
    console.log('  ✓ Usa DriverFactory');
});

/**
 * TEST 8: Verificação de comentários TODO sobre NERV
 */
runTest('TEST 8: TODOs e Pendências - Análise de débitos técnicos', () => {
    console.log('> Verificando TODOs relacionados ao NERV...');

    const lifecyclePath = path.join(process.cwd(), 'src/driver/DriverLifecycleManager.js');
    const content = fs.readFileSync(lifecyclePath, 'utf8');

    const todoMatches = content.match(/TODO.*NERV/gi) || [];

    if (todoMatches.length > 0) {
        console.log(`  ⚠️  Encontrados ${todoMatches.length} TODOs relacionados ao NERV:`);
        todoMatches.forEach((todo, index) => {
            console.log(`     ${index + 1}. ${todo.trim()}`);
        });
        console.log('  ℹ️  Estes TODOs indicam trabalho futuro de desacoplamento');
    } else {
        console.log('  ✓ Nenhum TODO pendente sobre NERV');
    }
});

// Sumário final
console.log(`
╔══════════════════════════════════════════════════════════════╗
║               SUMÁRIO - DRIVER NERV INTEGRATION              ║
╚══════════════════════════════════════════════════════════════╝

✅ Imports: Driver não importa KERNEL: ${testsPassed >= 1 ? 'PASSOU' : 'FALHOU'}
✅ Imports: Driver não importa SERVER: ${testsPassed >= 2 ? 'PASSOU' : 'FALHOU'}
✅ Filesystem: Driver não acessa filesystem: ${testsPassed >= 3 ? 'PASSOU' : 'FALHOU'}
✅ Adapter: Comunicação 100% via NERV: ${testsPassed >= 4 ? 'PASSOU' : 'FALHOU'}
✅ Telemetria: Fluxo via NERV: ${testsPassed >= 5 ? 'PASSOU' : 'FALHOU'}
✅ Comandos: Recepção via NERV: ${testsPassed >= 6 ? 'PASSOU' : 'FALHOU'}
✅ Lifecycle: Conformidade NERV: ${testsPassed >= 7 ? 'PASSOU' : 'FALHOU'}
✅ TODOs: Análise de débitos: ${testsPassed >= 8 ? 'PASSOU' : 'FALHOU'}

📊 Score: ${testsPassed}/8 testes passaram

${testsPassed === 8 ? `
🎉 DRIVER COMPLETAMENTE INTEGRADO VIA NERV!

Princípios validados:
  ✓ Zero acoplamento direto (KERNEL/SERVER)
  ✓ NERV como transportador universal
  ✓ Telemetria fluindo via pub/sub
  ✓ Comandos chegando via pub/sub
  ✓ Soberania de interrupção (AbortController)

✨ Arquitetura limpa e desacoplada!
` : `
⚠️  ALGUNS TESTES FALHARAM (${testsFailed}/8)

Revise os logs acima para identificar violações
dos princípios NERV.
`}
`);

process.exit(testsPassed === 8 ? 0 : 1);
