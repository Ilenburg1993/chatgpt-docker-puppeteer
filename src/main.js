/* ==========================================================================
   src/main.js
   Entry Point: Maestro Bootstrap (Singularity Edition)
   Audit Level: 900 — Sovereign Boot Sequence
   
   Responsabilidade:
   - Orquestrar boot sequence completo do sistema
   - Inicializar subsistemas na ordem correta: NERV → BrowserPool → KERNEL → Adapters
   - Configurar graceful shutdown (SIGTERM, SIGINT)
   - Gerenciar ciclo de vida completo da aplicação
   
   Princípios:
   - Boot rápido e determinístico (< 5 segundos ideal)
   - Falha em qualquer subsistema = shutdown gracioso
   - Zero acoplamento entre subsistemas (NERV único canal)
   - Logs estruturados para auditoria
========================================================================== */

// @ts-nocheck - Suprime warnings TypeScript para propriedades dinâmicas e tipos implícitos

const { log } = require('./core/logger');
const CONFIG = require('./core/config');
const identityManager = require('./core/identity_manager');

// Subsistemas Core
const { createNERV } = require('./nerv/nerv');
const { createKernel } = require('./kernel/kernel');
const BrowserPoolManager = require('./infra/browser_pool/pool_manager');
const { ConnectionOrchestrator } = require('./infra/ConnectionOrchestrator');

// Adapters (Pontes NERV)
const DriverNERVAdapter = require('./driver/nerv_adapter/driver_nerv_adapter');
const ServerNERVAdapter = require('./server/nerv_adapter/server_nerv_adapter');

/* ==========================================================================
   BOOT SEQUENCE
========================================================================== */

/**
 * Sequência de inicialização do sistema.
 * Ordem crítica: NERV → BrowserPool → KERNEL → Adapters → Server
 */
