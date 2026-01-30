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

/**
 * ARQUITETURA DE BROWSER (CANÔNICA)
 *
 * - Este sistema NÃO gerencia browsers.
 * - Este sistema NÃO executa Chromium nem chama `puppeteer.launch()`.
 * - Toda interação com browsers ocorre via conexão a um Chrome externo
 *   já em execução, acessível pelo DevTools Protocol (HTTP / WebSocket).
 * - Campo canônico de configuração: `browserEndpoint` (url, optional wsEndpoint).
 *
 * Qualquer tentativa de iniciar ou gerenciar o ciclo de vida do browser
 * a partir deste processo constitui uma violação arquitetural.
 */

// @ts-nocheck - Suprime warnings TypeScript para propriedades dinâmicas e tipos implícitos

// =========================================================================
// ARCHITECTURAL GUARDS (process-wide, non-negotiable)
// =========================================================================
// Importa o guard correto que impede chamadas a `puppeteer.launch()` em runtime
require('./infra/browser_pool/puppeteer_guard');
//

const { log } = require('./core/logger');

const { ActorRole, ActionCode, MessageType } = require('./shared/nerv/constants');

const { CONNECTION_MODES: CONNECTION_MODES } = require('./core/constants/browser.js');

const { STATUS_VALUES: STATUS_VALUES } = require('./core/constants/tasks.js');

const CONFIG = require('./core/config');
const identityManager = require('./core/identity_manager');

// Subsistemas Core
const { createNERV } = require('./nerv/nerv');
const { createKernel } = require('./kernel/kernel');
// const BrowserPoolManager = require('./infra/browser_pool/pool_manager');
const { ConnectionOrchestrator } = require('./infra/ConnectionOrchestrator');

// Mission Orchestration (V2.0)
const { MissionManager } = require('./missions/mission_manager');

// Módulos ONDA 2 (requerem NERV injection)
const forensics = require('./core/forensics');

// Adapters (Pontes NERV)
const DriverNERVAdapter = require('./driver/nerv_adapter/driver_nerv_adapter');
// ServerNERVAdapter is lazy-loaded when the server/socket hub is available

// ============================================================================
// SERVER MODE — CANONICAL RESOLUTION (FASE 2)
// ============================================================================

const SERVER_MODES = Object.freeze({
    INTEGRATED: 'integrated',
    SPLIT: 'split',
    DISABLED: 'disabled'
});

/**
 * Resolve modo operacional do server de forma canônica e validada.
 *
 * Fonte de verdade:
 *   1) process.env.SERVER_MODE
 *   2) CONFIG.SERVER_MODE
 *   3) fallback determinístico: integrated
 *
 * Propriedades:
 *   ✔ Normaliza case
 *   ✔ Valida contra enum fechado
 *   ✔ Fail-fast em valor inválido
 *   ✔ Loga origem
 */
function resolveServerMode() {
    const raw = process.env.SERVER_MODE ?? CONFIG.SERVER_MODE ?? SERVER_MODES.INTEGRATED;

    const mode = String(raw).toLowerCase().trim();

    const valid = Object.values(SERVER_MODES);

    if (!valid.includes(mode)) {
        log('FATAL', `[CONFIG] SERVER_MODE inválido: "${raw}"`);
        log('FATAL', `[CONFIG] Valores válidos: ${valid.join(', ')}`);
        process.exit(1);
    }

    log('INFO', `[CONFIG] SERVER_MODE resolvido: ${mode}`);

    return mode;
}

/* ==========================================================================
   BOOT SEQUENCE
========================================================================== */

