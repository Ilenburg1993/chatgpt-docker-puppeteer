// @ts-check - Type checking rigoroso habilitado (arquivo core)
/* ==========================================================================
   src/main.js
   Entry Point: Maestro Bootstrap (Singularity Edition)
   Audit Level: 900 — Sovereign Boot Sequence

   Runtime: Node.js 24+ (ESM obrigatório)
   Compatibilidade: Linux/Windows (Docker recomendado)

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
// ENVIRONMENT VARIABLES (load .env.local before imports)
// =========================================================================
import './core/env_bootstrap.js';
import * as Authority from './core/authority.js';
import CONFIG from './core/config.js';
import { CONNECTION_MODES } from './core/constants/browser.js';
import { STATUS_VALUES } from './core/constants/tasks.js';
import { shouldAutobootEntrypoint } from './core/entrypoint_guard.js';
import * as forensics from './core/forensics.js';
import identityManager from './core/identity_manager.js';
import { log } from './core/logger.js';
import { retryWithBackoff } from './core/retry_policy.js';
import { ConnectionOrchestrator } from './infra/ConnectionOrchestrator.js';
import { importLegacyQueueFromDisk } from './infra/db/legacy_import.js';
import { getDb } from './infra/db/sqlite.js';
import { saveResponse } from './infra/storage/response_adapter.js';
import { createKernel } from './kernel/kernel.js';
import { createNERV } from './nerv/nerv.js';
import { ActionCode, ActorRole } from './shared/nerv/constants.js';

// =========================================================================
// ARCHITECTURAL GUARDS (process-wide, non-negotiable)
// =========================================================================
let _puppeteerGuardReady = false;

async function ensurePuppeteerGuardLoaded() {
    if (_puppeteerGuardReady) {
        return;
    }

    // Importa o guard correto que impede chamadas a `puppeteer.launch()` em runtime.
    // Carregado no fluxo de boot para evitar side-effects em import puro do entrypoint.
    await import('./infra/browser_pool/puppeteer_guard.js');
    _puppeteerGuardReady = true;
}
// ServerNERVAdapter is lazy-loaded when the server/socket hub is available

// ============================================================================
// SERVER MODE — CANONICAL RESOLUTION (FASE 2)
// ============================================================================

/**
 * Modos operacionais suportados para o servidor HTTP.
 * Define como o processo Maestro interage com a camada de servidor/socket.
 *
 * @enum {string}
 * @readonly
 * @property {string} INTEGRATED - Maestro inicia e gerencia servidor HTTP local
 * @property {string} SPLIT - Maestro conecta a servidor externo (gerenciado por PM2)
 * @property {string} DISABLED - Camada server/socket completamente desabilitada
 */
const SERVER_MODES = Object.freeze({
    INTEGRATED: 'integrated',
    SPLIT: 'split',
    DISABLED: 'disabled',
});

/**
 * Verifica se uma porta está em uso.
 * Retorna true se porta ocupada, false se disponível.
 *
 * @param {number} port - Porta a verificar
 * @returns {Promise<boolean>} - Verdadeiro se porta está em uso, falso caso contrário
 * Side-effects: Cria e fecha um servidor TCP temporário para testar a porta.
 */
/**
 * Verifica se uma porta TCP está em uso no sistema.
 *
 * Cria um servidor TCP temporário na porta especificada e tenta
 * fazer bind. Se conseguir, a porta está livre. Se receber
 * EADDRINUSE, a porta está ocupada.
 *
 * @async
 * @param {number} port - Número da porta TCP a verificar (1-65535)
 * @returns {Promise<boolean>} - true se porta está em uso, false se disponível
 *
 * @throws {Error} Se ocorrer erro inesperado ao verificar porta
 *
 * @sideEffects
 * - Cria e fecha servidor TCP temporário
 * - Não afeta estado global do sistema
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
 * Precedência de resolução:
 *  1) Argumento CLI `--authority=...` ou `--server-authority=...`
 *  2) Variável de ambiente `SERVER_AUTHORITY`
 *  3) Fallback padrão: `standalone`
 *
 * @returns {string} - Autoridade do processo ('standalone' ou 'delegated')
 *
 * @throws {Error} Process.exit(1) se autoridade for inválida
 *
 * @sideEffects
 * - Log de resolução da autoridade
 * - Process.exit(1) se autoridade inválida
 * - Não modifica estado global
 */
function resolveAuthority() {
    // CLI override (ex: --authority=delegated)
    const arg = process.argv.slice(2).find(a => a.startsWith('--authority=') || a.startsWith('--server-authority='));
    const rawFromArg = arg ? arg.split('=')[1] : undefined;

    const raw = rawFromArg ?? process.env.SERVER_AUTHORITY ?? Authority.SERVER_AUTHORITIES.STANDALONE;
    const allowed = Object.values(Authority.SERVER_AUTHORITIES);
    let authority = null;

    try {
        authority = Authority.resolveAuthority(raw);
    } catch (err) {
        log('FATAL', `[CONFIG] SERVER_AUTHORITY inválido: "${raw}"`);
        log('FATAL', `[CONFIG] Valores válidos: ${allowed.join(', ')}`);
        log('FATAL', `[CONFIG] Detalhe: ${err?.message || String(err)}`);
        process.exit(1);
    }

    log('INFO', `[CONFIG] SERVER_AUTHORITY resolvido: ${authority}`);
    return authority;
}

/**
 * Resolve modo operacional do server de forma canônica e validada.
 *
 * Hierarquia de resolução:
 *   1) process.env.SERVER_MODE (override runtime)
 *   2) CONFIG.SERVER_MODE (configuração padrão)
 *   3) Fallback: SERVER_MODES.INTEGRATED
 *
 * Validações aplicadas:
 *   - Normalização para lowercase e trim
 *   - Validação contra enum SERVER_MODES
 *   - Fail-fast com exit(1) em valores inválidos
 *
 * @returns {string} - Modo do servidor ('integrated', 'split' ou 'disabled')
 *
 * @throws {Error} Process.exit(1) se modo for inválido
 *
 * @sideEffects
 * - Log da resolução do modo
 * - Process.exit(1) se modo inválido
 * - Não modifica estado global
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

function readPositiveIntEnv(name, fallback) {
    const parsed = Number.parseInt(String(process.env[name] ?? fallback), 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function readPositiveInt(value, fallback) {
    const parsed = Number.parseInt(String(value ?? fallback), 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function probeSplitServerHealth(port, timeoutMs = 2000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(`http://localhost:${port}/health`, {
            signal: controller.signal,
        });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
    } finally {
        clearTimeout(timer);
    }
}

async function connectSplitExternalWithRetry(socketModule, externalPort) {
    if (!socketModule || typeof socketModule.connectExternal !== 'function') {
        throw new Error('socket.connectExternal não disponível em modo split');
    }

    const maxAttempts = readPositiveInt(
        process.env.SPLIT_CONNECT_MAX_ATTEMPTS ?? process.env.BOOT_RETRY_MAX_ATTEMPTS,
        10
    );
    const baseDelayMs = readPositiveInt(
        process.env.SPLIT_CONNECT_RETRY_BASE_MS ?? process.env.BOOT_RETRY_BASE_MS,
        1000
    );
    const maxDelayMs = readPositiveInt(process.env.SPLIT_CONNECT_RETRY_MAX_MS ?? process.env.BOOT_RETRY_MAX_MS, 8000);
    const waitForHealth = process.env.SPLIT_WAIT_HEALTH === 'true';
    let attempt = 0;
    try {
        const socketHub = await retryWithBackoff(
            async () => {
                attempt += 1;
                if (waitForHealth) {
                    await probeSplitServerHealth(externalPort);
                }
                return await Promise.resolve(socketModule.connectExternal(externalPort));
            },
            {
                maxAttempts,
                baseDelayMs,
                maxDelayMs,
                onRetry: ({ attempt: currentAttempt, maxAttempts: totalAttempts, error, delayMs }) => {
                    log(
                        'WARN',
                        `[BOOT] Split connect tentativa ${currentAttempt}/${totalAttempts} falhou: ${error?.message || String(error)}. Retry em ${delayMs}ms`
                    );
                },
            }
        );
        log('INFO', `[BOOT] Conexão split estabelecida na tentativa ${attempt}/${maxAttempts}`);
        return socketHub;
    } catch (err) {
        throw new Error(
            `Falha ao conectar servidor externo em modo split após ${maxAttempts} tentativas (porta=${externalPort})`,
            { cause: err }
        );
    }
}

/* ==========================================================================
   BOOT SEQUENCE
========================================================================== */