async function boot() {
    log('INFO', '🚀 Maestro Singularity Edition - Iniciando boot sequence...');
    
    const bootStartTime = Date.now();
    
    try {
        // ===== FASE 1: CONFIGURAÇÃO E IDENTIDADE =====
        log('INFO', '[BOOT] Fase 1/6: Configuração e Identidade');
        
        // Carga de configuração
        await CONFIG.reload('sys-boot');
        log('DEBUG', '[BOOT] Configurações carregadas');
        
        // Garante identidade do robô (robot_id)
        await identityManager.initialize();
        const identity = identityManager.getFullIdentity();
        log('INFO', `[BOOT] Identidade estabelecida: ${identity.robot_id}`);
        
        // Garbage collection inicial (se disponível)
        if (global.gc) {
            global.gc();
            log('DEBUG', '[BOOT] GC inicial executado');
        }
        
        // ===== FASE 2: NERV (IPC 3.0 - CANAL ÚNICO) =====
        log('INFO', '[BOOT] Fase 2/6: Inicializando NERV (canal de transporte)');
        
        const nerv = await createNERV({
            mode: 'hybrid', // local EventEmitter + Socket.io adapter
            correlation: true, // Event sourcing
            bufferSize: process.env.NERV_BUFFER_SIZE || CONFIG.NERV_BUFFER_SIZE || 1000,
            telemetry: process.env.NERV_TELEMETRY !== 'false' && (CONFIG.NERV_TELEMETRY !== false)
        });
        
        log('INFO', '[BOOT] ✅ NERV online (híbrido: local + remoto)');
        
        // ===== FASE 3: BROWSER POOL =====
        log('INFO', '[BOOT] Fase 3/6: Inicializando Browser Pool');
        
        const browserPool = new BrowserPoolManager({
            poolSize: process.env.BROWSER_POOL_SIZE || CONFIG.BROWSER_POOL_SIZE || 3,
            allocationStrategy: process.env.ALLOCATION_STRATEGY || CONFIG.ALLOCATION_STRATEGY || 'round-robin',
            healthCheckInterval: process.env.HEALTH_CHECK_INTERVAL || CONFIG.HEALTH_CHECK_INTERVAL || 30000,
            chromium: {
                browserURL: process.env.CHROME_WS_ENDPOINT || CONFIG.BROWSER_URL || 'http://localhost:9222',
                wsEndpoint: process.env.CHROME_WS_ENDPOINT || CONFIG.WS_ENDPOINT,
                executablePath: process.env.CHROME_EXECUTABLE_PATH || CONFIG.CHROME_EXECUTABLE_PATH
            }
        });
        
        await browserPool.initialize();
        const poolHealth = await browserPool.getHealth();
        log('INFO', `[BOOT] ✅ Browser Pool online (${poolHealth.healthy}/${poolHealth.poolSize} instâncias saudáveis)`);
        
        // ===== FASE 4: KERNEL (DECISOR SOBERANO) =====
        log('INFO', '[BOOT] Fase 4/6: Inicializando KERNEL');
        
        const kernel = await createKernel({
            nerv,  // Passa NERV diretamente
            telemetry: {
                source: 'kernel',
                retention: 1000
            },
            policy: {},
            loop: {
                cycleInterval: process.env.KERNEL_CYCLE_INTERVAL || CONFIG.KERNEL_CYCLE_INTERVAL || 50 // 50ms = 20 Hz
            }
        });
        
        log('INFO', '[BOOT] ✅ KERNEL online (loop 20 Hz)');
        
        // ===== FASE 5: ADAPTERS (PONTES NERV) =====
        log('INFO', '[BOOT] Fase 5/6: Inicializando Adapters');
        
        // Driver Adapter (DRIVER ↔ NERV)
        const driverAdapter = new DriverNERVAdapter(nerv, browserPool, CONFIG);
        // DriverNERVAdapter não tem método initialize() - setup é feito no constructor
        log('INFO', '[BOOT] ✅ DriverNERVAdapter online');
        
        // Server Adapter (SERVER ↔ NERV)
        // Cria HTTP server + Socket.io hub para o ServerNERVAdapter
        const http = require('http');
        const socketModule = require('./server/engine/socket');
        
        const httpServer = http.createServer();
        const socketHub = socketModule.init(httpServer);
        
        const serverAdapter = new ServerNERVAdapter(nerv, socketHub, CONFIG);
        
        // Inicia o servidor HTTP
        const serverPort = process.env.PORT || CONFIG.SERVER_PORT || 3008;
        await new Promise((resolve, reject) => {
            httpServer.listen(serverPort, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
        
        log('INFO', `[BOOT] ✅ ServerNERVAdapter online (porta ${serverPort})`);
        
        // ===== FASE 6: FINALIZAÇÃO =====
        const bootDuration = Date.now() - bootStartTime;
        log('INFO', `[BOOT] Fase 6/6: Sistema completamente online em ${bootDuration}ms 🎯`);
        log('INFO', '[BOOT] Todos os subsistemas operacionais. Aguardando comandos via NERV...');
        
        // Retorna contexto do sistema para graceful shutdown
        return {
            nerv,
            kernel,
            browserPool,
            driverAdapter,
            serverAdapter,
            bootDuration,
            identity
        };
        
    } catch (error) {
        log('FATAL', `[BOOT] Falha catastrófica durante boot: ${error.message}`);
        log('ERROR', `[BOOT] Stack trace: ${error.stack}`);
        
        // Boot failure = exit imediato
        process.exit(1);
    }
}

/* ==========================================================================
   GRACEFUL SHUTDOWN
========================================================================== */

/**
 * Shutdown gracioso de todos os subsistemas.
 * Ordem reversa do boot: Server → Adapters → KERNEL → BrowserPool → NERV
 * 
 * [V800] Isolamento de erros: Cada fase é independente.
 * Se uma fase falhar, as seguintes ainda executam (best-effort cleanup).
 */
async function shutdown(context) {
    log('WARN', '[SHUTDOWN] Iniciando shutdown gracioso...');
    
    const shutdownStartTime = Date.now();
    const phases = [];
    let failedPhases = 0;
    
    // Define todas as fases de shutdown com try-catch isolado
    const shutdownPhases = [
        {
            name: 'ServerAdapter',
            order: 1,
            fn: async () => {
                if (context.serverAdapter) {
                    await context.serverAdapter.shutdown();
                }
                
                // [P4.2 FIX] Desliga componentes de monitoramento do servidor
                try {
                    const reconcilier = require('./server/supervisor/reconcilier');
                    if (reconcilier && typeof reconcilier.stop === 'function') {
                        reconcilier.stop();
                    }
                } catch (e) {
                    log('WARN', `[SHUTDOWN] Falha ao parar reconcilier: ${e.message}`);
                }
                
                try {
                    const hardwareTelemetry = require('./server/realtime/telemetry/hardware');
                    if (hardwareTelemetry && typeof hardwareTelemetry.stop === 'function') {
                        hardwareTelemetry.stop();
                    }
                } catch (e) {
                    log('WARN', `[SHUTDOWN] Falha ao parar hardware telemetry: ${e.message}`);
                }
            }
        },
        {
            name: 'DriverAdapter',
            order: 2,
            fn: async () => {
                if (context.driverAdapter) {
                    await context.driverAdapter.shutdown();
                }
            }
        },
        {
            name: 'KERNEL',
            order: 3,
            fn: async () => {
                if (context.kernel) {
                    await context.kernel.shutdown();
                }
            }
        },
        {
            name: 'BrowserPool',
            order: 4,
            fn: async () => {
                if (context.browserPool) {
                    await context.browserPool.shutdown();
                }
            }
        },
        {
            name: 'NERV',
            order: 5,
            fn: async () => {
                if (context.nerv) {
                    await context.nerv.shutdown();
                }
            }
        },
        {
            name: 'TempProfiles',
            order: 6,
            fn: async () => {
                const cleanedProfiles = await ConnectionOrchestrator.cleanupTempProfiles();
                if (cleanedProfiles > 0) {
                    log('INFO', `[SHUTDOWN] Removidos ${cleanedProfiles} profiles temporários`);
                }
            }
        }
    ];
    
    // Executa cada fase com isolamento de erros
    for (const phase of shutdownPhases) {
        const phaseStartTime = Date.now();
        
        try {
            log('INFO', `[SHUTDOWN] ${phase.order}/6: Desligando ${phase.name}...`);
            await phase.fn();
            
            const phaseDuration = Date.now() - phaseStartTime;
            phases.push({
                name: phase.name,
                status: 'SUCCESS',
                duration: phaseDuration
            });
            
            log('DEBUG', `[SHUTDOWN] ${phase.name} concluído em ${phaseDuration}ms`);
            
        } catch (error) {
            const phaseDuration = Date.now() - phaseStartTime;
            failedPhases++;
            
            phases.push({
                name: phase.name,
                status: 'FAILED',
                duration: phaseDuration,
                error: error.message
            });
            
            log('ERROR', `[SHUTDOWN] Falha em ${phase.name}: ${error.message}`);
            // Continua para próxima fase (não interrompe shutdown)
        }
    }
    
    // Sumário do shutdown
    const shutdownDuration = Date.now() - shutdownStartTime;
    const successCount = phases.filter(p => p.status === 'SUCCESS').length;
    
    if (failedPhases === 0) {
        log('INFO', `[SHUTDOWN] ✅ Shutdown gracioso concluído: ${successCount}/6 fases OK em ${shutdownDuration}ms`);
        process.exit(0);
    } else {
        log('WARN', `[SHUTDOWN] ⚠️  Shutdown parcial: ${successCount}/6 fases OK, ${failedPhases} falhas em ${shutdownDuration}ms`);
        
        // Log detalhado das falhas
        phases.filter(p => p.status === 'FAILED').forEach(p => {
            log('ERROR', `   ❌ ${p.name}: ${p.error}`);
        });
        
        // Exit code 1 = shutdown com falhas (mas tentou limpar tudo)
        process.exit(1);
    }
}

/* ==========================================================================
   SIGNAL HANDLERS
========================================================================== */

// [P4.3 FIX] Flag global para prevenir shutdown concorrente
let _shutdownInProgress = false;

/**
 * Configura handlers para sinais de sistema.
 */
function setupSignalHandlers(context) {
    // [P4.3 FIX] Handler unificado com guard contra shutdown concorrente
    const gracefulShutdown = async (signal) => {
        if (_shutdownInProgress) {
            log('WARN', `[SIGNAL] ${signal} ignorado - shutdown já em andamento`);
            return;
        }
        
        _shutdownInProgress = true;
        log('WARN', `[SIGNAL] ${signal} recebido - iniciando shutdown gracioso`);
        
        try {
            await shutdown(context);
        } finally {
            process.exit(0);
        }
    };
    
    // SIGTERM: Shutdown gracioso (Docker, PM2, Kubernetes)
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    
    // SIGINT: Ctrl+C (desenvolvimento local)
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    
    // SIGHUP: Recarga de configuração (isolado, não shutdown)
    process.on('SIGHUP', async () => {
        if (_shutdownInProgress) {
            log('WARN', '[SIGNAL] SIGHUP ignorado - shutdown em andamento');
            return;
        }
        
        log('INFO', '[SIGNAL] SIGHUP recebido - recarregando configuração');
        await CONFIG.reload('sys-sighup');
        log('INFO', '[SIGNAL] Configuração recarregada');
    });
    
    // Uncaught Exception: Crash com forensics
    process.on('uncaughtException', (error) => {
        log('FATAL', `[CRASH] Uncaught Exception: ${error.message}`);
        log('ERROR', `[CRASH] Stack: ${error.stack}`);
        
        // TODO: Criar crash dump via forensics
        // await createCrashDump(null, error, 'sys-crash', 'uncaught-exception');
        
        process.exit(1);
    });
    
    // Unhandled Rejection: Promise sem catch
    process.on('unhandledRejection', (reason, promise) => {
        log('FATAL', `[CRASH] Unhandled Rejection: ${reason}`);
        log('ERROR', `[CRASH] Promise: ${promise}`);
        
        process.exit(1);
    });
}

/* ==========================================================================
   MAIN ENTRY POINT
========================================================================== */

async function main() {
    try {
        // Banner
        console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║   MAESTRO SINGULARITY EDITION                                 ║
║   Autonomous AI Agent - Universal LLM Orchestrator            ║
║   Version: 2.0.0 (NERV Architecture)                          ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
        `);
        
        // Boot do sistema
        const context = await boot();
        
        // Configura signal handlers
        setupSignalHandlers(context);
        
        // Sistema rodando - aguarda sinais
        log('INFO', '[MAIN] Sistema operacional. Pressione Ctrl+C para shutdown gracioso.');
        
    } catch (error) {
        log('FATAL', `[MAIN] Erro fatal não tratado: ${error.message}`);
        process.exit(1);
    }
}

// Executa main apenas se for entry point direto (não require())
if (require.main === module) {
    main();
}

module.exports = { boot, shutdown, main };