/**
 * Sequência de inicialização do sistema.
 * Ordem crítica: NERV → BrowserPool → KERNEL → Adapters → Server
 *
 * @async
 * @returns {Promise<void>}
 * @throws {Error} Se qualquer subsistema falhar na inicialização
 *
 * @description
 * Fase 1: Configuração e Identidade
 * Fase 2: NERV (Event Bus)
 * Fase 3: Browser Pool Manager
 * Fase 4: KERNEL (Núcleo de decisão)
 * Fase 5: Adapters (Driver + Server)
 * Fase 6: Server Web
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
        if (!identity || !identity.robot_id) {
            log('FATAL', '[BOOT] identityManager retornou identidade inválida');
            process.exit(1);
        }
        log('INFO', `[BOOT] Identidade estabelecida: ${identity.robot_id}`);

        // Garbage collection inicial (se disponível)
        if (global.gc) {
            global.gc();
            log('DEBUG', '[BOOT] GC inicial executado');
        }

        // ===== FASE 2: NERV (IPC 3.0 - CANAL ÚNICO) =====
        log('INFO', '[BOOT] Fase 2/6: Inicializando NERV (canal de transporte)');

        const nerv = await createNERV({
            mode: CONNECTION_MODES.HYBRID, // local EventEmitter + Socket.io adapter
            correlation: true, // Event sourcing
            bufferSize: process.env.NERV_BUFFER_SIZE || CONFIG.NERV_BUFFER_SIZE || 1000,
            telemetry: process.env.NERV_TELEMETRY !== 'false' && CONFIG.NERV_TELEMETRY !== false
        });

        log('INFO', '[BOOT] ✅ NERV online (híbrido: local + remoto)');

        // Injeta NERV nos módulos ONDA 2
        forensics.setNERV(nerv);
        const { setNERV: setInfraPolicyNERV } = require('./core/infra_failure_policy');
        setInfraPolicyNERV(nerv); // Injeta NERV no módulo (função, não método)
        // Nota: não instanciamos InfraFailurePolicy aqui (evita side-effects desnecessários)
        log('DEBUG', '[BOOT] NERV injetado em forensics e infra_failure_policy');

        // NERV-based server discovery (non-blocking): escuta evento SERVER_READY
        let discoveredServerInfo = null;
        try {
            const discoveryTimeoutMs = Number(process.env.SERVER_DISCOVERY_TIMEOUT ?? 5000);

            const unsub = typeof nerv.onEvent === 'function'
                ? nerv.onEvent(envelope => {
                      try {
                          if (!envelope || !envelope.type || envelope.type.action_code !== ActionCode.SERVER_READY) return;
                          if (envelope.identity && envelope.identity.actor !== ActorRole.SERVER) return;
                          discoveredServerInfo = envelope.payload || null;
                          log('INFO', `[BOOT] Descoberto servidor via NERV: ${JSON.stringify(discoveredServerInfo)}`);
                          if (typeof unsub === 'function') unsub();
                      } catch (e) {
                          /* ignore */
                      }
                  })
                : null;

            if (discoveryTimeoutMs > 0) {
                setTimeout(() => {
                    try {
                        if (typeof unsub === 'function') unsub();
                    } catch (e) {
                        /* noop */
                    }
                }, discoveryTimeoutMs);
            }
        } catch (err) {
            log('DEBUG', `[BOOT] Falha ao registrar discovery NERV: ${err.message}`);
        }

        // ===== FASE 3: BROWSER POOL (COM RESILIÊNCIA) =====
        log('INFO', '[BOOT] Fase 3/6: Inicializando Browser Pool (modo resiliente)');

        const { initializeBrowserPoolResilient, resolveChromeEndpoint } = require('./core/boot_resilience_manager');
        const chromeEndpoint = resolveChromeEndpoint();
        log('INFO', `[BOOT] Chrome endpoint resolvido: ${chromeEndpoint}`);
        if (!chromeEndpoint) {
            log('FATAL', '[BOOT] Chrome endpoint não resolvido');
            process.exit(1);
        }

        const browserPoolResult = await initializeBrowserPoolResilient(
            {
                poolSize: process.env.BROWSER_POOL_SIZE || CONFIG.BROWSER_POOL_SIZE || 3,
                allocationStrategy: process.env.ALLOCATION_STRATEGY || CONFIG.ALLOCATION_STRATEGY || 'round-robin',
                healthCheckInterval: process.env.HEALTH_CHECK_INTERVAL || CONFIG.HEALTH_CHECK_INTERVAL || 30000,
                browserEndpoint: {
                    /**
                     * Endpoint HTTP do Chrome externo já em execução.
                     * Este processo NÃO inicia browsers e NÃO gerencia ciclo de vida.
                     */
                    url: chromeEndpoint,

                    /**
                     * Endpoint WebSocket do DevTools Protocol (opcional).
                     */
                    wsEndpoint: process.env.CHROME_WS_ENDPOINT || CONFIG.WS_ENDPOINT
                }
            },
            {
                allowDegradedMode: process.env.ALLOW_DEGRADED_MODE !== 'false',
                autoRetry: process.env.AUTO_RETRY_CHROME !== 'false',
                maxAutoRetries: Number.parseInt(process.env.MAX_AUTO_RETRIES ?? '2', 10)
            }
        );

        // Valida resultado
        if (!browserPoolResult || typeof browserPoolResult !== 'object') {
            log('FATAL', '[BOOT] initializeBrowserPoolResilient retornou shape inválido');
            process.exit(1);
        }

        if (!browserPoolResult.success) {
            log('FATAL', '[BOOT] Browser Pool falhou e usuário optou por abortar');
            process.exit(1);
        }

        const browserPool = browserPoolResult.browserPool; // Pode ser null em modo degradado
        const systemMode = browserPoolResult.mode || 'unknown'; // 'full' ou 'degraded'

        if (systemMode === 'degraded') {
            log('WARN', '[BOOT] ⚠️  Sistema iniciando em MODO DEGRADADO (sem Browser Pool)');
            log('WARN', '[BOOT] Funcionalidades limitadas até Chrome ser configurado');
        }

        // ===== FASE 3.5: CONTEXT MANAGER (COMPARTILHADO) =====
        log('INFO', '[BOOT] Fase 3.5/6: Inicializando ContextManager compartilhado');

        const { ContextManager } = require('./orchestrator/context_manager');
        const contextManager = new ContextManager({
            strategy: process.env.CONTEXT_STRATEGY || CONFIG.CONTEXT_STRATEGY || 'sliding_window',
            maxTokens: process.env.CONTEXT_MAX_TOKENS || CONFIG.CONTEXT_MAX_TOKENS || 100000,
            summarizationPolicy: process.env.SUMMARIZATION_POLICY || CONFIG.SUMMARIZATION_POLICY || 'on_overflow'
        });
        log('INFO', '[BOOT] ✅ ContextManager online (será compartilhado por Kernel e MissionManager)');

        // ===== FASE 4: KERNEL (DECISOR SOBERANO) =====
        log('INFO', '[BOOT] Fase 4/6: Inicializando KERNEL');

        const kernel = await createKernel({
            nerv, // Passa NERV diretamente
            contextManager, // V2.0: Injeta ContextManager compartilhado
            telemetry: {
                source: ActorRole.KERNEL.toLowerCase(),
                retention: 1000
            },
            policy: {},
            loop: {
                cycleInterval: process.env.KERNEL_CYCLE_INTERVAL || CONFIG.KERNEL_CYCLE_INTERVAL || 50 // 50ms = 20 Hz
            }
        });

        if (!kernel || typeof kernel.executeTask !== 'function') {
            log('FATAL', '[BOOT] Kernel inválido após criação');
            process.exit(1);
        }

        log('INFO', '[BOOT] ✅ KERNEL online (loop 20 Hz, com ContextManager compartilhado)');

        // ======================================================================
        // ===== FASE 5: ADAPTERS (PONTES NERV) — SERVER MODE SEM IPC =========
        // ======================================================================
        log('INFO', '[BOOT] Fase 5/6: Inicializando Adapters');

        // ----------------------------------------------------------------------
        // DRIVER ADAPTER (sempre local ao Maestro)
        // ----------------------------------------------------------------------
        // Em modo degradado (browserPool = null), DriverAdapter não executa tasks
        const driverAdapter = new DriverNERVAdapter(nerv, browserPool, CONFIG);

        if (systemMode === 'degraded') {
            log('WARN', '[BOOT] ⚠️ DriverAdapter em modo degradado (browserPool = null)');
            log('WARN', '[BOOT] Tasks dependentes de browser permanecem desativadas');
        } else {
            log('INFO', '[BOOT] ✅ DriverNERVAdapter online');
        }

        // ======================================================================
        // SERVER MODE — DECISÃO DETERMINÍSTICA (SEM IPC / SEM DISCOVERY FILE)
        // ======================================================================
        // Modos suportados:
        //
        //   integrated → Maestro sobe HTTP server local
        //   split      → Maestro NÃO sobe HTTP — conecta em server externo
        //   disabled   → Maestro não usa camada server/socket
        //
        // Fonte única:
        //   process.env.SERVER_MODE ou CONFIG.SERVER_MODE
        // ----------------------------------------------------------------------

        // Fonte única canônica — resolver validado (enum fechado)
        const SERVER_MODE = resolveServerMode();

        log('INFO', `[BOOT] Server mode (determinístico): ${SERVER_MODE}`);

        const serverEngine = require('./server/engine/server');
        const socketModule = require('./server/engine/socket');

        let socketHub = null;
        let serverAdapter = null;
        let boundPort = undefined;
        let httpServer = undefined;
        let httpAuthority = false;

        // ----------------------------------------------------------------------
        // SPLIT MODE — conecta em server externo já conhecido
        // ----------------------------------------------------------------------
        if (SERVER_MODE === 'split') {
            const externalPortRaw = process.env.SERVER_PORT ?? CONFIG.SERVER_PORT ?? (discoveredServerInfo && (discoveredServerInfo.server_port || discoveredServerInfo.port)) ?? 3008;
            const externalPort = Number.parseInt(String(externalPortRaw), 10);

            if (!Number.isInteger(externalPort) || externalPort < 1 || externalPort > 65535) {
                log('FATAL', `[BOOT] SERVER_PORT inválido para modo split: ${externalPortRaw}`);
                process.exit(1);
            }

            log('INFO', `[BOOT] Conectando a server externo (porta=${externalPort})`);

            if (typeof socketModule.connectExternal !== 'function') {
                log('FATAL', '[BOOT] socket.connectExternal não disponível em modo split');
                process.exit(1);
            }

            try {
                socketHub = await Promise.resolve(socketModule.connectExternal(externalPort));
            } catch (err) {
                log('FATAL', `[BOOT] Falha ao conectar a servidor externo: ${err.message}`);
                process.exit(1);
            }

            if (!socketHub || typeof socketHub.on !== 'function' || typeof socketHub.emit !== 'function') {
                log('FATAL', '[BOOT] socketHub inválido retornado por connectExternal');
                process.exit(1);
            }

            // fallback para sendToClient quando ausente
            let socketHubWrapper = socketHub;
            if (typeof socketHub.sendToClient !== 'function') {
                socketHubWrapper = Object.create(socketHub);
                socketHubWrapper.sendToClient = (clientId, event, payload) => {
                    try {
                        const io = typeof socketModule.getIO === 'function' ? socketModule.getIO() : null;
                        if (io) {
                            io.to(clientId).emit(event, payload);
                            return true;
                        }
                    } catch (e) {
                        /* fallback */
                    }
                    if (typeof socketHub.emit === 'function') {
                        socketHub.emit(event, payload);
                        return true;
                    }
                    return false;
                };
                log('WARN', '[BOOT] sendToClient não disponível — usando fallback baseado em emit');
            }
            // assegura que o contexto exporte o wrapper com sendToClient
            socketHub = socketHubWrapper;

            const ServerNERVAdapter = require('./server/nerv_adapter/server_nerv_adapter');
            serverAdapter = new ServerNERVAdapter(nerv, socketHub, CONFIG);
            httpAuthority = false;
        }

        // ----------------------------------------------------------------------
        // INTEGRATED MODE — Maestro sobe server local
        // ----------------------------------------------------------------------
        else if (SERVER_MODE === 'integrated') {
            const serverPort = process.env.PORT || CONFIG.SERVER_PORT || 3008;

            const instance = await serverEngine.start(serverPort);

            if (!instance || typeof instance !== 'object' || !instance.server || !instance.port) {
                log('FATAL', '[BOOT] serverEngine.start retornou shape inválido');
                process.exit(1);
            }

            httpServer = instance.server;
            boundPort = Number.parseInt(instance.port, 10);

            socketHub = socketModule.init(httpServer);

            // Validação básica do socket hub
            if (!socketHub || typeof socketHub.on !== 'function' || typeof socketHub.emit !== 'function') {
                log('FATAL', '[BOOT] socketHub inválido após init');
                process.exit(1);
            }

            // Fornece wrapper fallback para "sendToClient" caso o hub não exponha a função
            let socketHubWrapper = socketHub;
            if (typeof socketHub.sendToClient !== 'function') {
                socketHubWrapper = Object.create(socketHub);
                socketHubWrapper.sendToClient = (clientId, event, payload) => {
                    try {
                        const io = typeof socketModule.getIO === 'function' ? socketModule.getIO() : null;
                        if (io) {
                            io.to(clientId).emit(event, payload);
                            return true;
                        }
                    } catch (e) {
                        /* fallback */
                    }
                    if (typeof socketHub.emit === 'function') {
                        socketHub.emit(event, payload);
                        return true;
                    }
                    return false;
                };
                log('WARN', '[BOOT] sendToClient não disponível — usando fallback baseado em emit');
            }
            // assegura que o contexto exporte o wrapper com sendToClient
            socketHub = socketHubWrapper;

            const ServerNERVAdapter = require('./server/nerv_adapter/server_nerv_adapter');
            serverAdapter = new ServerNERVAdapter(nerv, socketHub, CONFIG);
            httpAuthority = true;

            // Normalize boundPort
            boundPort = Number.parseInt(instance.port, 10);
            if (!Number.isInteger(boundPort) || boundPort < 1 || boundPort > 65535) {
                log('WARN', `[BOOT] boundPort inválida: ${instance.port}`);
                boundPort = null;
            }

            log('INFO', `[BOOT] Server integrado iniciado (porta=${boundPort ?? 'n/a'})`);
        }

        // ----------------------------------------------------------------------
        // DISABLED MODE — sem camada server
        // ----------------------------------------------------------------------
        else if (SERVER_MODE === 'disabled') {
            log('WARN', '[BOOT] SERVER_MODE=disabled — camada server desativada');
            serverAdapter = null;
            socketHub = null;
            httpAuthority = false;
        }

        // ----------------------------------------------------------------------
        // MODO INVÁLIDO — aborta
        // ----------------------------------------------------------------------
        else {
            log('FATAL', `[BOOT] SERVER_MODE inválido: ${SERVER_MODE}`);
            process.exit(1);
        }

        if (serverAdapter) {
            log('INFO', '[BOOT] ✅ ServerNERVAdapter online');
        }

        // ======================================================================
        // ===== FASE 5.5: MISSION ORCHESTRATION ===============================
        // ======================================================================

        log('INFO', '[BOOT] Fase 5.5/6: Inicializando Mission Orchestration Layer');

        // ----------------------------------------------------------------------
        // FeedbackProcessor — usa ContextManager compartilhado
        // ----------------------------------------------------------------------
        const { FeedbackProcessor } = require('./missions/feedback_processor');

        const feedbackProcessor = new FeedbackProcessor({
            contextManager
        });

        log('DEBUG', '[BOOT] FeedbackProcessor criado');

        // ----------------------------------------------------------------------
        // CheckpointManager
        // ----------------------------------------------------------------------
        const { CheckpointManager } = require('./orchestrator/checkpoint_manager');

        const checkpointManager = new CheckpointManager({
            baseDir: process.env.MISSIONS_DIR || CONFIG.MISSIONS_DIR || 'missions',
            keepLast: process.env.CHECKPOINT_KEEP_LAST || CONFIG.CHECKPOINT_KEEP_LAST || 10,
            autoCleanup: true
        });

        log('DEBUG', '[BOOT] CheckpointManager criado');

        // ----------------------------------------------------------------------
        // MissionManager
        // ----------------------------------------------------------------------
        const missionManager = new MissionManager({
            kernel,
            nerv,
            contextManager,
            feedbackProcessor,
            checkpointManager
        });

        try {
            await missionManager.initialize();
        } catch (err) {
            log('FATAL', `[BOOT] MissionManager.initialize falhou: ${err.message}`);
            process.exit(1);
        }

        if (!missionManager || typeof missionManager.executeMission !== 'function') {
            log('FATAL', '[BOOT] MissionManager inválido após inicialização');
            process.exit(1);
        }

        log('INFO', '[BOOT] ✅ MissionManager online');

        // ----------------------------------------------------------------------
        // REST Controller injection — somente se server ativo
        // ----------------------------------------------------------------------
        if (serverAdapter) {
            const missionsController = require('./server/api/controllers/missions');
            missionsController.setMissionManager(missionManager);
            log('DEBUG', '[BOOT] MissionManager injetado no controller REST');
        }

        // ===== FASE 6: FINALIZAÇÃO =====

        const bootDuration = Date.now() - bootStartTime;

        log('INFO', `[BOOT] Fase 6/6 concluída em ${bootDuration}ms`);
        log('INFO', `[BOOT] Topologia server: ${SERVER_MODE} (authority=${httpAuthority})`);

        if (systemMode === 'degraded') {
            log('WARN', '[BOOT] Sistema online em MODO DEGRADADO (Browser Pool indisponível)');
            log('WARN', '[BOOT] Funcionalidades dependentes de browser permanecem desativadas');
        } else {
            log('INFO', '[BOOT] Todos os subsistemas operacionais');
        }

        log('INFO', '[BOOT] Sistema pronto. Aguardando comandos via NERV.');

        /**
         * Contexto canônico de runtime — contrato estrutural do processo.
         *
         * Regras:
         *   - Campos podem ser null, nunca undefined (shape estável)
         *   - httpAuthority indica se este processo é dono do bind
         *   - serverMode é a topologia efetiva
         *   - shutdown NÃO deve redescobrir nada via filesystem
         */
        return {
            // -------- CORE --------
            nerv,
            kernel,
            identity,

            // -------- EXECUTION --------
            browserPool: browserPool ?? null,
            systemMode: systemMode ?? 'unknown',

            // -------- ADAPTERS --------
            driverAdapter: driverAdapter ?? null,
            serverAdapter: serverAdapter ?? null,

            // -------- MISSION LAYER --------
            missionManager: missionManager ?? null,

            // -------- SERVER LAYER --------
            serverMode: SERVER_MODE,
            socketHub: socketHub ?? null,
            httpServer: httpServer ?? null,
            httpAuthority: Boolean(httpAuthority),
            httpPort: boundPort ?? null,

            // -------- METRICS --------
            bootDuration
        };
    } catch (error) {
        log('FATAL', `[BOOT] Falha catastrófica durante boot: ${error.message}`);
        log('ERROR', `[BOOT] Stack trace: ${error.stack}`);

        try {
            if (typeof forensics?.createCrashDump === 'function') {
                forensics.createCrashDump(null, error, 'sys-boot', 'boot-failure');
            }
        } catch (dumpErr) {
            log('ERROR', `[BOOT] Falha ao gerar crash dump: ${dumpErr.message}`);
        }

        process.exit(1);
    }
}

