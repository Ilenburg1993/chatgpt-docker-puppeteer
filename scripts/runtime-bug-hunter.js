#!/usr/bin/env node
/**
 * Runtime Bug Hunter - Foco em Cenários Críticos
 *
 * Estratégia direcionada para detectar bugs de runtime específicos:
 * - Memory leaks em operações de longa duração
 * - Race conditions em operações concorrentes
 * - Unhandled rejections em promises
 * - Event loop blocking
 * - Resource leaks (file handles, network connections)
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, '..');

// ============================================================================
// CENÁRIOS CRÍTICOS PARA BUGS DE RUNTIME
// ============================================================================

const CRITICAL_SCENARIOS = [
    {
        name: 'Memory Leak Detection',
        script: 'src/main.js',
        args: [],
        env: {
            NODE_ENV: 'development',
            DEBUG: 'memory',
            NODE_OPTIONS: '--inspect=9229 --heap-prof --heap-prof-interval=1024 --max-old-space-size=256',
        },
        duration: 60000, // 1 minuto para detectar leaks
        description: 'Detectar memory leaks em operações normais',
        focus: 'memory',
    },
    {
        name: 'Race Condition Stress',
        script: 'scripts/gerador_tarefa.js',
        args: ['--count', '50', '--parallel', '10'],
        env: {
            NODE_ENV: 'test',
            DEBUG: 'race',
            NODE_OPTIONS: '--inspect=9230 --async-stack-traces --trace-warnings',
        },
        duration: 45000,
        description: 'Stress test para race conditions na geração de tarefas',
        focus: 'concurrency',
    },
    {
        name: 'Promise Rejection Hunt',
        script: 'src/main.js',
        args: [],
        env: {
            NODE_ENV: 'development',
            NODE_OPTIONS: '--inspect=9231 --unhandled-rejections=strict --trace-uncaught',
        },
        duration: 30000,
        description: 'Caçar unhandled promise rejections',
        focus: 'promises',
    },
    {
        name: 'Event Loop Blocking',
        script: 'src/main.js',
        args: [],
        env: {
            NODE_ENV: 'development',
            DEBUG: 'blocking',
            NODE_OPTIONS: '--inspect=9232 --cpu-prof --prof --trace-event-categories=v8,node',
        },
        duration: 30000,
        description: 'Detectar blocking do event loop',
        focus: 'performance',
    },
    {
        name: 'Resource Leak Detection',
        script: 'src/main.js',
        args: [],
        env: {
            NODE_ENV: 'development',
            DEBUG: 'resources',
            NODE_OPTIONS: '--inspect=9233 --trace-sync-io --trace-fs-stats',
        },
        duration: 45000,
        description: 'Detectar leaks de recursos (files, sockets)',
        focus: 'resources',
    },
    {
        name: 'Error Propagation Test',
        script: 'src/main.js',
        args: [],
        env: {
            NODE_ENV: 'development',
            FORCE_ERRORS: '1',
            DEBUG: 'errors',
            NODE_OPTIONS: '--inspect=9234 --trace-warnings --trace-uncaught',
        },
        duration: 20000,
        description: 'Testar propagação de erros forçados',
        focus: 'error-handling',
    },
];

// ============================================================================
// MONITOR DE RUNTIME
// ============================================================================

class RuntimeMonitor {
    constructor() {
        this.metrics = {
            memory: [],
            cpu: [],
            handles: [],
            requests: [],
        };
        this.interval = null;
    }

    start() {
        this.interval = setInterval(() => {
            const memUsage = process.memoryUsage();
            this.metrics.memory.push({
                timestamp: Date.now(),
                rss: memUsage.rss,
                heapUsed: memUsage.heapUsed,
                heapTotal: memUsage.heapTotal,
                external: memUsage.external,
            });
        }, 1000);
    }

    stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
    }

    analyze() {
        if (this.metrics.memory.length === 0) return null;

        const memoryTrend = this.analyzeMemoryTrend();
        const peakMemory = Math.max(...this.metrics.memory.map(m => m.heapUsed));

        return {
            memoryTrend,
            peakMemory,
            averageMemory: this.metrics.memory.reduce((sum, m) => sum + m.heapUsed, 0) / this.metrics.memory.length,
            memorySamples: this.metrics.memory.length,
        };
    }

    analyzeMemoryTrend() {
        if (this.metrics.memory.length < 5) return 'insufficient-data';

        const recent = this.metrics.memory.slice(-5);
        const older = this.metrics.memory.slice(-10, -5);

        if (!older.length) return 'stable';

        const recentAvg = recent.reduce((sum, m) => sum + m.heapUsed, 0) / recent.length;
        const olderAvg = older.reduce((sum, m) => sum + m.heapUsed, 0) / older.length;

        const growthRate = (recentAvg - olderAvg) / olderAvg;

        if (growthRate > 0.1) return 'increasing';
        if (growthRate < -0.1) return 'decreasing';
        return 'stable';
    }
}

// ============================================================================
// EXECUTOR ESPECIALIZADO
// ============================================================================

async function executeCriticalScenario(scenario) {
    console.log(`\n🎯 Executando cenário crítico: ${scenario.name}`);
    console.log(`   📝 ${scenario.description}`);
    console.log(`   🎯 Foco: ${scenario.focus}`);
    console.log(`   ⏱️  Duração: ${scenario.duration}ms`);

    const monitor = new RuntimeMonitor();
    monitor.start();

    return new Promise(resolve => {
        const child = spawn('node', [scenario.script, ...scenario.args], {
            cwd: ROOT_DIR,
            env: { ...process.env, ...scenario.env },
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';
        let timeoutId;

        child.stdout.on('data', data => {
            stdout += data.toString();
        });

        child.stderr.on('data', data => {
            stderr += data.toString();
            process.stderr.write(`[${scenario.name}] ${data}`);
        });

        timeoutId = setTimeout(() => {
            console.log(`   ⏰ Timeout, encerrando processo...`);
            try {
                child.kill('SIGTERM');
            } catch (_e) {
                // Processo já pode ter terminado
            }
        }, scenario.duration);

        child.on('close', (code, signal) => {
            clearTimeout(timeoutId);
            monitor.stop();

            const runtimeAnalysis = monitor.analyze();

            const result = {
                scenario: scenario.name,
                focus: scenario.focus,
                exitCode: code,
                signal,
                stdout,
                stderr,
                runtimeAnalysis,
                duration: scenario.duration,
                timestamp: new Date().toISOString(),
                success: code === 0 && !signal,
            };

            console.log(`   ✅ Cenário concluído (exit: ${code}, signal: ${signal})`);

            if (runtimeAnalysis) {
                console.log(`   📊 Análise de runtime:`);
                console.log(`      • Pico de memória: ${(runtimeAnalysis.peakMemory / 1024 / 1024).toFixed(2)} MB`);
                console.log(`      • Tendência: ${runtimeAnalysis.memoryTrend}`);
            }

            resolve(result);
        });

        child.on('error', error => {
            clearTimeout(timeoutId);
            monitor.stop();
            console.error(`   ❌ Erro crítico: ${error.message}`);

            resolve({
                scenario: scenario.name,
                focus: scenario.focus,
                error: error.message,
                timestamp: new Date().toISOString(),
                success: false,
            });
        });
    });
}

// ============================================================================
// ANALISADOR DE BUGS DE RUNTIME
// ============================================================================

function analyzeRuntimeBugs(results) {
    console.log('\n🐛 ANÁLISE DE BUGS DE RUNTIME\n');

    const bugs = {
        memoryLeaks: [],
        raceConditions: [],
        unhandledRejections: [],
        blockingOperations: [],
        resourceLeaks: [],
        errorPropagation: [],
    };

    results.forEach(result => {
        if (!result.success) {
            console.log(`❌ Cenário falhou: ${result.scenario}`);
            if (result.stderr) {
                console.log(`   Erro: ${result.stderr.slice(0, 200)}...`);
            }
        }

        // Análise específica por tipo de foco
        switch (result.focus) {
            case 'memory':
                if (result.runtimeAnalysis?.memoryTrend === 'increasing') {
                    bugs.memoryLeaks.push({
                        scenario: result.scenario,
                        evidence: `Memory trend: ${result.runtimeAnalysis.memoryTrend}, Peak: ${(result.runtimeAnalysis.peakMemory / 1024 / 1024).toFixed(2)} MB`,
                    });
                }
                break;

            case 'concurrency':
                if ((result.stderr && result.stderr.includes('race')) || result.stderr.includes('concurrent')) {
                    bugs.raceConditions.push({
                        scenario: result.scenario,
                        evidence: result.stderr,
                    });
                }
                break;

            case 'promises':
                if (result.stderr && (result.stderr.includes('unhandled') || result.stderr.includes('rejection'))) {
                    bugs.unhandledRejections.push({
                        scenario: result.scenario,
                        evidence: result.stderr,
                    });
                }
                break;

            case 'performance':
                if (result.stderr && result.stderr.includes('blocking')) {
                    bugs.blockingOperations.push({
                        scenario: result.scenario,
                        evidence: result.stderr,
                    });
                }
                break;

            case 'resources':
                if (result.stderr && (result.stderr.includes('EMFILE') || result.stderr.includes('ENOTFOUND'))) {
                    bugs.resourceLeaks.push({
                        scenario: result.scenario,
                        evidence: result.stderr,
                    });
                }
                break;
        }
    });

    // Relatório consolidado
    const totalBugs = Object.values(bugs).reduce((sum, arr) => sum + arr.length, 0);

    console.log(`📊 Total de bugs detectados: ${totalBugs}\n`);

    Object.entries(bugs).forEach(([type, issues]) => {
        if (issues.length > 0) {
            console.log(`🚨 ${type.toUpperCase()}: ${issues.length} ocorrências`);
            issues.forEach((issue, idx) => {
                console.log(`   ${idx + 1}. ${issue.scenario}`);
                console.log(`      ${issue.evidence.slice(0, 100)}...`);
            });
            console.log('');
        }
    });

    return bugs;
}

// ============================================================================
// EXECUÇÃO PRINCIPAL
// ============================================================================

/**
 * Função exportada: huntRuntimeBugs.
 * @returns {Promise<void>}
 */