/**
 * Executa sequência completa de inicialização do sistema Maestro.
 *
 * Ordem crítica de inicialização (6 fases):
 * 1. **Configuração e Identidade**: Carrega config, estabelece robot_id
 * 2. **NERV**: Inicializa event bus (local + Socket.io híbrido)
 * 3. **Browser Pool**: Conecta a 3x instâncias Chrome (porta 9224)
 * 4. **KERNEL**: Inicia loop de 20Hz, engine de políticas
 * 5. **Adapters**: Inicializa bridges Driver↔NERV e Server↔NERV
 * 6. **Server Web**: Inicia Express + Socket.io na porta 3008
 *
 * Cada fase é executada sequencialmente com validações e fail-fast.
 * Em caso de falha, executa cleanup parcial antes de re-throw.
 *
 * @async
 * @returns {Promise<object>} Contexto de runtime com todas as instâncias ativas
 * @returns {object} returns.nerv - Sistema de comunicação NERV
 * @returns {object} returns.browserPool - Pool de browsers Chrome
 * @returns {object} returns.kernel - Instância do KERNEL
 * @returns {object} returns.driverAdapter - Adaptador NERV do driver
 * @returns {object} returns.serverAdapter - Adaptador NERV do servidor
 * @returns {object} returns.httpServer - Servidor HTTP (se autoridade)
 * @returns {boolean} returns.httpAuthority - Se este processo é dono do bind HTTP
 * @returns {object} returns.queueWorker - Worker da fila SSOT
 * @returns {object} returns.taskProjector - Projetor de estado de tarefas
 * @returns {object} returns.taskControlWatcher - Watcher de controle de tarefas
 * @returns {object} returns.missionRunner - Executor de missões
 * @returns {object} returns.missionPlannerProcessor - Processador de planejamento
 * @returns {object} returns.attemptWatchdog - Watchdog de tentativas
 * @returns {object} returns.heartbeatWatchdog - Watchdog de heartbeat
 * @returns {object} returns.agentLoop - Loop principal do agente
 *
 * @throws {Error} Se qualquer fase crítica falhar na inicialização
 *
 * @sideEffects
 * - Inicializa todos os subsistemas globais
 * - Estabelece conexões de rede (Chrome, HTTP)
 * - Registra event listeners no NERV
 * - Cria arquivos temporários e logs
 */
