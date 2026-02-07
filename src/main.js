// @ts-check - Type checking rigoroso habilitado (arquivo core)
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
await import('./infra/browser_pool/puppeteer_guard.js');
import { log } from './core/logger.js';
import { ActorRole, ActionCode, MessageType } from './shared/nerv/constants.js';
import { CONNECTION_MODES } from './core/constants/browser.js';
import { STATUS_VALUES } from './core/constants/tasks.js';
import CONFIG from './core/config.js';
import identityManager from './core/identity_manager.js';
import { createNERV } from './nerv/nerv.js';
import { createKernel } from './kernel/kernel.js';
import { ConnectionOrchestrator } from './infra/ConnectionOrchestrator.js';
import { MissionManager } from './missions/mission_manager.js';
import * as forensics from './core/forensics.js';
import * as DriverNERVAdapter from './driver/nerv_adapter/driver_nerv_adapter.js';
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
 * Verifica se uma porta está em uso.
 * Retorna true se porta ocupada, false se disponível.
 *
 * @param {number} port - Porta a verificar
 * @returns {Promise<boolean>}
 */
async function checkPortInUse(port) {
    const net = await import('node:net').then(m => m.default ?? m);

    return new Promise(resolve => {
        const server = net.createServer();

        server.once('error', err => {
            if (err.code === 'EADDRINUSE') {
                resolve(true); // Porta em uso
            } else {
                resolve(false);
            }
        });

        server.once('listening', () => {
            server.close();
            resolve(false); // Porta disponível
        });

        server.listen(port, '0.0.0.0');
    });
}

/**
 * Resolve autoridade do processo (standalone|delegated).
 *
 * Precedência:
 *  1) argumento CLI `--authority=...` ou `--server-authority=...`
 *  2) variável de ambiente `SERVER_AUTHORITY`
 *  3) fallback: `standalone`
 */
function resolveAuthority() {
    const ALLOWED = ['standalone', 'delegated'];

    // CLI override (ex: --authority=delegated)
    const arg = process.argv.slice(2).find(a => a.startsWith('--authority=') || a.startsWith('--server-authority='));
    const rawFromArg = arg ? arg.split('=')[1] : undefined;

    const raw = rawFromArg ?? process.env.SERVER_AUTHORITY ?? 'standalone';
    const authority = String(raw).toLowerCase().trim();

    if (!ALLOWED.includes(authority)) {
        log('FATAL', `[CONFIG] SERVER_AUTHORITY inválido: "${raw}"`);
        log('FATAL', `[CONFIG] Valores válidos: ${ALLOWED.join(', ')}`);
        process.exit(1);
    }

    log('INFO', `[CONFIG] SERVER_AUTHORITY resolvido: ${authority}`);
    return authority;
}