/* ==========================================================================
   GRACEFUL SHUTDOWN — CANONICAL (NERV-CENTRIC, NO IPC, TOPOLOGY-SAFE)
========================================================================== */

async function shutdown(context) {
    log('WARN', '[SHUTDOWN] Iniciando shutdown gracioso coordenado...');

    const shutdownStartTime = Date.now();
    const phases = [];
    let failedPhases = 0;

    const { serverAdapter, driverAdapter, missionManager, kernel, browserPool, nerv, httpServer, httpAuthority } =
        context || {};

    const shutdownPhases = [
        /* -----------------------------------------------------------
           SERVER ADAPTER — ponte NERV/socket
        ----------------------------------------------------------- */
        {
            name: 'ServerAdapter',
            fn: async () => {
                if (serverAdapter && typeof serverAdapter.shutdown === 'function') {
                    await serverAdapter.shutdown();
                }

                // auxiliares — best effort
                try {
                    const reconciler = require('./server/supervisor/reconcilier');
                    if (typeof reconciler?.stop === 'function') {
                        reconciler.stop();
                    }
                } catch (e) {
                    log('WARN', `[SHUTDOWN] reconciler.stop falhou: ${e.message}`);
                }

                try {
                    const hardwareTelemetry = require('./server/realtime/telemetry/hardware');
                    if (typeof hardwareTelemetry?.stop === 'function') {
                        hardwareTelemetry.stop();
                    }
                } catch (e) {
                    log('WARN', `[SHUTDOWN] hardwareTelemetry.stop falhou: ${e.message}`);
                }
            }
        },

        /* -----------------------------------------------------------
           HTTP SERVER — somente se este processo for autoridade
        ----------------------------------------------------------- */
        {
            name: 'HTTPServer',
            fn: async () => {
                if (!httpAuthority) {
                    log('DEBUG', '[SHUTDOWN] HTTPServer skip — não é autoridade HTTP');
                    return;
                }

                if (httpServer && typeof httpServer.close === 'function') {
                    await new Promise(resolve => {
                        httpServer.close(() => resolve());
                    });
                    log('INFO', '[SHUTDOWN] HTTP server fechado');
                }
            }
        },

        /* -----------------------------------------------------------
           DRIVER
        ----------------------------------------------------------- */
        {
            name: 'DriverAdapter',
            fn: async () => {
                if (driverAdapter && typeof driverAdapter.shutdown === 'function') {
                    await driverAdapter.shutdown();
                }
            }
        },

        /* -----------------------------------------------------------
           MISSION MANAGER
        ----------------------------------------------------------- */
        {
            name: 'MissionManager',
            fn: async () => {
                if (missionManager && typeof missionManager.cleanup === 'function') {
                    missionManager.cleanup();
                }
            }
        },

        /* -----------------------------------------------------------
           KERNEL
        ----------------------------------------------------------- */
        {
            name: 'KERNEL',
            fn: async () => {
                if (kernel && typeof kernel.shutdown === 'function') {
                    await kernel.shutdown();
                }
            }
        },

        /* -----------------------------------------------------------
           BROWSER POOL — pode ser null
        ----------------------------------------------------------- */
        {
            name: 'BrowserPool',
            fn: async () => {
                if (browserPool && typeof browserPool.shutdown === 'function') {
                    await browserPool.shutdown();
                }
            }
        },

        /* -----------------------------------------------------------
           NERV — último subsistema ativo
        ----------------------------------------------------------- */
        {
            name: 'NERV',
            fn: async () => {
                if (nerv && typeof nerv.shutdown === 'function') {
                    await nerv.shutdown();
                }
            }
        },

        /* -----------------------------------------------------------
           TEMP PROFILES — limpeza final
        ----------------------------------------------------------- */
        {
            name: 'TempProfiles',
            fn: async () => {
                const cleaned = await ConnectionOrchestrator.cleanupTempProfiles();
                if (cleaned > 0) {
                    log('INFO', `[SHUTDOWN] Removidos ${cleaned} profiles temporários`);
                }
            }
        }
    ];

    const total = shutdownPhases.length;

    for (let i = 0; i < shutdownPhases.length; i++) {
        const phase = shutdownPhases[i];
        const phaseStartTime = Date.now();

        try {
            log('INFO', `[SHUTDOWN] ${i + 1}/${total}: Encerrando ${phase.name}...`);
            await phase.fn();

            const duration = Date.now() - phaseStartTime;

            phases.push({
                name: phase.name,
                status: STATUS_VALUES.SUCCESS,
                duration
            });

            log('DEBUG', `[SHUTDOWN] ${phase.name} concluído em ${duration}ms`);
        } catch (error) {
            const duration = Date.now() - phaseStartTime;
            failedPhases++;

            phases.push({
                name: phase.name,
                status: STATUS_VALUES.FAILED,
                duration,
                error: error.message
            });

            log('ERROR', `[SHUTDOWN] Falha em ${phase.name}: ${error.message}`);
        }
    }

    const shutdownDuration = Date.now() - shutdownStartTime;
    const successCount = phases.filter(p => p.status === STATUS_VALUES.SUCCESS).length;

    if (failedPhases === 0) {
        log('INFO', `[SHUTDOWN] ✅ Shutdown completo: ${successCount}/${total} fases OK em ${shutdownDuration}ms`);
        process.exit(0);
    }

    log(
        'WARN',
        `[SHUTDOWN] ⚠️ Shutdown parcial: ${successCount}/${total} OK, ${failedPhases} falhas em ${shutdownDuration}ms`
    );

    phases
        .filter(p => p.status === STATUS_VALUES.FAILED)
        .forEach(p => {
            log('ERROR', `   ❌ ${p.name}: ${p.error}`);
        });

    process.exit(1);
}

