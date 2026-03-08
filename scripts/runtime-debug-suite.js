#!/usr/bin/env node
// @ts-check
/**
 * Runtime Debugger Suite - Node.js Inspect Coverage
 *
 * Executa debugging abrangente com Node inspect em todos os cenários possíveis
 * para identificar bugs de runtime não detectados por testes estáticos.
 *
 * Estratégia:
 * 1. Identificar todos os pontos de entrada (main, scripts, testes)
 * 2. Gerar cenários de execução com variações de configuração
 * 3. Executar cada cenário com Node inspect + profiling
 * 4. Coletar traces, heap dumps, CPU profiles
 * 5. Analisar padrões de falha e memory leaks
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, '..');
const DEBUG_PORT = 9229;
// const DEBUG_HOST = '127.0.0.1'; // Reservado para uso futuro

// ============================================================================
// CONFIGURAÇÃO DE CENÁRIOS
// ============================================================================

const ENTRY_POINTS = [
    {
        name: 'Main Application',
        script: 'src/main.js',
        args: [],
        env: { NODE_ENV: 'development' },
        description: 'Ponto de entrada principal do sistema',
    },
    {
        name: 'Index Entry',
        script: 'index.js',
        args: [],
        env: { NODE_ENV: 'development' },
        description: 'Entry point alternativo',
    },
    {
        name: 'Test Runner',
        script: 'node',
        args: ['--test', 'tests/unit/**/*.spec.js'],
        env: { NODE_ENV: 'test' },
        description: 'Execução de testes unitários',
    },
    {
        name: 'Integration Tests',
        script: 'node',
        args: ['--test', 'tests/integration/**/*.spec.js'],
        env: { NODE_ENV: 'test' },
        description: 'Testes de integração',
    },
    {
        name: 'E2E Tests',
        script: 'node',
        args: ['--test', 'tests/e2e/**/*.spec.js'],
        env: { NODE_ENV: 'test' },
        description: 'Testes end-to-end',
    },
];

const CONFIG_VARIATIONS = [
    {
        name: 'Default Config',
        env: {},
        description: 'Configuração padrão',
    },
    {
        name: 'Debug Mode',
        env: { DEBUG: '*', VERBOSE: '1' },
        description: 'Modo debug ativado',
    },
    {
        name: 'Strict Mode',
        env: { NODE_OPTIONS: '--unhandled-rejections=strict --trace-warnings' },
        description: 'Modo strict para detectar warnings',
    },
    {
        name: 'Memory Limits',
        env: { NODE_OPTIONS: '--max-old-space-size=512' },
        description: 'Limite de memória reduzido para detectar leaks',
    },
    {
        name: 'No Optimizations',
        env: { NODE_OPTIONS: '--no-opt --trace-opt --trace-deopt' },
        description: 'Desabilitar otimizações para detectar deopts',
    },
];

const DEBUG_SCENARIOS = [
    {
        name: 'CPU Profiling',
        inspectArgs: ['--inspect', `--inspect-port=${DEBUG_PORT}`, '--cpu-prof', '--cpu-prof-dir=./debug-profiles'],
        duration: 30000, // 30s
        description: 'Profile de CPU para detectar gargalos',
    },
    {
        name: 'Heap Snapshot',
        inspectArgs: ['--inspect', `--inspect-port=${DEBUG_PORT}`, '--heap-prof', '--heap-prof-dir=./debug-profiles'],
        duration: 45000, // 45s
        description: 'Profile de heap para detectar memory leaks',
    },
    {
        name: 'Trace Events',
        inspectArgs: [
            '--inspect',
            `--inspect-port=${DEBUG_PORT}`,
            '--trace-events-enabled',
            '--trace-event-file=./debug-profiles/trace.json',
        ],
        duration: 20000, // 20s
        description: 'Trace de eventos do Node.js',
    },
    {
        name: 'Async Stack Traces',
        inspectArgs: ['--inspect', `--inspect-port=${DEBUG_PORT}`, '--async-stack-traces'],
        duration: 25000, // 25s
        description: 'Stack traces assíncronas completas',
    },
];

// ============================================================================
// UTILITÁRIOS
// ============================================================================

function createDebugDirectory() {
    const debugDir = path.join(ROOT_DIR, 'debug-profiles');
    if (!fs.existsSync(debugDir)) {
        fs.mkdirSync(debugDir, { recursive: true });
    }
    return debugDir;
}

/**
 * @param {any} entryPoint
 * @param {any} config
 * @param {any} scenario
 * @returns {string}
 */
function generateScenarioId(entryPoint, config, scenario) {
    return `${entryPoint.name}_${config.name}_${scenario.name}`
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '_')
        .replace(/_+/g, '_');
}

/**
 * @param {any} baseEnv
 * @param {any} additionalEnv
 * @returns {any}
 */