async function boot() {
    log('INFO', '🚀 Maestro Singularity Edition - Iniciando boot sequence...');

    const bootStartTime = Date.now();
    let processAuthority;

    try {
        await ensurePuppeteerGuardLoaded();
        processAuthority = resolveAuthority();
        // ===== FASE 0: ENV VALIDATION (FAIL-FAST) =====
        log('INFO', '[BOOT] Fase 0/6: Validação de variáveis de ambiente');

        const { validateEnv } = await import('./core/env_validator.js');
        const envResult = validateEnv({
            throwOnError: true, // Fail-fast on critical errors
            applyDefaults: true, // Apply defaults for missing vars
            verbose: false, // Only show errors/warnings
        });

        if (envResult.warnings.length > 0) {
            log('WARN', `[BOOT] ENV validation warnings: ${envResult.warnings.length}`);
        }

        log('DEBUG', '[BOOT] ENV validation passed');

        // ===== FASE 1: CONFIGURAÇÃO E IDENTIDADE =====
        log('INFO', '[BOOT] Fase 1/6: Configuração e Identidade');

        // Carga de configuração
        await CONFIG.reload('sys-boot');
        log('DEBUG', '[BOOT] Configurações carregadas');

        // Garante identidade do robô (robot_id)
        await identityManager.initialize();
        const identity = identityManager.getFullIdentity();

        // BUG-010: Validação pós-instantiation para identityManager
        if (!identityManager || typeof identityManager !== 'object') {
            log('FATAL', '[BOOT] identityManager initialization falhou: instância inválida');
            process.exit(1);
        }
        if (typeof identityManager.getFullIdentity !== 'function') {
            log('FATAL', '[BOOT] identityManager initialization falhou: método getFullIdentity ausente');
            process.exit(1);
        }
        if (typeof identityManager.initialize !== 'function') {
            log('FATAL', '[BOOT] identityManager initialization falhou: método initialize ausente');
            process.exit(1);
        }

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
            telemetry: process.env.NERV_TELEMETRY !== 'false' && CONFIG.NERV_TELEMETRY !== false,
        });

        // BUG-010: Validação pós-instantiation para NERV
        if (!nerv || typeof nerv !== 'object') {
            log('FATAL', '[BOOT] NERV initialization falhou: instância inválida');
            process.exit(1);
        }
        if (typeof nerv.emitEvent !== 'function') {
            log('FATAL', '[BOOT] NERV initialization falhou: método emitEvent ausente');
            process.exit(1);
        }
        if (typeof nerv.onEvent !== 'function') {
            log('FATAL', '[BOOT] NERV initialization falhou: método onEvent ausente');
            process.exit(1);
        }

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
                const ChromeProxyService = await import('./infra/proxy/chromeProxyService.js').then(
                    m => m.default ?? m
                );
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
                        LOG_LEVEL: CONFIG.LOG_LEVEL || 'INFO',
                        // Signal lifecycle is centralized in src/main.js
                        AUTO_HANDLE_SIGNALS: false,
                    });

                    // Injeta NERV no proxy para telemetria
                    chromeProxy.setNERV(nerv);

                    // Inicia proxy
                    await chromeProxy.start();

                    // Armazena globalmente para shutdown
                    global.chromeProxy = chromeProxy;

                    log('INFO', `[BOOT] ✅ Chrome Proxy Service online (porta ${proxyPort})`);

                    // ✅ Emite evento NERV: Proxy iniciado
                    await sendEvent(
                        nerv,
                        ActorRole.INFRA,
                        ActionCode.INFRA_READY,
                        {
                            component: 'ChromeProxyService',
                            port: proxyPort,
                            host: CONFIG.CHROME_PROXY_HOST,
                            timestamp: Date.now(),
                            mode: 'inline',
                        },
                        null, // correlationId
                        null // target (broadcast)
                    );
                    log('DEBUG', '[BOOT] Evento NERV INFRA_READY publicado (ChromeProxy)');
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
            const proxyPort = CONFIG.CHROME_PROXY_PORT || 9224;
            const externalProxyRunning = await checkPortInUse(proxyPort);
            if (externalProxyRunning) {
                log(
                    'INFO',
                    `[BOOT] Chrome Proxy inline desabilitado (CONFIG.CHROME_PROXY_ENABLED=false), usando proxy externo na porta ${proxyPort}`
                );
            } else {
                log('WARN', '[BOOT] ⚠️  Chrome Proxy Service desabilitado (CONFIG.CHROME_PROXY_ENABLED=false)');
                log('WARN', '[BOOT] ⚠️  Conexões diretas ao Chrome podem falhar em ambientes containerizados');
            }
        }

        // NERV-based server discovery (non-blocking): escuta evento SERVER_READY
        let discoveredServerInfo = null;
        let discoveryUnsub = null;
        let discoveryCleanupExecuted = false;

        const cleanupDiscoveryListener = () => {
            // BUG-014: Atomic operation para prevenir race conditions
            if (discoveryCleanupExecuted) return;
            discoveryCleanupExecuted = true;

            if (typeof discoveryUnsub === 'function') {
                try {
                    // Para funções async, aguardamos em background
                    const cleanupResult = discoveryUnsub();
                    if (cleanupResult && typeof cleanupResult.then === 'function') {
                        cleanupResult.catch(e => {
                            log('DEBUG', `[BOOT] Discovery cleanup async error: ${e.message}`);
                        });
                    }
                    discoveryUnsub = null;
                    log('DEBUG', '[BOOT] Discovery listener removido');
                } catch (e) {
                    /* noop */
                }
            }
        };

        // Timeout aumentado de 5s → 30s (server boot pode ser lento em cold start)
        const discoveryTimeoutMs = Number(process.env.SERVER_DISCOVERY_TIMEOUT ?? 30000);
        const discoveryCleanupTimeoutMs = Number(process.env.SERVER_DISCOVERY_CLEANUP_TIMEOUT ?? 60000);

        try {
            discoveryUnsub =
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
                              cleanupDiscoveryListener(); // Remove listener após descoberta
                          } catch (e) {
                              /* ignore */
                          }
                      })
                    : null;

            if (discoveryTimeoutMs > 0) {
                setTimeout(() => {
                    cleanupDiscoveryListener(); // Remove listener após timeout
                }, discoveryTimeoutMs);
            } else {
                // Mesmo sem timeout configurado, garante cleanup após 60s
                setTimeout(() => {
                    cleanupDiscoveryListener();
                }, 60000);
            }
        } catch (err) {
            log('DEBUG', `[BOOT] Falha ao registrar discovery NERV: ${err.message}`);
        } finally {
            // Cleanup adicional garantido (caso exception interrompa)
            if (!discoveryCleanupExecuted && discoveryUnsub) {
                setTimeout(cleanupDiscoveryListener, discoveryCleanupTimeoutMs);
            }
        }

        // ===== FASE 3: BROWSER POOL (COM RESILIÊNCIA) =====
        log('INFO', '[BOOT] Fase 3/6: Inicializando Browser Pool (modo resiliente)');

        const { initializeBrowserPoolResilient, getBrowserEndpoint } =
            await import('./core/boot_resilience_manager.js');
        const browserEndpoint = getBrowserEndpoint();
        log('INFO', `[BOOT] Chrome endpoint resolvido: ${browserEndpoint.url}`);
        if (!browserEndpoint.url) {
            log('FATAL', '[BOOT] Chrome endpoint não resolvido');
            process.exit(1);
        }

        const browserPoolResult = await initializeBrowserPoolResilient(
            {
                poolSize: readPositiveInt(process.env.BROWSER_POOL_SIZE ?? CONFIG.BROWSER_POOL_SIZE, 3),
                allocationStrategy: (() => {
                    const strategyRaw = String(
                        process.env.ALLOCATION_STRATEGY ?? CONFIG.ALLOCATION_STRATEGY ?? 'round-robin'
                    )
                        .toLowerCase()
                        .trim();
                    const validStrategies = new Set(['round-robin', 'least-loaded', 'target-affinity']);
                    return validStrategies.has(strategyRaw) ? strategyRaw : 'round-robin';
                })(),
                healthCheckInterval: readPositiveInt(
                    process.env.HEALTH_CHECK_INTERVAL ?? CONFIG.HEALTH_CHECK_INTERVAL,
                    30000
                ),
                pageTtlMs: readPositiveInt(process.env.BROWSER_PAGE_TTL_MS ?? CONFIG.BROWSER_PAGE_TTL_MS, 3600000),
                allocateMaxAttempts: readPositiveInt(
                    process.env.BROWSER_ALLOCATE_MAX_ATTEMPTS ?? CONFIG.BROWSER_ALLOCATE_MAX_ATTEMPTS,
                    Math.max(3, readPositiveInt(process.env.BROWSER_POOL_SIZE ?? CONFIG.BROWSER_POOL_SIZE, 3) * 3)
                ),
                browserEndpoint,
            },
            {
                nerv, // ✅ Injeta NERV para Circuit Breaker
                allowDegradedMode: process.env.ALLOW_DEGRADED_MODE !== 'false',
                autoRetry: process.env.AUTO_RETRY_CHROME !== 'false',
                maxAutoRetries: Number.parseInt(process.env.MAX_AUTO_RETRIES ?? '2', 10),
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

        const { factory: driverFactory } = await import('./driver/factory.js');
        await driverFactory.start({
            browserPool,
            warmup: Boolean(CONFIG.DRIVER_POOL_ENABLED),
            startHealthChecks: true,
        });
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
            summarizationPolicy: process.env.SUMMARIZATION_POLICY || CONFIG.SUMMARIZATION_POLICY || 'on_overflow',
        });

        // BUG-010: Validação pós-instantiation
        if (!contextManager || typeof contextManager !== 'object') {
            log('FATAL', '[BOOT] ContextManager initialization falhou: instância inválida');
            process.exit(1);
        }
        if (typeof contextManager.getContext !== 'function') {
            log('FATAL', '[BOOT] ContextManager initialization falhou: método getContext ausente');
            process.exit(1);
        }

        log('INFO', '[BOOT] ✅ ContextManager online (será compartilhado por Kernel e MissionRunner)');

        // ===== FASE 4: KERNEL (SSOT GATEWAY + NERV PUMP) =====
        log('INFO', '[BOOT] Fase 4/6: Inicializando KERNEL');

        const kernel = await createKernel({
            mode: 'ssot_gateway',
            nerv, // Passa NERV diretamente
            contextManager, // V2.0: Injeta ContextManager compartilhado
            telemetry: {
                source: ActorRole.KERNEL.toLowerCase(),
                retention: 1000,
            },
            policy: {},
            loop: {
                baseIntervalMs: process.env.KERNEL_CYCLE_INTERVAL || CONFIG.KERNEL_CYCLE_INTERVAL || 50, // 50ms = 20 Hz
            },
        });

        // BUG-010: Validação pós-instantiation para KERNEL
        if (!kernel || typeof kernel !== 'object') {
            log('FATAL', '[BOOT] KERNEL initialization falhou: instância inválida');
            process.exit(1);
        }
        if (typeof kernel.executeTask !== 'function') {
            log('FATAL', '[BOOT] KERNEL initialization falhou: método executeTask ausente');
            process.exit(1);
        }
        if (typeof kernel.start !== 'function') {
            log('FATAL', '[BOOT] KERNEL initialization falhou: método start ausente');
            process.exit(1);
        }
        if (typeof kernel.shutdown !== 'function') {
            log('FATAL', '[BOOT] KERNEL initialization falhou: método shutdown ausente');
            process.exit(1);
        }

        // Start kernel lifecycle. We run the kernel pump in manual mode (AgentLoop).
        try {
            if (typeof kernel.start === 'function') {
                kernel.start({ autoLoop: false });
                log('INFO', '[BOOT] ✅ KERNEL started (SSOT gateway; pump manual via AgentLoop)');
            }
        } catch (err) {
            log('FATAL', `[BOOT] kernel.start() falhou: ${err?.message || String(err)}`);
            process.exit(1);
        }

        log('INFO', '[BOOT] ✅ KERNEL online (SSOT gateway)');

        // ======================================================================
        // ===== FASE 5: ADAPTERS (PONTES NERV) — SERVER MODE SEM IPC =========
        // ======================================================================
        log('INFO', '[BOOT] Fase 5/6: Inicializando Adapters');

        // ----------------------------------------------------------------------
        // DRIVER ADAPTER (sempre local ao Maestro)
        // ----------------------------------------------------------------------
        // Em modo degradado (browserPool = null), DriverAdapter não executa tasks
        const { DriverNERVAdapter } = await import('./driver/nerv_adapter/driver_nerv_adapter.js');
        const driverAdapter = new DriverNERVAdapter(nerv, browserPool, { saveResponse });

        if (systemMode === 'degraded') {
            log('WARN', '[BOOT] ⚠️ DriverAdapter em modo degradado (browserPool = null)');
            log('WARN', '[BOOT] Tasks dependentes de browser permanecem desativadas');
        } else {
            log('INFO', '[BOOT] ✅ DriverNERVAdapter online');
        }

        // ======================================================================
        // ===== FASE 5.1: SSOT SQLITE + WORKERS (QueueWorker + Projector) =====
        // ======================================================================

        let queueWorker = null;
        let taskProjector = null;
        let taskControlWatcher = null;
        let missionRunner = null;
        let missionPlannerProcessor = null;
        let attemptWatchdog = null;
        let heartbeatWatchdog = null;
        let taskOrchestrationWorker = null;
        let agentLoop = null;

        try {
            const [
                { QueueWorker },
                { TaskControlWatcher },
                { TaskOrchestrationWorker },
                { TaskStateProjector },
                { AgentLoop },
                { AttemptWatchdog },
                { HeartbeatWatchdog },
                { MissionPlannerProcessor },
                { MissionRunner },
            ] = await Promise.all([
                import('#agent/queue_worker'),
                import('#agent/task_control_watcher'),
                import('#agent/task_orchestration_worker'),
                import('#agent/task_state_projector'),
                import('#agent/agent_loop'),
                import('#agent/attempt_watchdog'),
                import('#agent/heartbeat_watchdog'),
                import('#agent/mission_planner_processor'),
                import('#agent/mission_runner'),
            ]);

            // BUG-009: Timeout wrapper para prevenir hang no SSOT init
            const SSOT_INIT_TIMEOUT = Number(process.env.SSOT_INIT_TIMEOUT_MS || 30000);
            log('DEBUG', `[BOOT] SSOT init timeout configurado: ${SSOT_INIT_TIMEOUT}ms`);

            await Promise.race([
                // Inicialização normal
                (async () => {
                    // Ensure DB is ready (migrations) and import legacy filesystem queue once (best-effort).
                    getDb();
                    try {
                        await importLegacyQueueFromDisk();
                    } catch (err) {
                        log('WARN', `[BOOT] Legacy queue import skipped/failed: ${err?.message || String(err)}`);
                    }

                    const identityNow = identityManager.getFullIdentity?.() || {};
                    const workerId = identityNow.robot_id || `worker-${process.pid}`;

                    taskProjector = new TaskStateProjector({ nerv, workerId });
                    await taskProjector.start();
                    if (taskProjector.isRunning && !taskProjector.isRunning()) {
                        log('WARN', '[BOOT] TaskProjector.start() completou mas worker não está running');
                    }
                    log('DEBUG', '[BOOT] TaskProjector iniciado');

                    taskControlWatcher = new TaskControlWatcher({
                        nerv,
                        intervalMs: Number(process.env.TASK_CONTROL_INTERVAL_MS || 500) || 500,
                    });

                    queueWorker = new QueueWorker({
                        kernel,
                        workerId,
                        intervalMs: Number(process.env.QUEUE_WORKER_INTERVAL_MS || 250) || 250,
                        lockTtlMs: Number(process.env.QUEUE_WORKER_LOCK_TTL_MS || 60000) || 60000,
                        maxConcurrentTasks: Number(process.env.QUEUE_MAX_CONCURRENT_TASKS || 2) || 2,
                    });

                    missionRunner = new MissionRunner({
                        intervalMs: Number(process.env.MISSION_RUNNER_INTERVAL_MS || 1000) || 1000,
                    });

                    missionPlannerProcessor = new MissionPlannerProcessor({
                        intervalMs: Number(process.env.MISSION_PLANNER_INTERVAL_MS || 1500) || 1500,
                    });
                    attemptWatchdog = new AttemptWatchdog({
                        nerv,
                        intervalMs: Number(process.env.ATTEMPT_WATCHDOG_INTERVAL_MS || 1500) || 1500,
                        dispatchedStuckMs: Number(process.env.ATTEMPT_DISPATCHED_STUCK_MS || 30000) || 30000,
                        rescheduleDelayMs: Number(process.env.ATTEMPT_WATCHDOG_RESCHEDULE_DELAY_MS || 1000) || 1000,
                    });

                    heartbeatWatchdog = new HeartbeatWatchdog({
                        workerId: `${workerId}-hb`,
                        intervalMs: Number(process.env.HEARTBEAT_WATCHDOG_INTERVAL_MS || 60000) || 60000, // 1min default
                        staleThresholdMs: Number(process.env.HEARTBEAT_STALE_THRESHOLD_MS || 180000) || 180000, // 3min default
                    });
                    await heartbeatWatchdog.start();
                    if (heartbeatWatchdog.isActive && !heartbeatWatchdog.isActive()) {
                        log('WARN', '[BOOT] HeartbeatWatchdog.start() completou mas watchdog não está ativo');
                    }
                    log('DEBUG', '[BOOT] HeartbeatWatchdog iniciado');

                    taskOrchestrationWorker = new TaskOrchestrationWorker({
                        browserPool,
                        workerId,
                        intervalMs: Number(process.env.TASK_ORCHESTRATION_INTERVAL_MS || 1250) || 1250,
                        batchSize: Number(process.env.TASK_ORCHESTRATION_BATCH_SIZE || 50) || 50,
                    });

                    agentLoop = new AgentLoop({
                        kernel,
                        browserPool,
                        queueWorker,
                        taskControlWatcher,
                        missionRunner,
                        missionPlannerProcessor,
                        attemptWatchdog,
                        taskOrchestrationWorker,
                        intervals: {
                            kernelMs:
                                Number(process.env.KERNEL_CYCLE_INTERVAL || CONFIG.KERNEL_CYCLE_INTERVAL || 50) || 50,
                            queueMs: Number(process.env.QUEUE_WORKER_INTERVAL_MS || 250) || 250,
                            controlMs: Number(process.env.TASK_CONTROL_INTERVAL_MS || 500) || 500,
                            missionMs: Number(process.env.MISSION_RUNNER_INTERVAL_MS || 1000) || 1000,
                            plannerMs: Number(process.env.MISSION_PLANNER_INTERVAL_MS || 1500) || 1500,
                            watchdogMs: Number(process.env.ATTEMPT_WATCHDOG_INTERVAL_MS || 1500) || 1500,
                            orchestrationMs: Number(process.env.TASK_ORCHESTRATION_INTERVAL_MS || 1250) || 1250,
                        },
                    });
                    await agentLoop.start();
                    if (agentLoop.isRunning && !agentLoop.isRunning()) {
                        log('WARN', '[BOOT] AgentLoop.start() completou mas loop não está running');
                    }
                    log('DEBUG', '[BOOT] AgentLoop iniciado');

                    // Validação final: verifica que todos os workers críticos estão ativos
                    const workersStatus = {
                        taskProjector: taskProjector?.isRunning?.() ?? true,
                        heartbeatWatchdog: heartbeatWatchdog?.isActive?.() ?? true,
                        agentLoop: agentLoop?.isRunning?.() ?? true,
                    };
                    const allRunning = Object.values(workersStatus).every(status => status);
                    if (!allRunning) {
                        log(
                            'WARN',
                            `[BOOT] Alguns workers não confirmaram estado running: ${JSON.stringify(workersStatus)}`
                        );
                    }

                    log('INFO', '[BOOT] ✅ SSOT workers online (SQLite queue)');
                })(),

                // Timeout watchdog
                new Promise((_, reject) =>
                    setTimeout(
                        () => reject(new Error(`SSOT init timeout após ${SSOT_INIT_TIMEOUT}ms`)),
                        SSOT_INIT_TIMEOUT
                    )
                ),
            ]);
        } catch (err) {
            log('FATAL', `[BOOT] SSOT workers init failed: ${err?.message || String(err)}`);
            process.exit(1);
        }

        // ======================================================================
        // SERVER MODE — DECISÃO DETERMINÍSTICA (SEM IPC / SEM DISCOVERY FILE)
        // ======================================================================
        // Modos suportados:
        //
        //   integrated → Maestro delega bootstrap HTTP/socket para src/server/main.js
        //   split      → Maestro NÃO sobe HTTP — conecta em server externo
        //   disabled   → Maestro não usa camada server/socket
        //
        // Fonte única:
        //   process.env.SERVER_MODE ou CONFIG.SERVER_MODE
        // ----------------------------------------------------------------------

        // SERVER_MODE já foi resolvido na Fase 1 (validação PM2+integrated)
        // Apenas logamos aqui para clareza
        log('INFO', `[BOOT] Server mode (determinístico): ${SERVER_MODE}`);

        const socketModule = await import('./server/engine/socket.js').then(m => m.default ?? m);

        let socketHub = null;
        let serverAdapter = null;
        let boundPort = undefined;
        let httpServer = undefined;
        let httpAuthority = false;
        let serverLifecycle = null;
        let serverLifecycleManaged = false;

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

            try {
                socketHub = await connectSplitExternalWithRetry(socketModule, externalPort);
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

            const ServerNERVAdapter = await import('./server/nerv_adapter/server_nerv_adapter.js').then(
                m => m.default ?? m
            );
            serverAdapter = new ServerNERVAdapter(nerv, socketHub, CONFIG);

            // BUG-011: Validação pós-instantiation
            if (!serverAdapter || typeof serverAdapter !== 'object') {
                log('FATAL', '[BOOT] ServerNERVAdapter initialization falhou (split mode)');
                process.exit(1);
            }
            if (typeof serverAdapter.shutdown !== 'function') {
                log('FATAL', '[BOOT] ServerNERVAdapter inválido: método shutdown ausente');
                process.exit(1);
            }

            httpAuthority = false;
        }

        // ----------------------------------------------------------------------
        // INTEGRATED MODE — delega para bootstrap canônico do Server Process
        // ----------------------------------------------------------------------
        else if (SERVER_MODE === 'integrated') {
            /**
             * Em modo integrado, o Maestro NÃO monta manualmente HTTP/socket.
             * O bootstrap canônico do servidor (`src/server/main.js`) é reutilizado
             * para garantir:
             *  - mesmo contrato de inicialização entre processo dedicado e integrado
             *  - um único caminho de configuração de telemetria/watchers/router
             *  - menor divergência de comportamento operacional
             *
             * A autoridade é forçada para `delegated` neste contexto porque:
             *  - sinais e exit policy já são coordenados por `src/main.js`;
             *  - o NERV principal já existe e deve ser injetado.
             */
            const { serverBootstrap } = await import('./server/main.js');
            const serverRuntime = await serverBootstrap({
                authority: Authority.SERVER_AUTHORITIES.DELEGATED,
                nerv,
            });

            if (!serverRuntime || typeof serverRuntime !== 'object') {
                log('FATAL', '[BOOT] serverBootstrap retornou shape inválido (integrated mode)');
                process.exit(1);
            }

            const runtimePort = Number.parseInt(String(serverRuntime.port), 10);
            if (!serverRuntime.httpServer || !Number.isInteger(runtimePort) || runtimePort < 1 || runtimePort > 65535) {
                log('FATAL', '[BOOT] serverBootstrap retornou runtime incompleto (httpServer/port)');
                process.exit(1);
            }

            if (serverRuntime.nerv !== nerv) {
                log('FATAL', '[BOOT] serverBootstrap retornou instância NERV divergente da injetada');
                process.exit(1);
            }

            if (!serverRuntime.serverAdapter || typeof serverRuntime.serverAdapter.shutdown !== 'function') {
                log('FATAL', '[BOOT] serverBootstrap retornou serverAdapter inválido');
                process.exit(1);
            }

            httpServer = serverRuntime.httpServer;
            boundPort = runtimePort;
            serverAdapter = serverRuntime.serverAdapter;
            httpAuthority = true;

            // Mantém shape compatível do contexto: em integrated o hub canônico é o módulo de socket.
            socketHub = socketModule;

            try {
                serverLifecycle = await import('./server/engine/lifecycle.js').then(m => m.default ?? m);
                if (serverLifecycle && typeof serverLifecycle.gracefulShutdown === 'function') {
                    serverLifecycleManaged = true;
                } else {
                    serverLifecycle = null;
                }
            } catch (err) {
                serverLifecycle = null;
                serverLifecycleManaged = false;
                log('WARN', `[BOOT] Lifecycle do server indisponível para shutdown coordenado: ${err.message}`);
            }

            log(
                'INFO',
                `[BOOT] Server integrado via serverBootstrap (porta=${boundPort}, lifecycleManaged=${serverLifecycleManaged})`
            );
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
        // ===== FASE 5.5: MISSION ORCHESTRATION (SSOT) =========================
        // ======================================================================
        // Missions and tasks orchestration is DB-driven:
        // - Dashboard/API writes to SQLite (SSOT)
        // - MissionRunner creates tasks based on mission state/policy
        // - QueueWorker executes eligible tasks automatically

        // ===== FASE 6: FINALIZAÇÃO =====

        const bootDuration = Date.now() - bootStartTime;

        log('INFO', `[BOOT] Fase 6/6 concluída em ${bootDuration}ms`);
        log('INFO', `[BOOT] Topologia server: ${SERVER_MODE} (authority=${httpAuthority})`);
        log('INFO', `[BOOT] Autoridade do processo: ${processAuthority}`);

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

            // -------- SSOT WORKERS --------
            queueWorker: queueWorker ?? null,
            taskProjector: taskProjector ?? null,
            taskControlWatcher: taskControlWatcher ?? null,
            missionRunner: missionRunner ?? null,
            missionPlannerProcessor: missionPlannerProcessor ?? null,
            attemptWatchdog: attemptWatchdog ?? null,
            heartbeatWatchdog: heartbeatWatchdog ?? null,
            agentLoop: agentLoop ?? null,

            // -------- SERVER LAYER --------
            serverMode: SERVER_MODE,
            processAuthority,
            socketHub: socketHub ?? null,
            httpServer: httpServer ?? null,
            httpAuthority: Boolean(httpAuthority),
            httpPort: boundPort ?? null,
            serverLifecycle: serverLifecycle ?? null,
            serverLifecycleManaged: Boolean(serverLifecycleManaged),

            // -------- METRICS --------
            bootDuration,
        };
    } catch (error) {
        // Diagnóstico síncrono: logs assíncronos podem não flushar antes do process.exit.
        console.error('[BOOT_FATAL_SYNC]', error && error.stack ? error.stack : error);
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

/**
 * Executa shutdown gracioso coordenado do sistema.
 *
 * Ordem de encerramento (crítica para evitar race conditions):
 * 1. ServerAdapter (ponte NERV/socket)
 * 2. ChromeProxyService (proxy WebSocket)
 * 3. HTTPServer (apenas se autoridade)
 * 4. SSOT Workers (AgentLoop, QueueWorker, etc.)
 * 5. DriverAdapter
 * 6. KERNEL
 * 7. BrowserPool
 * 8. NERV (último subsistema ativo)
 * 9. TempProfiles (limpeza final)
 *
 * @async
 * @param {object} context - Contexto de runtime retornado por boot()
 * @param {object} context.serverAdapter - Adaptador do servidor NERV
 * @param {object} context.driverAdapter - Adaptador do driver NERV
 * @param {object} context.kernel - Instância do KERNEL
 * @param {object} context.browserPool - Pool de browsers
 * @param {object} context.nerv - Sistema de comunicação NERV
 * @param {object} context.httpServer - Servidor HTTP (se integrado)
 * @param {boolean} context.httpAuthority - Se este processo é dono do bind HTTP
 * @param {object} context.serverLifecycle - Módulo de lifecycle do server (opcional)
 * @param {boolean} context.serverLifecycleManaged - Se lifecycle do server deve coordenar teardown de infraestrutura
 * @param {object} context.queueWorker - Worker da fila SSOT
 * @param {object} context.taskProjector - Projetor de estado de tarefas
 * @param {object} context.taskControlWatcher - Watcher de controle de tarefas
 * @param {object} context.missionRunner - Executor de missões
 * @param {object} context.missionPlannerProcessor - Processador de planejamento de missões
 * @param {object} context.attemptWatchdog - Watchdog de tentativas
 * @param {object} context.heartbeatWatchdog - Watchdog de heartbeat
 * @param {object} context.agentLoop - Loop principal do agente
 * @param {object} [options] - Opções de shutdown
 * @param {boolean} [options.exitOnComplete=false] - Se verdadeiro, encerra processo ao concluir
 * @returns {Promise<{ok: boolean, failedPhases: number, totalPhases: number, duration: number}>}
 *
 * @throws {Error} Se alguma fase crítica do shutdown falhar
 *
 * @sideEffects
 * - Encerra todos os subsistemas ativos
 * - Remove signal handlers
 * - Limpa recursos globais
 * - Process.exit() com código apropriado
 */
async function shutdown(context, options = {}) {
    log('WARN', '[SHUTDOWN] Iniciando shutdown gracioso coordenado...');
    const exitOnComplete = options.exitOnComplete === true;
    const shutdownPhaseTimeoutMs = readPositiveIntEnv('SHUTDOWN_PHASE_TIMEOUT_MS', 10000);

    const shutdownStartTime = Date.now();
    const phases = [];
    let failedPhases = 0;

    const {
        serverAdapter,
        driverAdapter,
        kernel,
        browserPool,
        nerv,
        httpServer,
        httpAuthority,
        serverLifecycle,
        serverLifecycleManaged,
        queueWorker,
        taskProjector,
        taskControlWatcher,
        missionRunner,
        missionPlannerProcessor,
        attemptWatchdog,
        heartbeatWatchdog,
        agentLoop,
    } = context || {};

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

                // Em modo integrado via serverBootstrap, lifecycle do server é responsável
                // por encerrar watchers/telemetria/socket/http de forma canônica.
                if (
                    serverLifecycleManaged &&
                    serverLifecycle &&
                    typeof serverLifecycle.gracefulShutdown === 'function'
                ) {
                    await serverLifecycle.gracefulShutdown('MAESTRO_COORDINATED_SHUTDOWN');
                    log('DEBUG', '[SHUTDOWN] Server lifecycle encerrado via gracefulShutdown coordenado');
                    return;
                }

                // auxiliares — best effort
                try {
                    const reconciler = await import('./server/supervisor/reconcilier.js').then(m => m.default ?? m);
                    if (reconciler && typeof reconciler.stop === 'function') {
                        try {
                            await reconciler.stop();
                            log('DEBUG', '[SHUTDOWN] Reconciler parado');
                        } catch (err) {
                            log('WARN', `[SHUTDOWN] Erro ao parar reconciler: ${err?.message || String(err)}`);
                        }
                    } else {
                        log('DEBUG', '[SHUTDOWN] Reconciler não estava ativo ou método stop() ausente');
                    }
                } catch (importErr) {
                    log('WARN', `[SHUTDOWN] Falha ao importar reconciler: ${importErr.message}`);
                }

                try {
                    const hardwareTelemetry = await import('./server/realtime/telemetry/hardware.js').then(
                        m => m.default ?? m
                    );
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
            },
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

                            await sendEvent(
                                nerv,
                                ActorRole.INFRA,
                                ActionCode.INFRA_SHUTDOWN,
                                { component: 'ChromeProxyService', timestamp: Date.now() },
                                null,
                                null
                            );
                            log('DEBUG', '[SHUTDOWN] Evento NERV INFRA_SHUTDOWN publicado');
                        }
                    } catch (err) {
                        log('WARN', `[SHUTDOWN] Erro ao parar Chrome Proxy: ${err.message}`);
                    } finally {
                        // BUG-013: Garante cleanup da referência global mesmo em caso de erro
                        global.chromeProxy = null;
                        log('DEBUG', '[SHUTDOWN] Referência global chromeProxy limpa');
                    }
                } else {
                    log('DEBUG', '[SHUTDOWN] Chrome Proxy Service não estava ativo');
                }
            },
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

                if (serverLifecycleManaged) {
                    log('DEBUG', '[SHUTDOWN] HTTPServer skip — encerrado pelo server lifecycle');
                    return;
                }

                if (httpServer && typeof httpServer.close === 'function') {
                    await new Promise(resolve => {
                        httpServer.close(() => resolve());
                    });
                    log('INFO', '[SHUTDOWN] HTTP server fechado');
                }
            },
        },

        /* -----------------------------------------------------------
           DRIVER
        ----------------------------------------------------------- */
        {
            name: 'SSOTWorkers',
            fn: async () => {
                try {
                    if (agentLoop && typeof agentLoop.stop === 'function') {
                        agentLoop.stop();
                    }
                } catch (err) {
                    log('WARN', `[SHUTDOWN] agentLoop.stop falhou: ${err?.message || String(err)}`);
                }

                try {
                    if (queueWorker && typeof queueWorker.stop === 'function') {
                        queueWorker.stop();
                    }
                } catch (err) {
                    log('WARN', `[SHUTDOWN] queueWorker.stop falhou: ${err?.message || String(err)}`);
                }

                try {
                    if (taskControlWatcher && typeof taskControlWatcher.stop === 'function') {
                        taskControlWatcher.stop();
                    }
                } catch (err) {
                    log('WARN', `[SHUTDOWN] taskControlWatcher.stop falhou: ${err?.message || String(err)}`);
                }

                try {
                    if (taskProjector && typeof taskProjector.stop === 'function') {
                        taskProjector.stop();
                    }
                } catch (err) {
                    log('WARN', `[SHUTDOWN] taskProjector.stop falhou: ${err?.message || String(err)}`);
                }

                try {
                    if (missionRunner && typeof missionRunner.stop === 'function') {
                        missionRunner.stop();
                    }
                } catch (err) {
                    log('WARN', `[SHUTDOWN] missionRunner.stop falhou: ${err?.message || String(err)}`);
                }

                try {
                    if (missionPlannerProcessor && typeof missionPlannerProcessor.stop === 'function') {
                        missionPlannerProcessor.stop();
                    }
                } catch (err) {
                    log('WARN', `[SHUTDOWN] missionPlannerProcessor.stop falhou: ${err?.message || String(err)}`);
                }

                try {
                    if (attemptWatchdog && typeof attemptWatchdog.stop === 'function') {
                        attemptWatchdog.stop();
                    }
                } catch (err) {
                    log('WARN', `[SHUTDOWN] attemptWatchdog.stop falhou: ${err?.message || String(err)}`);
                }

                try {
                    if (heartbeatWatchdog && typeof heartbeatWatchdog.stop === 'function') {
                        heartbeatWatchdog.stop();
                    }
                } catch (err) {
                    log('WARN', `[SHUTDOWN] heartbeatWatchdog.stop falhou: ${err?.message || String(err)}`);
                }
            },
        },

        {
            name: 'DriverAdapter',
            fn: async () => {
                if (driverAdapter && typeof driverAdapter.shutdown === 'function') {
                    await driverAdapter.shutdown();
                }
            },
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
            },
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
            },
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
            },
        },

        /* -----------------------------------------------------------
           TEMP PROFILES — limpeza final
        ----------------------------------------------------------- */
        {
            name: 'TempProfiles',
            fn: async () => {
                const cleanupTempProfiles = ConnectionOrchestrator?.cleanupTempProfiles;
                if (typeof cleanupTempProfiles !== 'function') {
                    log(
                        'DEBUG',
                        '[SHUTDOWN] ConnectionOrchestrator.cleanupTempProfiles indisponível; limpeza de perfil temporário ignorada'
                    );
                    return;
                }

                const cleaned = await cleanupTempProfiles();
                if (Number(cleaned) > 0) {
                    log('INFO', `[SHUTDOWN] Removidos ${cleaned} profiles temporarios`);
                }
            },
        },
    ];

    const total = shutdownPhases.length;

    for (let i = 0; i < shutdownPhases.length; i++) {
        const phase = shutdownPhases[i];
        const phaseStartTime = Date.now();

        try {
            log('INFO', `[SHUTDOWN] ${i + 1}/${total}: Encerrando ${phase.name}...`);
            await new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    reject(new Error(`Timeout em fase ${phase.name} após ${shutdownPhaseTimeoutMs}ms`));
                }, shutdownPhaseTimeoutMs);

                Promise.resolve()
                    .then(() => phase.fn())
                    .then(() => {
                        clearTimeout(timer);
                        resolve();
                    })
                    .catch(err => {
                        clearTimeout(timer);
                        reject(err);
                    });
            });

            const duration = Date.now() - phaseStartTime;

            phases.push({
                name: phase.name,
                status: STATUS_VALUES.SUCCESS,
                duration,
            });

            log('DEBUG', `[SHUTDOWN] ${phase.name} concluído em ${duration}ms`);
        } catch (error) {
            const duration = Date.now() - phaseStartTime;
            failedPhases++;

            phases.push({
                name: phase.name,
                status: STATUS_VALUES.FAILED,
                duration,
                error: error.message,
            });

            log('ERROR', `[SHUTDOWN] Falha em ${phase.name}: ${error.message}`);
        }
    }

    const shutdownDuration = Date.now() - shutdownStartTime;
    const successCount = phases.filter(p => p.status === STATUS_VALUES.SUCCESS).length;

    // Remove signal handlers ao final para evitar janela de fallback para signal default
    // enquanto o shutdown coordenado ainda está em execução.
    cleanupSignalHandlers();

    if (failedPhases === 0) {
        log('INFO', `[SHUTDOWN] ✅ Shutdown completo: ${successCount}/${total} fases OK em ${shutdownDuration}ms`);
        if (exitOnComplete) {
            process.exit(0);
        }
        return {
            ok: true,
            failedPhases: 0,
            totalPhases: total,
            duration: shutdownDuration,
        };
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

    if (exitOnComplete) {
        process.exit(1);
    }
    return {
        ok: false,
        failedPhases,
        totalPhases: total,
        duration: shutdownDuration,
    };
}