/* ==========================================================================
   SIGNAL HANDLERS — CANONICAL (SINGLE SHUTDOWN PATH)
========================================================================== */

/**
 * Exclusão mútua global para prevenir shutdown concorrente.
 */
let _shutdownInProgress = false;

/**
 * Configura handlers de sinais e falhas fatais.
 * Shutdown sempre passa pelo coordenador único.
 */
function setupSignalHandlers(context) {
    const triggerShutdown = async (reason, meta = {}) => {
        if (_shutdownInProgress) {
            log('WARN', `[SIGNAL] ${reason} ignorado — shutdown já em andamento`);
            return;
        }

        _shutdownInProgress = true;

        log(
            'WARN',
            `[SIGNAL] Shutdown disparado (${reason}) — serverMode=${context?.serverMode ?? 'n/a'} httpAuthority=${context?.httpAuthority ?? false} port=${context?.httpPort ?? 'n/a'}`
        );

        // forensics best-effort (não pode falhar)
        try {
            if (typeof forensics?.createCrashDump === 'function' && meta.error) {
                forensics.createCrashDump(null, meta.error, 'sys-signal', reason);
            }
        } catch (e) {
            log('ERROR', `[SIGNAL] forensics falhou: ${e.message}`);
        }

        try {
            await shutdown(context);
        } catch (err) {
            log('FATAL', `[SIGNAL] Falha durante shutdown: ${err.message}`);
            process.exit(1);
        }
    };

    /* -----------------------------------------------------------
       Sinais de término operacional
    ----------------------------------------------------------- */

    process.on('SIGTERM', () => triggerShutdown('SIGTERM'));
    process.on('SIGINT', () => triggerShutdown('SIGINT'));

    /* -----------------------------------------------------------
       Reload de configuração (não encerra)
    ----------------------------------------------------------- */

    process.on('SIGHUP', async () => {
        if (_shutdownInProgress) {
            log('WARN', '[SIGNAL] SIGHUP ignorado — shutdown em andamento');
            return;
        }

        try {
            log('INFO', '[SIGNAL] SIGHUP — reload de configuração');
            await CONFIG.reload('sys-sighup');
            log('INFO', '[SIGNAL] Configuração recarregada');
        } catch (err) {
            log('ERROR', `[SIGNAL] Reload falhou: ${err.message}`);
        }
    });

    /* -----------------------------------------------------------
       Falhas fatais — crash path coordenado
    ----------------------------------------------------------- */

    process.on('uncaughtException', error => {
        log('FATAL', `[CRASH] Uncaught Exception: ${error.message}`);
        log('ERROR', `[CRASH] Stack: ${error.stack}`);

        triggerShutdown('uncaught-exception', { error });
    });

    process.on('unhandledRejection', (reason, promise) => {
        log('FATAL', `[CRASH] Unhandled Rejection: ${reason}`);
        log('ERROR', `[CRASH] Promise: ${promise}`);

        const error = reason instanceof Error ? reason : new Error(String(reason));

        triggerShutdown('unhandled-rejection', { error });
    });
}

