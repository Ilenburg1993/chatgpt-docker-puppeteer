#!/usr/bin/env node
// @ts-check
/**
 * Development Runtime Monitor
 *
 * Monitora a aplicação em desenvolvimento em busca de bugs de runtime Executa automaticamente durante desenvolvimento
 * para detectar problemas em tempo real.
 */

import { spawn } from 'node:child_process';
// import fs from 'node:fs'; // Não utilizado neste módulo
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, '..');

// ============================================================================
// MONITOR CONTÍNUO
// ============================================================================

/** Classe exportada: DevelopmentMonitor. */
class DevelopmentMonitor {
    constructor() {
        this.isRunning = false;
        this.childProcess = null;
        this.restartCount = 0;
        this.lastRestart = Date.now();
        /** @type {any[]} */ this.errors = [];
        /** @type {any[]} */ this.warnings = [];
        /** @type {any[]} */ this.memoryPeaks = [];
    }

    async start() {
        console.log('🔍 Iniciando Development Runtime Monitor...');
        this.isRunning = true;

        // Monitor de memória
        this.memoryMonitor = setInterval(() => {
            const memUsage = process.memoryUsage();
            this.memoryPeaks.push({
                timestamp: Date.now(),
                heapUsed: memUsage.heapUsed,
                heapTotal: memUsage.heapTotal,
            });

            // Manter apenas últimas 100 amostras
            if (this.memoryPeaks.length > 100) {
                this.memoryPeaks.shift();
            }
        }, 5000);

        // Reinício automático a cada 5 minutos para detectar memory leaks
        this.restartTimer = setInterval(() => {
            this.restartApplication();
        }, 300000); // 5 minutos

        await this.startApplication();
    }

    async stop() {
        console.log('🛑 Parando Development Runtime Monitor...');
        this.isRunning = false;

        if (this.memoryMonitor) {
            clearInterval(this.memoryMonitor);
        }

        if (this.restartTimer) {
            clearInterval(this.restartTimer);
        }

        if (this.childProcess) {
            this.childProcess.kill('SIGTERM');
        }
    }