/* ==========================================================================
   SIGNAL HANDLERS — CANONICAL (SINGLE SHUTDOWN PATH)
========================================================================== */

/**
 * Exclusão mútua global para prevenir shutdown concorrente.
 * Usando Promise em vez de boolean para evitar race conditions.
 */
let _shutdownPromise = null;

/**
 * Armazena referências dos signal handlers para cleanup
 */
const _signalHandlers = {
    sigterm: null,
    sigint: null,
    sigusr2: null,
    sigquit: null,
    sigbreak: null,
    sigpipe: null,
    sigchld: null,
    sighup: null,
    uncaughtException: null,
    unhandledRejection: null,
};

/**
 * Remove todos os signal handlers (cleanup no shutdown)
 */
/**
 * Remove todos os signal handlers registrados.
 *
 * Limpa handlers para SIGINT, SIGTERM, SIGHUP, SIGUSR2, SIGQUIT/SIGBREAK
 * e sinais opcionais de subprocesso (SIGPIPE/SIGCHLD).
 * Essencial para evitar memory leaks e comportamento inesperado
 * durante shutdown ou reinicialização.
 *
 * @returns {void}
 *
 * @sideEffects
 * - Remove signal handlers do processo
 * - Não afeta outros event listeners
 */
function cleanupSignalHandlers() {
    try {
        if (_signalHandlers.sigterm) {
            process.removeListener('SIGTERM', _signalHandlers.sigterm);
            _signalHandlers.sigterm = null;
        }
        if (_signalHandlers.sigint) {
            process.removeListener('SIGINT', _signalHandlers.sigint);
            _signalHandlers.sigint = null;
        }
        if (_signalHandlers.sighup) {
            process.removeListener('SIGHUP', _signalHandlers.sighup);
            _signalHandlers.sighup = null;
        }
        if (_signalHandlers.sigusr2) {
            process.removeListener('SIGUSR2', _signalHandlers.sigusr2);
            _signalHandlers.sigusr2 = null;
        }
        if (_signalHandlers.sigquit) {
            process.removeListener('SIGQUIT', _signalHandlers.sigquit);
            _signalHandlers.sigquit = null;
        }
        if (_signalHandlers.sigbreak) {
            process.removeListener('SIGBREAK', _signalHandlers.sigbreak);
            _signalHandlers.sigbreak = null;
        }
        if (_signalHandlers.sigpipe) {
            process.removeListener('SIGPIPE', _signalHandlers.sigpipe);
            _signalHandlers.sigpipe = null;
        }
        if (_signalHandlers.sigchld) {
            process.removeListener('SIGCHLD', _signalHandlers.sigchld);
            _signalHandlers.sigchld = null;
        }
        if (_signalHandlers.uncaughtException) {
            process.removeListener('uncaughtException', _signalHandlers.uncaughtException);
            _signalHandlers.uncaughtException = null;
        }
        if (_signalHandlers.unhandledRejection) {
            process.removeListener('unhandledRejection', _signalHandlers.unhandledRejection);
            _signalHandlers.unhandledRejection = null;
        }
        log('DEBUG', '[SHUTDOWN] Signal handlers removidos');
    } catch (err) {
        log('WARN', `[SHUTDOWN] Erro ao remover signal handlers: ${err.message}`);
    }
}

