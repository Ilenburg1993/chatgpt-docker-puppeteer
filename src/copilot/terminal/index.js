// @ts-check
/**
 * src/copilot/terminal/index.js
 *
 * Ponto de entrada do Terminal Permanente LLM-B.
 *
 * Orquestra a inicialização sequencial de todos os subsistemas:
 *
 * 1. Carrega aliases customizados
 * 2. Cria o servidor HTTP/Socket canônico via `server/index.js`
 * 3. Cria hub_session no ConversationStore (best-effort)
 * 4. Registra watchdogs e listeners de eventos do AlwaysAliveAgent
 * 5. Ativa o reflection loop periódico (se configurado)
 * 6. Inicia o REPL readline (via `repl.js`)
 *
 * @module copilot/terminal
 * @see EventBus
 */

import { readCopilotBootConfig } from '#copilot/boot';
import { LLM_B_REFLECTION_INTERVAL_MIN } from '#copilot/config';
import {
    bridgeEmitter,
    EVENT_BUS,
    getSharedSdkSessionId,
    registerShutdownHandler,
    SHUTDOWN_PRIORITY,
    toError,
} from '#copilot/core';
import { CONFIG_PINNED_FILES_CHANGED } from '#copilot/events';
import { log } from '#copilot/observability';
import { getMcpStatus } from '../bridges/mcp-tool-bridge.js';
import { PinnedFilesLoader } from '../config/pinned-files.js';
import { container } from '../core/di-container.js';
import { registerTimer } from '../core/timer-registry.js';
import { getHubSessionId, setHubSessionId } from '../presentation/runtime-ui-state-store.js';
import { recordTerminalActivity, terminalActivityEmitter } from './activity-state.js';
import { loadAliasesAsync } from './alias-store.js';
import { broadcastSse, println, sendTurn } from './dialog/index.js';
import {
    attachTerminalHubSocketIO,
    createTerminalHubSession,
    initTerminalConversationHub,
    isTerminalHubReady,
    readTerminalHubOrchestrator,
    readTerminalHubStore,
    readTerminalRuntimeState,
} from './frontend/llm-b-runtime.js';
import { startRepl } from './repl.js';
import { registerAgentEventListeners } from './terminal-agent-wiring.js';

/**
 * F10.3: Imprime o banner de diagnóstico do modo de operação do terminal host.
 *
 * Útil para o usuário do terminal saber se o MCP externo está disponível. O servidor HTTP local continua sendo sempre
 * `server/index.js`; não há mais `terminal/server.js`.
 *
 * @returns {void}
 */
/**
 * @param {{
 *     serverUrl: string;
 *     bootPreflight?: import('../agent/lifecycle/runtime-host.js').CopilotSdkBootPreflightReport | null;
 * }} opts
 * @returns {void}
 */
function printStandaloneBanner(opts) {
    const mcp = getMcpStatus();
    const isStandalone = !mcp.available;
    const serverUrl = opts.serverUrl;
    const bootPreflight = opts.bootPreflight ?? null;
    const lines = [
        '',
        '┌─────────────────────────────────────────────────────────────┐',
        '│  Terminal Permanente LLM-B                                  │',
        isStandalone
            ? '│  Modo: STANDALONE  (server 3008 não detectado)              │'
            : `│  Modo: CONECTADO   (MCP: ${String(mcp.toolCount).padEnd(2)} tools via :3008)              │`,
        `│  Inject server: ${serverUrl.padEnd(40).slice(0, 40)} │`,
        '│  Comandos: /help  /status  /skills  /ask                   │',
        '└─────────────────────────────────────────────────────────────┘',
        '',
    ];
    for (const line of lines) println(line);
    if (isStandalone) {
        println('  ⚠  MCP tools indisponíveis — tools locais ativas. Inicie src/server para habilitar.');
        println('');
    }
    if (bootPreflight && bootPreflight.warnings.length > 0) {
        println(`  ⚠  Preflight SDK: ${bootPreflight.warnings[0]}`);
        println('');
    }
}