async function main() {
    console.log('🐛 RUNTIME BUG HUNTER - Detecção de Bugs Críticos');
    console.log('=================================================\n');

    console.log(`🎯 Cenários críticos: ${CRITICAL_SCENARIOS.length}`);
    CRITICAL_SCENARIOS.forEach((scenario, idx) => {
        console.log(`   ${idx + 1}. ${scenario.name} (${scenario.focus})`);
    });
    console.log('');

    const results = [];

    // Executar cenários críticos
    for (const scenario of CRITICAL_SCENARIOS) {
        try {
            const result = await executeCriticalScenario(scenario);
            results.push(result);

            // Pausa entre cenários para limpeza
            await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (error) {
            console.error(`❌ Erro crítico no cenário ${scenario.name}: ${error.message}`);
            results.push({
                scenario: scenario.name,
                focus: scenario.focus,
                error: error.message,
                success: false,
            });
        }
    }

    // Análise de bugs
    const bugs = analyzeRuntimeBugs(results);

    // Salvar relatório
    const reportPath = path.join(ROOT_DIR, 'debug-profiles', `runtime-bugs-${Date.now()}.json`);
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify({ results, bugs }, null, 2));

    console.log(`💾 Relatório salvo em: ${reportPath}`);

    // Resumo final
    const successful = results.filter(r => r.success).length;
    const failed = results.length - successful;

    console.log('\n🏁 RESUMO FINAL:');
    console.log(`   ✅ Cenários bem-sucedidos: ${successful}`);
    console.log(`   ❌ Cenários com problemas: ${failed}`);
    console.log(`   🐛 Bugs detectados: ${Object.values(bugs).reduce((sum, arr) => sum + arr.length, 0)}`);

    if (failed > 0) {
        console.log('\n⚠️  Recomendações:');
        console.log('   • Verificar logs detalhados no relatório');
        console.log('   • Executar cenários individuais para debug');
        console.log('   • Considerar isolamento de componentes problemáticos');
    }
}

// Executar se chamado diretamente
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(console.error);
}

export { main as huntRuntimeBugs };
