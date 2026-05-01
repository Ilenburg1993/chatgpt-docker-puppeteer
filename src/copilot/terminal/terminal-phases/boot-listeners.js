// @ts-check
/**
 * @module copilot/terminal/terminal-phases/boot-listeners
 * @file Fase de boot: runtime listeners, reflection loop, shutdown handlers e banner.
 *
 *   Responsabilidades:
 *
 *   - Exibir banner de modo de operação (standalone vs conectado)
 *   - Registrar listeners de eventos do AgentRuntime
 *   - Ativar o reflection loop periódico
 *   - Registrar handlers de shutdown centralizados
 *   - Acoplar Socket.IO ao hub quando disponível
 *   - Emitir evento `terminal.started` via SSE
 */

import { LLM_B_REFLECTION_INTERVAL_MIN } from '#copilot/config';
import { registerShutdownHandler, SHUTDOWN_PRIORITY } from '#copilot/core';
import { log } from '#copilot/observability';
import { getMcpStatus } from '../../bridges/mcp-tool-bridge.js';
import { cancel as cancelTimer, registerTimer } from '../../core/timer-registry.js';
import { getHubSessionId } from '../../presentation/runtime-ui-state-store.js';
import { terminalActivityEmitter } from '../activity-state.js';
import { broadcastSse, println, sendTurn } from '../dialog/index.js';
import { readTerminalRuntimeState } from '../frontend/gateways/agent-runtime.js';
import { attachTerminalHubSocketIO, isTerminalHubReady } from '../frontend/gateways/hub.js';
import { registerAgentEventListeners } from '../terminal-agent-wiring.js';
import { rollbackTerminalPinnedContextPhase } from './boot-pinned.js';

// ---------------------------------------------------------------------------
// Module-scoped state (timer references que precisam ser limpas no shutdown)
// ---------------------------------------------------------------------------

/** @type {ReturnType<typeof setInterval> | null} */
let _reflectionTimer = null;

/** @type {boolean} */
let _sighupHandlerRegistered = false;

/** @type {(() => void) | null} */
let _sighupHandler = null;

// ---------------------------------------------------------------------------
// Banner
// ---------------------------------------------------------------------------

/**
 * Imprime o banner de diagnóstico do modo de operação do terminal host.
 *
 * @param {{
 *     serverUrl: string;
 *     bootPreflight?:
 *         | import('../../agent/lifecycle/process-host/runtime-host.js').CopilotSdkBootPreflightReport
 *         | null;
 * }} opts
 * @returns {void}
 */
export function printStandaloneBanner(opts) {
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

// ---------------------------------------------------------------------------
// Reflection loop
// ---------------------------------------------------------------------------

/**
 * Ativa o reflection loop periódico se `LLM_B_REFLECTION_INTERVAL_MIN` > 0.
 *
 * @returns {void}
 */
export function startReflectionLoop() {
    const reflectionIntervalMin = LLM_B_REFLECTION_INTERVAL_MIN;
    if (reflectionIntervalMin <= 0) return;

    const reflectionIntervalMs = reflectionIntervalMin * 60 * 1000;
    log('INFO', `[TerminalServer] Reflection loop ativado: a cada ${reflectionIntervalMin}min.`);

    const runReflection = () => {
        const runtimeState = readTerminalRuntimeState();
        if (!runtimeState.dialogLoopActive) return;
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

    _reflectionTimer = setInterval(runReflection, reflectionIntervalMs);
    if (typeof _reflectionTimer.unref === 'function') _reflectionTimer.unref();
    registerTimer('terminal.reflection', 'interval', _reflectionTimer);
}

// ---------------------------------------------------------------------------
// Rollback
// ---------------------------------------------------------------------------

/**
 * Cancela o reflection timer e o SIGHUP handler do módulo.
 *
 * @param {import('../index.js').TerminalBootContext} ctx
 * @returns {Promise<void>}
 */
export async function rollbackTerminalRuntimeListenersPhase(ctx) {
    if (_reflectionTimer !== null) {
        clearInterval(_reflectionTimer);
        cancelTimer('terminal.reflection');
        _reflectionTimer = null;
    }
    if (ctx.todoCleanupTimer !== null) {
        clearInterval(ctx.todoCleanupTimer);
        cancelTimer('terminal.todoCleanup');
        ctx.todoCleanupTimer = null;
    }
    if (ctx.terminalActivityChangedHandler) {
        terminalActivityEmitter.off('activity:changed', ctx.terminalActivityChangedHandler);
        ctx.terminalActivityChangedHandler = null;
    }
    if (_sighupHandlerRegistered && _sighupHandler) {
        process.off('SIGHUP', _sighupHandler);
        _sighupHandler = null;
        _sighupHandlerRegistered = false;
    }
}

// ---------------------------------------------------------------------------
// Shutdown handlers registry
// ---------------------------------------------------------------------------

/**
 * @param {import('../index.js').TerminalBootContext} ctx
 * @returns {void}
 */
function registerTerminalShutdownHandlers(ctx) {
    registerShutdownHandler(
        'terminal.reflectionTimer',
        async () => {
            await rollbackTerminalRuntimeListenersPhase(ctx);
            log('INFO', '[TerminalServer] Reflection timer cancelado via shutdown handler.');
        },
        SHUTDOWN_PRIORITY.RUNTIME_CRITICAL,
    );

    registerShutdownHandler(
        'terminal.pinnedFilesLoader',
        async () => {
            await rollbackTerminalPinnedContextPhase(ctx);
            log('INFO', '[TerminalServer] PinnedFilesLoader desligado via shutdown handler.');
        },
        SHUTDOWN_PRIORITY.TERMINAL_RESOURCE,
    );

    registerShutdownHandler(
        'terminal.activityEmitter',
        async () => {
            await rollbackTerminalRuntimeListenersPhase(ctx);
            log('INFO', '[TerminalServer] Activity emitter desacoplado via shutdown handler.');
        },
        SHUTDOWN_PRIORITY.TERMINAL_ACTIVITY,
    );
}

// ---------------------------------------------------------------------------
// Phase
// ---------------------------------------------------------------------------

/**
 * @param {import('../index.js').TerminalBootContext} ctx
 * @returns {Promise<void>}
 */
export async function runTerminalRuntimeListenersPhase(ctx) {
    const copilotServer = ctx.copilotServer;
    if (!copilotServer) {
        throw new Error('[TerminalServer] copilot-http-server phase has not completed.');
    }
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
    ctx.todoCleanupTimer = todoCleanupTimer;
    registerTimer('terminal.todoCleanup', 'interval', todoCleanupTimer);

    registerTerminalShutdownHandlers(ctx);

    if (copilotServer.io && isTerminalHubReady()) {
        attachTerminalHubSocketIO(copilotServer.io);
    }

    if (!_sighupHandlerRegistered) {
        _sighupHandler = () => {
            log('INFO', '[TerminalServer] SIGHUP recebido — mantendo inject server ativo (painel reaberto).');
        };
        process.on('SIGHUP', _sighupHandler);
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