// T-20: armazenar referência do reflectionTimer em escopo de módulo para permitir cancelamento
/** @type {ReturnType<typeof setInterval> | null} */
let _reflectionTimer = null;

/** @type {boolean} */
let _sighupHandlerRegistered = false;

/**
 * @typedef {import('../server/index.js').CopilotServerOptions} TerminalCopilotServerOptions
 *
 * @typedef {import('../server/index.js').CopilotServer} TerminalCopilotServer
 *
 * @typedef {object} TerminalServerStartDeps
 * @property {(opts?: TerminalCopilotServerOptions) => Promise<TerminalCopilotServer>} startCopilotServer
 *
 * @typedef {object} TerminalServerStartOptions
 * @property {TerminalServerStartDeps['startCopilotServer']} [startCopilotServer]
 * @property {() => void} [wireRuntime]
 * @property {() => NodeJS.Timeout} [startTodoCleanupJob]
 * @property {ReturnType<import('#copilot/boot').readCopilotBootConfig>} [bootConfig]
 * @property {import('../agent/lifecycle/runtime-host.js').CopilotSdkBootPreflightReport} [bootPreflight]
 *
 * @typedef {object} TerminalBootContext
 * @property {TerminalServerStartDeps['startCopilotServer']} startCopilotServer
 * @property {() => void} wireRuntime
 * @property {() => NodeJS.Timeout} startTodoCleanupJob
 * @property {ReturnType<import('#copilot/boot').readCopilotBootConfig>} bootConfig
 * @property {import('../agent/lifecycle/runtime-host.js').CopilotSdkBootPreflightReport | null} bootPreflight
 * @property {PinnedFilesLoader | null} pinnedLoader
 * @property {(() => void) | null} disposePinnedBridge
 * @property {((evt: { file: string; type: string }) => void) | null} pinnedFilesChangedHandler
 * @property {((
 *           current: import('./activity-state.js').TerminalActivitySnapshot,
 *           previous?: import('./activity-state.js').TerminalActivitySnapshot,
 *       ) => void)
 *     | null} activityChangedHandler
 * @property {((
 *           activity: import('./activity-state.js').TerminalActivitySnapshot,
 *           previous?: import('./activity-state.js').TerminalActivitySnapshot,
 *       ) => void)
 *     | null} terminalActivityChangedHandler
 * @property {TerminalCopilotServer | null} copilotServer
 */

/**
 * Ativa o reflection loop periódico se `LLM_B_REFLECTION_INTERVAL_MIN` > 0.
 *
 * @returns {void}
 */
function startReflectionLoop() {
    const reflectionIntervalMin = LLM_B_REFLECTION_INTERVAL_MIN;
    if (reflectionIntervalMin <= 0) return;

    const reflectionIntervalMs = reflectionIntervalMin * 60 * 1000;
    log('INFO', `[TerminalServer] Reflection loop ativado: a cada ${reflectionIntervalMin}min.`);

    const runReflection = () => {
        const runtimeState = readTerminalRuntimeState();
        if (!runtimeState.dialogLoopActive) return;
        // ARCH-07 (fix): skip reflection se fila já tem tarefas para evitar acúmulo
        if (runtimeState.queueSize > 0) {
            log('INFO', '[TerminalServer] Reflection loop pulado — fila ocupada.');
            return;
        }
        log('INFO', '[TerminalServer] Executando reflection loop…');
        sendTurn(
            '[REFLEXÃO] Faça uma breve reflexão sobre as últimas mensagens desta conversa: o que foi discutido, o que está pendente, e se você tem alguma sugestão ou insight que ainda não mencionou. Seja conciso.',
            'llm-a',
        ).catch((e) => log('WARN', `[TerminalServer] Reflection loop falhou: ${e.message}`));
    };

    // T-20: armazenar referência em variável de módulo para permitir cancelamento no graceful shutdown
    // F153: registrar no timer-registry para cleanup automático via shutdown handler centralizado
    _reflectionTimer = setInterval(runReflection, reflectionIntervalMs);
    if (typeof _reflectionTimer.unref === 'function') _reflectionTimer.unref();
    registerTimer('terminal.reflection', 'interval', _reflectionTimer);
}