    async startApplication() {
        console.log(`🚀 Iniciando aplicação (reinício #${this.restartCount + 1})...`);

        const env = {
            ...process.env,
            NODE_ENV: 'development',
            DEBUG: 'dev-monitor',
            NODE_OPTIONS:
                '--inspect=9229 --enable-source-maps --trace-warnings --trace-uncaught --unhandled-rejections=warn --max-old-space-size=512',
        };

        this.childProcess = spawn('node', ['src/main.js'], {
            cwd: ROOT_DIR,
            env,
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        this.childProcess.stdout.on('data', (data) => {
            const output = data.toString();
            process.stdout.write(`[APP] ${output}`);
        });

        this.childProcess.stderr.on('data', (data) => {
            const error = data.toString();

            // Classificar erros vs warnings
            if (error.includes('Error') || error.includes('uncaught') || error.includes('unhandled')) {
                this.errors.push({
                    timestamp: Date.now(),
                    message: error,
                    type: 'error',
                });
                console.error(`❌ [ERROR] ${error}`);
            } else if (error.includes('Warning') || error.includes('deprecated')) {
                this.warnings.push({
                    timestamp: Date.now(),
                    message: error,
                    type: 'warning',
                });
                console.warn(`⚠️  [WARN] ${error}`);
            } else {
                process.stderr.write(`[APP] ${error}`);
            }
        });

        this.childProcess.on('close', (code, signal) => {
            console.log(`📊 Aplicação terminou (code: ${code}, signal: ${signal})`);

            if (this.isRunning && code !== 0) {
                console.log('🔄 Reiniciando devido a falha...');
                setTimeout(() => this.restartApplication(), 2000);
            }
        });

        this.childProcess.on('error', (error) => {
            console.error(`💥 Erro crítico na aplicação: ${error.message}`);
            this.errors.push({
                timestamp: Date.now(),
                message: error.message,
                type: 'critical',
            });
        });
    }

    async restartApplication() {
        console.log('🔄 Reiniciando aplicação para detecção de memory leaks...');

        if (this.childProcess) {
            this.childProcess.kill('SIGTERM');

            // Aguardar 2 segundos para graceful shutdown
            await new Promise((resolve) => setTimeout(resolve, 2000));
        }

        this.restartCount++;
        this.lastRestart = Date.now();

        await this.startApplication();
    }

    generateReport() {
        const now = Date.now();
        const uptime = now - this.lastRestart;

        const report = {
            timestamp: new Date().toISOString(),
            uptime: Math.floor(uptime / 1000),
            restarts: this.restartCount,
            errors: this.errors.length,
            warnings: this.warnings.length,
            memoryAnalysis: this.analyzeMemory(),
            recentErrors: this.errors.slice(-5),
            recentWarnings: this.warnings.slice(-5),
        };

        return report;
    }

    analyzeMemory() {
        if (this.memoryPeaks.length === 0) return null;

        const peaks = this.memoryPeaks.map((p) => p.heapUsed);
        const maxPeak = Math.max(...peaks);
        const avgPeak = peaks.reduce((sum, p) => sum + p, 0) / peaks.length;

        // Detectar tendência de crescimento
        const recent = peaks.slice(-10);
        const older = peaks.slice(-20, -10);
        let trend = 'stable';

        if (recent.length >= 5 && older.length >= 5) {
            const recentAvg = recent.reduce((sum, p) => sum + p, 0) / recent.length;
            const olderAvg = older.reduce((sum, p) => sum + p, 0) / older.length;
            const growthRate = (recentAvg - olderAvg) / olderAvg;

            if (growthRate > 0.05) trend = 'increasing';
            else if (growthRate < -0.05) trend = 'decreasing';
        }

        return {
            maxPeakMB: (maxPeak / 1024 / 1024).toFixed(2),
            avgPeakMB: (avgPeak / 1024 / 1024).toFixed(2),
            trend,
            samples: peaks.length,
        };
    }

    printStatus() {
        const report = this.generateReport();

        console.log('\n📊 STATUS DO MONITOR DE DESENVOLVIMENTO');
        console.log('==========================================');
        console.log(`⏱️  Uptime: ${report.uptime}s`);
        console.log(`🔄 Reinícios: ${report.restarts}`);
        console.log(`❌ Erros: ${report.errors}`);
        console.log(`⚠️  Warnings: ${report.warnings}`);

        if (report.memoryAnalysis) {
            console.log(`🧠 Memória - Pico: ${report.memoryAnalysis.maxPeakMB} MB (${report.memoryAnalysis.trend})`);
        }

        if (report.recentErrors.length > 0) {
            console.log('\n🚨 ÚLTIMOS ERROS:');
            report.recentErrors.forEach((error, idx) => {
                console.log(
                    `   ${idx + 1}. ${new Date(error.timestamp).toLocaleTimeString()}: ${error.message.slice(0, 80)}...`,
                );
            });
        }
    }
}

// ============================================================================
// EXECUÇÃO PRINCIPAL
// ============================================================================

async function main() {
    const monitor = new DevelopmentMonitor();

    // Capturar sinais para graceful shutdown
    process.on('SIGINT', async () => {
        console.log('\n⏹️  Recebido SIGINT, finalizando...');
        await monitor.stop();
        process.exit(0);
    });

    process.on('SIGTERM', async () => {
        console.log('\n⏹️  Recebido SIGTERM, finalizando...');
        await monitor.stop();
        process.exit(0);
    });

    // Status periódico
    const statusInterval = setInterval(() => {
        monitor.printStatus();
    }, 60000); // A cada minuto

    try {
        await monitor.start();

        // Manter rodando
        console.log('🔄 Monitor ativo. Pressione Ctrl+C para parar.');
        console.log('📊 Status será exibido a cada 1 minuto.');

        // Aguardar indefinidamente
        await new Promise(() => {}); // Nunca resolve
    } catch (error) {
        console.error('💥 Erro fatal no monitor:', error);
        await monitor.stop();
        process.exit(1);
    } finally {
        clearInterval(statusInterval);
    }
}

// Executar se chamado diretamente
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(console.error);
}

export { DevelopmentMonitor };