/**
 * Configura handlers de sinais e falhas fatais.
 * Shutdown sempre passa pelo coordenador único.
 */
/**
 * Registra signal handlers para graceful shutdown.
 *
 * Handlers registrados:
 * - SIGINT (Ctrl+C): Inicia shutdown gracioso
 * - SIGTERM: Inicia shutdown gracioso
 * - SIGQUIT (POSIX): Inicia shutdown gracioso
 * - SIGBREAK (Windows): Inicia shutdown gracioso
 * - SIGPIPE (POSIX): Ignora pipe quebrado sem encerrar processo
 * - SIGCHLD (POSIX): Observa ciclo de subprocessos sem encerrar processo
 * - SIGHUP: Inicia shutdown gracioso (terminal hangup)
 * - SIGUSR2: Inicia shutdown gracioso (PM2 graceful reload)
 *
 * @param {object} context - Contexto de runtime retornado por boot()
 * @returns {void}
 *
 * @sideEffects
 * - Registra signal handlers no processo
 * - Pode sobrescrever handlers existentes
 */
function setupSignalHandlers(context) {
    const registerOptionalSignal = (signal, key, handler) => {
        try {
            process.on(signal, handler);
            _signalHandlers[key] = handler;
        } catch (err) {
            _signalHandlers[key] = null;
            log('DEBUG', `[SIGNAL] ${signal} não suportado nesta plataforma: ${err.message}`);
        }
    };

    const triggerShutdown = async (reason, meta = {}) => {
        // Se já há shutdown em andamento, retorna a mesma Promise
        if (_shutdownPromise) {
            log('WARN', `[SIGNAL] ${reason} ignorado — shutdown já em andamento, aguardando conclusão...`);
            return _shutdownPromise;
        }

        // Cria Promise de shutdown (garante que múltiplos signals aguardam o mesmo shutdown)
        _shutdownPromise = (async () => {
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
                const result = await shutdown(context, { exitOnComplete: false });
                process.exit(result?.ok ? 0 : 1);
            } catch (err) {
                log('FATAL', `[SIGNAL] Falha durante shutdown: ${err.message}`);
                process.exit(1);
            }
        })();

        return _shutdownPromise;
    };

    /* -----------------------------------------------------------
       Sinais de término operacional
    ----------------------------------------------------------- */

    _signalHandlers.sigterm = () => triggerShutdown('SIGTERM');
    _signalHandlers.sigint = () => triggerShutdown('SIGINT');
    _signalHandlers.sigusr2 = () => triggerShutdown('SIGUSR2');
    _signalHandlers.sigquit = () => triggerShutdown('SIGQUIT');
    _signalHandlers.sigbreak = () => triggerShutdown('SIGBREAK');

    process.on('SIGTERM', _signalHandlers.sigterm);
    process.on('SIGINT', _signalHandlers.sigint);
    registerOptionalSignal('SIGUSR2', 'sigusr2', _signalHandlers.sigusr2);
    if (process.platform === 'win32') {
        process.on('SIGBREAK', _signalHandlers.sigbreak);
    } else {
        process.on('SIGQUIT', _signalHandlers.sigquit);
    }

    /* -----------------------------------------------------------
       Sinais opcionais de subprocesso (não encerram processo)
    ----------------------------------------------------------- */

    _signalHandlers.sigpipe = () => {
        if (_shutdownPromise) {
            return;
        }
        log('DEBUG', '[SIGNAL] SIGPIPE recebido — ignorando para manter processo ativo');
    };

    _signalHandlers.sigchld = () => {
        if (_shutdownPromise) {
            return;
        }
        log('DEBUG', '[SIGNAL] SIGCHLD recebido — subprocesso finalizado');
    };

    if (process.platform === 'win32') {
        _signalHandlers.sigpipe = null;
        _signalHandlers.sigchld = null;
    } else {
        registerOptionalSignal('SIGPIPE', 'sigpipe', _signalHandlers.sigpipe);
        registerOptionalSignal('SIGCHLD', 'sigchld', _signalHandlers.sigchld);
    }

    /* -----------------------------------------------------------
       Reload de configuração (não encerra)
    ----------------------------------------------------------- */

    _signalHandlers.sighup = async () => {
        if (_shutdownPromise) {
            log('WARN', '[SIGNAL] SIGHUP ignorado — shutdown em andamento');
            return;
        }

        try {
            log('INFO', '[SIGNAL] SIGHUP — reload de configuração');

            // BUG-012: Adiciona timeout no reload
            const CONFIG_RELOAD_TIMEOUT_MS = Number(process.env.CONFIG_RELOAD_TIMEOUT_MS ?? 5000);
            const reloadPromise = CONFIG.reload('sys-sighup');
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(
                    () => reject(new Error(`CONFIG reload timeout após ${CONFIG_RELOAD_TIMEOUT_MS}ms`)),
                    CONFIG_RELOAD_TIMEOUT_MS
                )
            );

            await Promise.race([reloadPromise, timeoutPromise]);
            log('INFO', '[SIGNAL] Configuração recarregada');
        } catch (err) {
            log('ERROR', `[SIGNAL] Reload falhou: ${err.message}`);
        }
    };

    registerOptionalSignal('SIGHUP', 'sighup', _signalHandlers.sighup);

    /* -----------------------------------------------------------
       Falhas fatais — crash path coordenado
    ----------------------------------------------------------- */

    _signalHandlers.uncaughtException = error => {
        log('FATAL', `[CRASH] Uncaught Exception: ${error.message}`);
        log('ERROR', `[CRASH] Stack: ${error.stack}`);

        triggerShutdown('uncaught-exception', { error });
    };

    _signalHandlers.unhandledRejection = (reason, promise) => {
        log('FATAL', `[CRASH] Unhandled Rejection: ${reason}`);
        log('ERROR', `[CRASH] Promise: ${promise}`);

        const error = reason instanceof Error ? reason : new Error(String(reason));

        triggerShutdown('unhandled-rejection', { error });
    };

    process.on('uncaughtException', _signalHandlers.uncaughtException);
    process.on('unhandledRejection', _signalHandlers.unhandledRejection);
}