/**
 * Cria o contexto transacional das fases do terminal. Nenhum recurso externo é alocado aqui.
 *
 * @param {TerminalServerStartOptions} [options]
 * @returns {TerminalBootContext}
 */
export function createTerminalBootContext(options = {}) {
    if (typeof options.startCopilotServer !== 'function') {
        throw new TypeError('[TerminalServer] startCopilotServer dependency is required by the composition root.');
    }
    if (typeof options.wireRuntime !== 'function') {
        throw new TypeError('[TerminalServer] wireRuntime dependency is required by the composition root.');
    }
    if (typeof options.startTodoCleanupJob !== 'function') {
        throw new TypeError('[TerminalServer] startTodoCleanupJob dependency is required by the composition root.');
    }
    return {
        startCopilotServer: options.startCopilotServer,
        wireRuntime: options.wireRuntime,
        startTodoCleanupJob: options.startTodoCleanupJob,
        bootConfig: options.bootConfig ?? readCopilotBootConfig(),
        bootPreflight: options.bootPreflight ?? null,
        pinnedLoader: null,
        disposePinnedBridge: null,
        pinnedFilesChangedHandler: null,
        activityChangedHandler: null,
        terminalActivityChangedHandler: null,
        copilotServer: null,
    };
}

/**
 * @param {TerminalBootContext} ctx
 * @returns {Promise<void>}
 */
export async function runTerminalInitPhase(ctx) {
    recordTerminalActivity('boot', 'Inicializando terminal', {
        detail: 'Preparando aliases, DI, hub e servidor HTTP',
        source: 'terminal',
    });
    log('INFO', '[TerminalServer] Iniciando terminal permanente LLM-B…');
    void ctx;
}

/**
 * @param {TerminalBootContext} ctx
 * @returns {Promise<void>}
 */
export async function runTerminalAliasesPhase(ctx) {
    recordTerminalActivity('boot', 'Carregando aliases', { source: 'terminal', recordHistory: false });
    await loadAliasesAsync();
    void ctx;
}

/**
 * @param {TerminalBootContext} ctx
 * @returns {Promise<void>}
 */
export async function runTerminalRuntimeConfigPhase(ctx) {
    recordTerminalActivity('boot', 'Configurando runtime Copilot', { source: 'terminal', recordHistory: false });
    ctx.wireRuntime();
    if (ctx.bootPreflight) {
        recordTerminalActivity('boot', 'Executando preflight SDK', {
            detail: ctx.bootPreflight.pingOk ? 'CLI acessível' : 'CLI indisponível ou sem resposta',
            severity: ctx.bootPreflight.ok ? 'info' : 'warn',
            source: 'terminal',
            recordHistory: false,
        });
    }
}

/**
 * @param {TerminalBootContext} ctx
 * @returns {Promise<void>}
 */
export async function runTerminalPinnedContextPhase(ctx) {
    const pinnedLoader = new PinnedFilesLoader(ctx.bootConfig.skills.pinnedContextDirectories);
    ctx.pinnedLoader = pinnedLoader;
    recordTerminalActivity('boot', 'Carregando arquivos pinados', { source: 'terminal', recordHistory: false });
    await pinnedLoader.start().catch((e) => {
        recordTerminalActivity('system', 'Pinned files indisponíveis', {
            detail: e.message,
            severity: 'warn',
            source: 'terminal',
        });
        log('WARN', `[TerminalServer] PinnedFilesLoader não pôde iniciar: ${e.message}`);
    });

    const pinnedBus = container.resolve(EVENT_BUS);
    ctx.disposePinnedBridge = pinnedBus
        ? bridgeEmitter(pinnedLoader, pinnedBus, { changed: CONFIG_PINNED_FILES_CHANGED })
        : null;
    ctx.pinnedFilesChangedHandler = (/** @type {{ file: string; type: string }} */ evt) => {
        const updatedAt = new Date().toISOString();
        const fileCount = pinnedLoader.getFiles().length;
        log(
            'WARN',
            `[TerminalServer] Skills/instruções atualizadas — hot-reload ativo (${fileCount} arquivo(s), trigger: ${evt?.file ?? 'unknown'})`,
        );
        broadcastSse('skills.reloaded', {
            updatedAt,
            fileCount,
            trigger: evt?.file ?? null,
            type: evt?.type ?? 'change',
            note: 'Context refreshed. Next session turn will use updated skills/instructions.',
        });
    };
    pinnedLoader.on('changed', ctx.pinnedFilesChangedHandler);

    ctx.activityChangedHandler = (current, previous) => {
        broadcastSse('activity.changed', {
            current,
            previous: previous ?? null,
            timestamp: Date.now(),
        });
    };
    terminalActivityEmitter.on('activity:changed', ctx.activityChangedHandler);
}