function mergeEnv(baseEnv, additionalEnv) {
    return { ...baseEnv, ...additionalEnv };
}

// ============================================================================
// EXECUTOR DE CENÁRIOS
// ============================================================================

/**
 * @param {any} entryPoint
 * @param {any} config
 * @param {any} scenario
 * @returns {Promise<any>}
 */
async function executeScenario(entryPoint, config, scenario) {
    const scenarioId = generateScenarioId(entryPoint, config, scenario);
    // const debugDir = createDebugDirectory(); // Diretório criado implicitamente

    console.log(`\n🔍 Executando cenário: ${scenarioId}`);
    console.log(`   📝 ${scenario.description}`);
    console.log(`   ⏱️  Duração: ${scenario.duration}ms`);

    return new Promise(resolve => {
        const env = mergeEnv(mergeEnv(process.env, entryPoint.env), config.env);

        // Configurar argumentos do Node.js
        const nodeArgs = [...scenario.inspectArgs, '--enable-source-maps', '--trace-uncaught', '--trace-exit'];

        // Adicionar script e argumentos
        const finalArgs = [...nodeArgs, entryPoint.script, ...entryPoint.args];

        console.log(`   🚀 Comando: node ${finalArgs.join(' ')}`);

        const child = spawn('node', finalArgs, {
            cwd: ROOT_DIR,
            env,
            stdio: ['pipe', 'pipe', 'pipe'],
            detached: false,
        });

        let stdout = '';
        let stderr = '';
        let timeoutId;

        // Coletar output
        child.stdout.on('data', data => {
            stdout += data.toString();
            process.stdout.write(`[${scenarioId}] ${data}`);
        });

        child.stderr.on('data', data => {
            stderr += data.toString();
            process.stderr.write(`[${scenarioId}] ${data}`);
        });

        // Timeout para encerrar o processo
        timeoutId = setTimeout(() => {
            console.log(`   ⏰ Timeout atingido, encerrando processo...`);
            try {
                process.kill(/** @type {number} */ (child.pid), 'SIGTERM');
            } catch (_e) {
                // Processo já pode ter terminado
            }
        }, scenario.duration);

        child.on('close', (code, signal) => {
            clearTimeout(timeoutId);

            const result = {
                scenarioId,
                entryPoint: entryPoint.name,
                config: config.name,
                scenario: scenario.name,
                exitCode: code,
                signal,
                stdout,
                stderr,
                duration: scenario.duration,
                timestamp: new Date().toISOString(),
            };

            console.log(`   ✅ Cenário concluído (exit: ${code}, signal: ${signal})`);

            resolve(result);
        });

        child.on('error', error => {
            clearTimeout(timeoutId);
            console.error(`   ❌ Erro no cenário: ${error.message}`);

            resolve({
                scenarioId,
                error: error.message,
                timestamp: new Date().toISOString(),
            });
        });
    });
}

// ============================================================================
// ANALISADOR DE RESULTADOS
// ============================================================================

/**
 * @param {any[]} results
 * @returns {any}
 */
function analyzeResults(results) {
    console.log('\n📊 ANÁLISE DE RESULTADOS\n');

    const successful = results.filter(r => !r.error && r.exitCode === 0);
    const failed = results.filter(r => r.error || r.exitCode !== 0);
    const errors = results.filter(r => r.stderr && r.stderr.includes('Error'));

    console.log(`✅ Cenários bem-sucedidos: ${successful.length}`);
    console.log(`❌ Cenários com falha: ${failed.length}`);
    console.log(`🚨 Cenários com erros: ${errors.length}`);

    if (errors.length > 0) {
        console.log('\n🔍 ERROS DETECTADOS:');
        errors.forEach(error => {
            console.log(
                `   • ${error.scenarioId}: ${error.stderr.split('\n').find((/** @type {string} */ line) => line.includes('Error')) || 'Erro genérico'}`
            );
        });
    }

    // Analisar padrões de falha
    const errorPatterns = /** @type {Record<string, number>} */ ({});
    results.forEach(result => {
        if (result.stderr) {
            const lines = result.stderr.split('\n');
            lines.forEach((/** @type {string} */ line) => {
                if (line.includes('Error') || line.includes('Exception') || line.includes('uncaught')) {
                    const pattern = line.split(':')[0] ?? '';
                    errorPatterns[pattern] = (errorPatterns[pattern] || 0) + 1;
                }
            });
        }
    });

    if (Object.keys(errorPatterns).length > 0) {
        console.log('\n📈 PADRÕES DE ERRO MAIS FREQUENTES:');
        Object.entries(errorPatterns)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 5)
            .forEach(([pattern, count]) => {
                console.log(`   • ${pattern}: ${count} ocorrências`);
            });
    }

    return {
        summary: {
            total: results.length,
            successful: successful.length,
            failed: failed.length,
            errors: errors.length,
        },
        errorPatterns,
        detailed: results,
    };
}