// Resolve autoridade do processo (invoca validação e logging)
resolveAuthority();

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

        // ===== VALIDAÇÃO: CONFLITO PM2 + SERVER_MODE =====
        // Detecta se processo está rodando sob PM2 E modo é integrated
        // → Conflito: PM2 gerencia processos separados, mas integrated tenta iniciar server inline
        // → Resultado: 2 servidores HTTP competindo pela mesma porta (EADDRINUSE)
        const SERVER_MODE = resolveServerMode();
        const runningUnderPM2 = Boolean(process.env.pm_id || process.env.PM2_HOME);

        if (runningUnderPM2 && SERVER_MODE === SERVER_MODES.INTEGRATED) {
            log('FATAL', '');
            log('FATAL', '❌ ═════════════════════════════════════════════════════════════');
            log('FATAL', '❌ CONFLITO DETECTADO: PM2 + SERVER_MODE=integrated');
            log('FATAL', '❌ ═════════════════════════════════════════════════════════════');
            log('FATAL', '');
            log('FATAL', '  PM2 está gerenciando processos separados (agente-gpt, dashboard-web)');
            log('FATAL', '  Mas SERVER_MODE=integrated tenta iniciar servidor HTTP inline');
            log('FATAL', '');
            log('FATAL', '  ⚠️  RESULTADO: 2 servidores competem pela porta 3008 → EADDRINUSE crash');
            log('FATAL', '');
            log('FATAL', '✅ SOLUÇÕES:');
            log('FATAL', '');
            log('FATAL', '   1. Usar PM2 corretamente (RECOMENDADO):');
            log('FATAL', '      export SERVER_MODE=split');
            log('FATAL', '      pm2 restart ecosystem.config.js');
            log('FATAL', '');
            log('FATAL', '   2. OU rodar standalone (sem PM2):');
            log('FATAL', '      pm2 delete all');
            log('FATAL', '      export SERVER_MODE=integrated');
            log('FATAL', '      node index.js');
            log('FATAL', '');
            log('FATAL', '═════════════════════════════════════════════════════════════════');
            process.exit(1);
        }

        if (runningUnderPM2 && SERVER_MODE === SERVER_MODES.SPLIT) {
            log('INFO', '[BOOT] ✅ Configuração válida: PM2 + SERVER_MODE=split');
        } else if (!runningUnderPM2 && SERVER_MODE === SERVER_MODES.INTEGRATED) {
            log('INFO', '[BOOT] ✅ Configuração válida: Standalone + SERVER_MODE=integrated');
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
        const { setNERV: setInfraPolicyNERV } = await import('./core/infra_failure_policy.js');
        setInfraPolicyNERV(nerv); // Injeta NERV no módulo (função, não método)
        // Nota: não instanciamos InfraFailurePolicy aqui (evita side-effects desnecessários)
        log('DEBUG', '[BOOT] NERV injetado em forensics e infra_failure_policy');

        // ===== FASE 2.5: CHROME PROXY SERVICE (NOVO - Bug #1 e #4) =====
        let chromeProxy = null;
        if (CONFIG.CHROME_PROXY_ENABLED !== false) {
            log('INFO', '[BOOT] Fase 2.5/6: Inicializando Chrome Proxy Service');

            try {
                const ChromeProxyService = await import('./infra/proxy/chromeProxyService.js').then(m => m.default ?? m);
                const { sendEvent } = await import('#nerv/adapters/high_level_adapter');
                const { ActionCode, ActorRole } = await import('#shared/nerv/constants');

                // ===== VALIDAÇÃO: PROXY DUPLICADO =====
                // Verifica se porta do proxy já está em uso (PM2 pode ter iniciado processo separado)
                const proxyPort = CONFIG.CHROME_PROXY_PORT || 9224;
                const proxyAlreadyRunning = await checkPortInUse(proxyPort);

                if (proxyAlreadyRunning) {
                    log('INFO', `[BOOT] ✅ Chrome Proxy já rodando externamente (porta ${proxyPort})`);
                    log('INFO', '[BOOT] Assumindo proxy gerenciado por PM2 ou processo separado');
                    log('INFO', '[BOOT] Pulando criação inline para evitar conflito EADDRINUSE');
                    chromeProxy = null; // Não cria proxy duplicado
                } else {
                    log('INFO', `[BOOT] Iniciando Chrome Proxy inline (porta ${proxyPort})`);

                    chromeProxy = new ChromeProxyService({
                        PUBLIC_IP: CONFIG.CHROME_PROXY_HOST,
                        CHROME_HOST: CONFIG.CHROME_HOST,
                        CHROME_PORT: CONFIG.CHROME_PORT,
                        PROXY_PORT: proxyPort,
                        PROXY_BIND: CONFIG.CHROME_PROXY_BIND,
                        LOG_LEVEL: CONFIG.LOG_LEVEL || 'INFO'
                    });

                    // Injeta NERV no proxy para telemetria
                    chromeProxy.setNERV(nerv);

                    // Inicia proxy
                    await chromeProxy.start();

                    // Armazena globalmente para shutdown
                    global.chromeProxy = chromeProxy;

                    log('INFO', `[BOOT] ✅ Chrome Proxy Service online (porta ${proxyPort})`);

                    // ✅ Emite evento NERV: Proxy iniciado
                    sendEvent(
                        nerv,
                        ActorRole.INFRA,
                        ActionCode.INFRA_READY,
                        {
                            component: 'ChromeProxyService',
                            port: proxyPort,
                            host: CONFIG.CHROME_PROXY_HOST,
                            timestamp: Date.now(),
                            mode: 'inline'
                        },
                        null, // correlationId
                        null // target (broadcast)
                    );
                }
            } catch (error) {
                log('ERROR', `[BOOT] ❌ Falha ao iniciar Chrome Proxy Service: ${error.message}`);
                log('ERROR', '[BOOT]');
                log('ERROR', '[BOOT] TROUBLESHOOTING:');
                log('ERROR', '[BOOT] 1. Verifique se porta está disponível:');
                log('ERROR', `[BOOT]    lsof -i :${CONFIG.CHROME_PROXY_PORT}`);
                log('ERROR', '[BOOT] 2. Verifique se Chrome está rodando:');
                log('ERROR', `[BOOT]    curl http://localhost:${CONFIG.CHROME_PORT || 9225}/json/version`);
                log('ERROR', '[BOOT]');
                throw error; // Falha crítica - aborta boot
            }
        } else {
            log('WARN', '[BOOT] ⚠️  Chrome Proxy Service desabilitado (CONFIG.CHROME_PROXY_ENABLED=false)');
            log('WARN', '[BOOT] ⚠️  Conexões diretas ao Chrome podem falhar em ambientes containerizados');
        }

        // NERV-based server discovery (non-blocking): escuta evento SERVER_READY
        let discoveredServerInfo = null;
        try {
            // Timeout aumentado de 5s → 30s (server boot pode ser lento em cold start)
            const discoveryTimeoutMs = Number(process.env.SERVER_DISCOVERY_TIMEOUT ?? 30000);

            const unsub =
                typeof nerv.onEvent === 'function'
                    ? nerv.onEvent(envelope => {
                          try {
                              if (!envelope || !envelope.type || envelope.type.action_code !== ActionCode.SERVER_READY)
                                  return;
                              if (envelope.identity && envelope.identity.actor !== ActorRole.SERVER) return;
                              discoveredServerInfo = envelope.payload || null;
                              log(
                                  'INFO',
                                  `[BOOT] Descoberto servidor via NERV: ${JSON.stringify(discoveredServerInfo)}`
                              );
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

        const { initializeBrowserPoolResilient, getBrowserEndpoint } = await import('./core/boot_resilience_manager.js');
        const browserEndpoint = getBrowserEndpoint();
        log('INFO', `[BOOT] Chrome endpoint resolvido: ${browserEndpoint.url}`);
        if (!browserEndpoint.url) {
            log('FATAL', '[BOOT] Chrome endpoint não resolvido');
            process.exit(1);
        }

        const browserPoolResult = await initializeBrowserPoolResilient(
            {
                poolSize: process.env.BROWSER_POOL_SIZE || CONFIG.BROWSER_POOL_SIZE || 3,
                allocationStrategy: process.env.ALLOCATION_STRATEGY || CONFIG.ALLOCATION_STRATEGY || 'round-robin',
                healthCheckInterval: process.env.HEALTH_CHECK_INTERVAL || CONFIG.HEALTH_CHECK_INTERVAL || 30000,
                browserEndpoint
            },
            {
                nerv, // ✅ Injeta NERV para Circuit Breaker
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

        const { ContextManager } = await import('./orchestrator/context_manager.js');
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

        // SERVER_MODE já foi resolvido na Fase 1 (validação PM2+integrated)
        // Apenas logamos aqui para clareza
        log('INFO', `[BOOT] Server mode (determinístico): ${SERVER_MODE}`);

        const serverEngine = await import('./server/engine/server.js').then(m => m.default ?? m);
        const socketModule = await import('./server/engine/socket.js').then(m => m.default ?? m);

        let socketHub = null;
        let serverAdapter = null;
        let boundPort = undefined;
        let httpServer = undefined;
        let httpAuthority = false;

        // ----------------------------------------------------------------------
        // SPLIT MODE — conecta em server externo já conhecido
        // ----------------------------------------------------------------------
        if (SERVER_MODE === 'split') {
            const externalPortRaw =
                process.env.SERVER_PORT ??
                CONFIG.SERVER_PORT ??
                (discoveredServerInfo && (discoveredServerInfo.server_port || discoveredServerInfo.port)) ??
                3008;
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

            const ServerNERVAdapter = await import('./server/nerv_adapter/server_nerv_adapter.js').then(m => m.default ?? m);
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

            const ServerNERVAdapter = await import('./server/nerv_adapter/server_nerv_adapter.js').then(m => m.default ?? m);
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
        const { FeedbackProcessor } = await import('./missions/feedback_processor.js');

        const feedbackProcessor = new FeedbackProcessor({
            contextManager
        });

        log('DEBUG', '[BOOT] FeedbackProcessor criado');

        // ----------------------------------------------------------------------
        // CheckpointManager
        // ----------------------------------------------------------------------
        const { CheckpointManager } = await import('./orchestrator/checkpoint_manager.js');

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
            const missionsController = await import('./server/api/controllers/missions.js').then(m => m.default ?? m);
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

        // Se existir um servidor HTTP local (modo integrado), atualiza o app
        // com um objeto `runtimeReadiness` que será consumido pelo endpoint
        // `/ready` para indicar se subsistemas críticos estão disponíveis.
        try {
            if (httpServer) {
                try {
                    const serverApp = await import('./server/engine/app.js').then(m => m.default ?? m);
                    serverApp.locals = serverApp.locals || {};
                    serverApp.locals.runtimeReadiness = {
                        nerv: Boolean(nerv),
                        kernel: Boolean(kernel),
                        browserPool: systemMode === 'degraded' ? false : Boolean(browserPool),
                        serverAdapter: Boolean(serverAdapter),
                        missionManager: Boolean(missionManager)
                    };
                    // Campos minimamente exigidos para considerar o processo pronto
                    serverApp.locals.requiredReadiness = serverApp.locals.requiredReadiness || ['nerv', 'kernel'];
                    log('DEBUG', '[BOOT] runtimeReadiness definido no app HTTP');
                } catch (err) {
                    log(
                        'WARN',
                        `[BOOT] Não foi possível setar runtimeReadiness no app: ${err && err.message ? err.message : String(err)}`
                    );
                }
            }
        } catch (err) {
            // não bloqueante — apenas registra
            log('DEBUG', `[BOOT] runtimeReadiness skip: ${err && err.message ? err.message : String(err)}`);
        }

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
                    const reconciler = await import('./server/supervisor/reconcilier.js').then(m => m.default ?? m);
                    if (typeof reconciler?.stop === 'function') {
                        try {
                            await reconciler.stop();
                        } catch (err) {
                            log(
                                'WARN',
                                `[SHUTDOWN] reconciler.stop threw: ${err && err.message ? err.message : String(err)}`
                            );
                        }
                    }
                } catch (e) {
                    log('WARN', `[SHUTDOWN] reconciler.stop falhou: ${e.message}`);
                }

                try {
                    const hardwareTelemetry = await import('./server/realtime/telemetry/hardware.js').then(m => m.default ?? m);
                    if (typeof hardwareTelemetry?.stop === 'function') {
                        try {
                            await hardwareTelemetry.stop();
                        } catch (err) {
                            log(
                                'WARN',
                                `[SHUTDOWN] hardwareTelemetry.stop threw: ${err && err.message ? err.message : String(err)}`
                            );
                        }
                    }
                } catch (e) {
                    log('WARN', `[SHUTDOWN] hardwareTelemetry.stop falhou: ${e.message}`);
                }
            }
        },

        /* -----------------------------------------------------------
           CHROME PROXY SERVICE — fecha proxy WebSocket antes do pool
        ----------------------------------------------------------- */
        {
            name: 'ChromeProxyService',
            fn: async () => {
                if (global.chromeProxy && typeof global.chromeProxy.stop === 'function') {
                    try {
                        await global.chromeProxy.stop();
                        log('INFO', '[SHUTDOWN] Chrome Proxy Service parado');

                        // ✅ Emite evento NERV: Proxy encerrado
                        if (nerv && typeof nerv.emitEvent === 'function') {
                            const { sendEvent } = await import('#nerv/adapters/high_level_adapter');
                            const { ActionCode, ActorRole } = await import('#shared/nerv/constants');

                            sendEvent(
                                nerv,
                                ActorRole.INFRA,
                                ActionCode.INFRA_SHUTDOWN,
                                { component: 'ChromeProxyService', timestamp: Date.now() },
                                null,
                                null
                            );
                        }
                    } catch (err) {
                        log('WARN', `[SHUTDOWN] Erro ao parar Chrome Proxy: ${err.message}`);
                    }
                } else {
                    log('DEBUG', '[SHUTDOWN] Chrome Proxy Service não estava ativo');
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

if (import.meta.filename === process.argv[1]) {
    main();
}

export { boot, shutdown, main };