/**
 * @param {TerminalBootContext} ctx
 * @returns {Promise<void>}
 */
export async function runTerminalConversationHubPhase(ctx) {
    try {
        recordTerminalActivity('boot', 'Inicializando conversation hub', { source: 'terminal', recordHistory: false });
        await initTerminalConversationHub();
        const sdkSessionId = getSharedSdkSessionId();
        const hubSessionId = createTerminalHubSession({
            title: 'Terminal Permanente LLM-B',
            ...(sdkSessionId ? { sdkSessionId } : {}),
            metadata: { source: 'terminal-server', startedAt: new Date().toISOString() },
        });
        setHubSessionId(hubSessionId);
        log('INFO', `[TerminalServer] Hub session criada: ${hubSessionId}`);
    } catch (e) {
        recordTerminalActivity('system', 'Hub storage indisponível', {
            detail: toError(e).message,
            severity: 'warn',
            source: 'terminal',
        });
        log('WARN', `[TerminalServer] Hub storage indisponível, continua sem persistência: ${toError(e).message}`);
    }
    void ctx;
}

/**
 * @param {TerminalBootContext} ctx
 * @returns {Promise<void>}
 */
export async function runTerminalHttpServerPhase(ctx) {
    const hubReady = isTerminalHubReady();
    /** @type {TerminalCopilotServerOptions} */
    const serverOpts = {
        host: ctx.bootConfig.server.host,
        port: ctx.bootConfig.server.port,
    };
    if (ctx.bootConfig.server.token !== null) serverOpts.token = ctx.bootConfig.server.token;
    if (hubReady) {
        serverOpts.orchestrator = readTerminalHubOrchestrator();
        serverOpts.store = readTerminalHubStore();
    }
    recordTerminalActivity('boot', 'Subindo servidor copilot', { source: 'terminal', recordHistory: false });
    ctx.copilotServer = await ctx.startCopilotServer(serverOpts);
}

/**
 * @param {TerminalBootContext} ctx
 * @returns {Promise<void>}
 */
export async function runTerminalRuntimeListenersPhase(ctx) {
    const copilotServer = requireTerminalCopilotServer(ctx);
    registerAgentEventListeners(() =>
        printStandaloneBanner({ serverUrl: ctx.bootConfig.server.url, bootPreflight: ctx.bootPreflight }),
    );
    startReflectionLoop();

    ctx.terminalActivityChangedHandler = (activity) => {
        broadcastSse('terminal.activity', activity);
    };
    terminalActivityEmitter.on('activity:changed', ctx.terminalActivityChangedHandler);

    const todoCleanupTimer = ctx.startTodoCleanupJob();
    if (typeof todoCleanupTimer.unref === 'function') todoCleanupTimer.unref();
    registerTimer('terminal.todoCleanup', 'interval', todoCleanupTimer);

    registerTerminalShutdownHandlers(ctx);

    if (copilotServer.io && isTerminalHubReady()) {
        attachTerminalHubSocketIO(copilotServer.io);
    }

    if (!_sighupHandlerRegistered) {
        process.on('SIGHUP', () => {
            log('INFO', '[TerminalServer] SIGHUP recebido — mantendo inject server ativo (painel reaberto).');
        });
        _sighupHandlerRegistered = true;
    }

    broadcastSse('terminal.started', {
        timestamp: Date.now(),
        operationMode: (() => {
            const s = getMcpStatus();
            return s.available && s.toolCount > 0 && !s.circuitOpen ? 'connected' : 'standalone';
        })(),
        mcpToolCount: getMcpStatus().toolCount,
        hubSessionId: getHubSessionId(),
        dialogLoopActive: readTerminalRuntimeState().dialogLoopActive,
        model: readTerminalRuntimeState().model,
        bootPreflight: ctx.bootPreflight,
    });
    log('INFO', '[TerminalServer] terminal.started emitido.');
}

