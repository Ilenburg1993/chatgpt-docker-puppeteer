// @ts-check
/**
 * @module copilot/terminal/terminal-phases/boot-listeners
 * @file Fase de boot: runtime listeners e broadcast do estado operacional.
 *
 *   Responsabilidades:
 *
 *   - Registrar listeners de eventos do AgentRuntime
 *   - Acoplar Socket.IO ao hub quando disponível
 *   - Emitir evento `terminal.started` via SSE
 */

import { getMcpStatus } from '#copilot/bridges';
import { log } from '#copilot/observability';
import { cancel as cancelTimer, registerTimer } from '../../core/timer-registry.js';
import { getHubSessionId } from '../../presentation/state/index.js';
import { broadcastSse } from '../dialog/index.js';
import { attachTerminalHubSocketIO, isTerminalHubReady, readTerminalRuntimeState } from '../frontend/gateways/index.js';
import { terminalActivityEmitter } from '../state/boot/index.js';
import { registerAgentEventListeners } from '../wiring/index.js';
import { printStandaloneBanner } from './boot-banner.js';
import { rollbackTerminalPinnedContextPhase } from './boot-pinned.js';
import { startReflectionLoop, stopReflectionLoop } from './boot-reflection-loop.js';
import { registerTerminalShutdownHandlers } from './boot-shutdown.js';

/** @type {boolean} */
let _sighupHandlerRegistered = false;

/** @type {(() => void) | null} */
let _sighupHandler = null;

// ---------------------------------------------------------------------------
// Rollback
// ---------------------------------------------------------------------------

/**
 * Cancela o reflection timer e o SIGHUP handler do módulo.
 *
 * @param {import('../runtime-root.js').TerminalBootContext} ctx
 * @returns {Promise<void>}
 */
export async function rollbackTerminalRuntimeListenersPhase(ctx) {
    stopReflectionLoop({
        cancelTimerFn: cancelTimer,
        clearIntervalFn: (timer) => clearInterval(/** @type {ReturnType<typeof setInterval>} */ (timer)),
    });
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
// Phase
// ---------------------------------------------------------------------------

/**
 * @param {import('../runtime-root.js').TerminalBootContext} ctx
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

    registerTerminalShutdownHandlers(ctx, {
        rollbackRuntimeListenersPhase: () => rollbackTerminalRuntimeListenersPhase(ctx),
        rollbackPinnedContextPhaseFn: rollbackTerminalPinnedContextPhase,
    });

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
        source: 'terminal-boot/terminal.started',
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