// ============================================================================
// PERSISTÊNCIA DE RESULTADOS
// ============================================================================

/**
 * @param {any} analysis
 */
function saveResults(analysis) {
    const debugDir = createDebugDirectory();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reportPath = path.join(debugDir, `runtime-debug-report-${timestamp}.json`);

    fs.writeFileSync(reportPath, JSON.stringify(analysis, null, 2));
    console.log(`\n💾 Relatório salvo em: ${reportPath}`);

    // Gerar relatório HTML simples
    const htmlPath = path.join(debugDir, `runtime-debug-report-${timestamp}.html`);
    const html = generateHtmlReport(analysis);
    fs.writeFileSync(htmlPath, html);
    console.log(`📄 Relatório HTML salvo em: ${htmlPath}`);
}

/**
 * @param {any} analysis
 * @returns {string}
 */
function generateHtmlReport(analysis) {
    return `
<!DOCTYPE html>
<html>
<head>
    <title>Runtime Debug Report</title>
    <style>
        body { font-family: monospace; margin: 20px; }
        .summary { background: #f0f0f0; padding: 10px; border-radius: 5px; }
        .error { color: red; }
        .success { color: green; }
        .scenario { margin: 10px 0; padding: 10px; border: 1px solid #ccc; }
        .failed { border-color: red; background: #ffe6e6; }
        .passed { border-color: green; background: #e6ffe6; }
    </style>
</head>
<body>
    <h1>🔍 Runtime Debug Report</h1>
    <div class="summary">
        <h2>Summary</h2>
        <p>Total Scenarios: ${analysis.summary.total}</p>
        <p class="success">Successful: ${analysis.summary.successful}</p>
        <p class="error">Failed: ${analysis.summary.failed}</p>
        <p class="error">With Errors: ${analysis.summary.errors}</p>
    </div>

    <h2>Error Patterns</h2>
    <ul>
        ${Object.entries(analysis.errorPatterns)
            .map(([pattern, count]) => `<li>${pattern}: ${count} occurrences</li>`)
            .join('')}
    </ul>

    <h2>Detailed Results</h2>
    ${analysis.detailed
        .map(
            (/** @type {any} */ result) => `
        <div class="scenario ${result.exitCode === 0 ? 'passed' : 'failed'}">
            <h3>${result.scenarioId}</h3>
            <p>Exit Code: ${result.exitCode}</p>
            ${result.error ? `<p class="error">Error: ${result.error}</p>` : ''}
            ${result.stderr ? `<pre class="error">${result.stderr.slice(0, 500)}...</pre>` : ''}
        </div>
    `
        )
        .join('')}
</body>
</html>`;
}

// ============================================================================
// EXECUÇÃO PRINCIPAL
// ============================================================================

/**
 * Função exportada: runRuntimeDebugSuite.
 * @returns {Promise<void>}
 */
async function main() {
    console.log('🚀 RUNTIME DEBUG SUITE - Node.js Inspect Coverage');
    console.log('================================================\n');

    const totalScenarios = ENTRY_POINTS.length * CONFIG_VARIATIONS.length * DEBUG_SCENARIOS.length;
    console.log(`📋 Cenários totais: ${totalScenarios}`);
    console.log(`   • Entry Points: ${ENTRY_POINTS.length}`);
    console.log(`   • Config Variations: ${CONFIG_VARIATIONS.length}`);
    console.log(`   • Debug Scenarios: ${DEBUG_SCENARIOS.length}\n`);

    createDebugDirectory();

    const results = [];

    // Executar todos os cenários
    for (const entryPoint of ENTRY_POINTS) {
        for (const config of CONFIG_VARIATIONS) {
            for (const scenario of DEBUG_SCENARIOS) {
                try {
                    const result = await executeScenario(entryPoint, config, scenario);
                    results.push(result);

                    // Pequena pausa entre cenários para evitar interferência
                    await new Promise(resolve => setTimeout(resolve, 1000));
                } catch (error) {
                    const _ce = /** @type {any} */ (error);
                    console.error(`❌ Erro crítico no cenário: ${_ce.message}`);
                    results.push({
                        scenarioId: generateScenarioId(entryPoint, config, scenario),
                        error: _ce.message,
                        timestamp: new Date().toISOString(),
                    });
                }
            }
        }
    }

    // Analisar e salvar resultados
    const analysis = analyzeResults(results);
    saveResults(analysis);

    console.log('\n🎯 Runtime Debug Suite concluída!');
    console.log('Verifique os arquivos de profile gerados em ./debug-profiles/');
}

// Executar se chamado diretamente
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(console.error);
}

export { main as runRuntimeDebugSuite };