/**
 * @param {TerminalBootContext} ctx
 * @returns {Promise<void>}
 */
export async function runTerminalReplPhase(ctx) {
    const copilotServer = requireTerminalCopilotServer(ctx);
    await startRepl(copilotServer.httpServer);
}

/**
 * @param {TerminalBootContext} ctx
 * @returns {TerminalCopilotServer}
 */
function requireTerminalCopilotServer(ctx) {
    if (!ctx.copilotServer) {
        throw new Error('[TerminalServer] copilot-http-server phase has not completed.');
    }
    return ctx.copilotServer;
}

/**
 * @param {TerminalBootContext} ctx
 * @returns {void}
 */
function registerTerminalShutdownHandlers(ctx) {
    registerShutdownHandler(
        'terminal.reflectionTimer',
        async () => {
            if (_reflectionTimer !== null) {
                clearInterval(_reflectionTimer);
                _reflectionTimer = null;
            }
            log('INFO', '[TerminalServer] Reflection timer cancelado via shutdown handler.');
        },
        SHUTDOWN_PRIORITY.RUNTIME_CRITICAL,
    );

    registerShutdownHandler(
        'terminal.pinnedFilesLoader',
        async () => {
            const pinnedLoader = ctx.pinnedLoader;
            ctx.disposePinnedBridge?.();
            if (ctx.activityChangedHandler) {
                terminalActivityEmitter.off('activity:changed', ctx.activityChangedHandler);
            }
            if (pinnedLoader && ctx.pinnedFilesChangedHandler) {
                if (typeof pinnedLoader.off === 'function') {
                    pinnedLoader.off('changed', ctx.pinnedFilesChangedHandler);
                } else {
                    pinnedLoader.removeListener('changed', ctx.pinnedFilesChangedHandler);
                }
            }
            if (pinnedLoader && typeof pinnedLoader.stop === 'function') {
                await Promise.resolve(pinnedLoader.stop());
            }
            log('INFO', '[TerminalServer] PinnedFilesLoader desligado via shutdown handler.');
        },
        SHUTDOWN_PRIORITY.TERMINAL_RESOURCE,
    );

    registerShutdownHandler(
        'terminal.activityEmitter',
        async () => {
            if (ctx.terminalActivityChangedHandler) {
                terminalActivityEmitter.off('activity:changed', ctx.terminalActivityChangedHandler);
            }
            log('INFO', '[TerminalServer] Activity emitter desacoplado via shutdown handler.');
        },
        SHUTDOWN_PRIORITY.TERMINAL_ACTIVITY,
    );
}

/**
 * Inicia o Terminal Permanente LLM-B.
 *
 * @param {TerminalServerStartOptions} [options]
 * @returns {Promise<void>}
 */
export async function startTerminalServer(options = {}) {
    const ctx = createTerminalBootContext(options);
    await runTerminalInitPhase(ctx);
    await runTerminalAliasesPhase(ctx);
    await runTerminalRuntimeConfigPhase(ctx);
    await runTerminalPinnedContextPhase(ctx);
    await runTerminalConversationHubPhase(ctx);
    await runTerminalHttpServerPhase(ctx);
    await runTerminalRuntimeListenersPhase(ctx);
    await runTerminalReplPhase(ctx);
}