function __resetShutdownStateForTests() {
    _shutdownPromise = null;
}

/**
 * Hooks de teste do entrypoint principal.
 * Expostos para regressões de lifecycle/sinais sem acionar bootstrap real do processo.
 */
const __mainTestHooks = Object.freeze({
    setupSignalHandlers,
    cleanupSignalHandlers,
    resetShutdownState: __resetShutdownStateForTests,
    getShutdownPromise: () => _shutdownPromise,
    getSignalHandlers: () => _signalHandlers,
    connectSplitExternalWithRetry,
});

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
/**
 * Ponto de entrada principal do sistema Maestro.
 *
 * Sequência de execução:
 * 1. Validação de argumentos CLI
 * 2. Boot do sistema (6 fases)
 * 3. Setup de signal handlers
 * 4. Aguarda sinais de shutdown
 * 5. Executa shutdown gracioso
 * 6. Exit com código apropriado
 *
 * @async
 * @returns {Promise<void>}
 *
 * @throws {Error} Se boot falhar ou shutdown for forçado
 *
 * @sideEffects
 * - Inicializa sistema completo
 * - Registra signal handlers globais
 * - Process.exit() ao final
 */
async function main() {
    try {
        log(
            'INFO',
            `
    ╔═══════════════════════════════════════════════════════════════╗
    ║                                                               ║
    ║   MAESTRO SINGULARITY EDITION                                 ║
    ║   Autonomous AI Agent - Universal LLM Orchestrator            ║
    ║   Version: 2.0.0 (NERV Architecture)                          ║
    ║                                                               ║
    ╚═══════════════════════════════════════════════════════════════╝
        `
        );

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
        // Diagnóstico síncrono para cenários em que o processo encerra antes de flush de logs.
        console.error('[MAIN_FATAL_SYNC]', error && error.stack ? error.stack : error);
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
   EXECUÇÃO CONDICIONAL — COMPATIBILITY LAYER
========================================================================== */

const __shouldBootstrap = shouldAutobootEntrypoint({
    importMetaUrl: import.meta.url,
    explicitAutostartEnv: 'MAESTRO_ENTRY_AUTOSTART',
    allowPm2ExecPathMatch: false,
});

if (__shouldBootstrap && !globalThis.__MISSION_CONTROL_BOOTSTRAPPED__) {
    globalThis.__MISSION_CONTROL_BOOTSTRAPPED__ = true;
    main().catch(err => {
        log('FATAL', `[MAIN] Entrypoint main falhou: ${err.message}`);
        process.exit(1);
    });
}

export { boot, main, resolveServerMode, shutdown, __mainTestHooks };

// Compatibility exports for server integration
export { main as maestroBootstrap };