/* ==========================================================================
   MAIN ENTRY POINT — CANONICAL
========================================================================== */

/**
 * Entry point soberano do processo.
 *
 * Responsabilidades:
 *   ✔ imprime banner
 *   ✔ executa boot completo
 *   ✔ valida invariantes
 *   ✔ instala signal handlers
 *   ✔ declara modo operacional
 */
async function main() {
    try {
        console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║   MAESTRO SINGULARITY EDITION                                 ║
║   Autonomous AI Agent - Universal LLM Orchestrator            ║
║   Version: 2.0.0 (NERV Architecture)                          ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
        `);

        const context = await boot();

        if (!context || !context.nerv || !context.kernel) {
            throw new Error('Boot retornou contexto inválido');
        }

        setupSignalHandlers(context);

        log(
            'INFO',
            `[MAIN] Sistema operacional | mode=${context.systemMode} | httpAuthority=${context.httpAuthority ?? false} | port=${context.httpPort ?? 'n/a'}`
        );

        log('INFO', '[MAIN] Ctrl+C para shutdown gracioso.');
    } catch (error) {
        log('FATAL', `[MAIN] Falha fatal no entrypoint: ${error.message}`);
        log('ERROR', `[MAIN] Stack: ${error.stack}`);

        try {
            if (typeof forensics?.createCrashDump === 'function') {
                forensics.createCrashDump(null, error, 'sys-main', 'entrypoint-failure');
            }
        } catch (e) {
            log('ERROR', `[MAIN] forensics falhou: ${e.message}`);
        }

        process.exit(1);
    }
}

/* ==========================================================================
   EXECUÇÃO CONDICIONAL
========================================================================== */

if (require.main === module) {
    main();
}

module.exports = {
    boot,
    shutdown,
    main
};
