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
import { installByokProviderHealthSqliteMirror, SqliteModelGatewayCatalogStore } from '#copilot/model-gateway';
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

/** @type {ReturnType<typeof installByokProviderHealthSqliteMirror> | null} */
let _modelGatewayRuntimeHealthMirror = null;

/**
 * @param {unknown} value
 * @returns {number | undefined}
 */
function optionalNonNegativeInteger(value) {
    const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
    return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : undefined;
}

/**
 * @returns {boolean}
 */
function shouldEnableModelGatewayRuntimeHealthMirror() {
    if (process.env['MODEL_GATEWAY_RUNTIME_HEALTH_SQLITE_MIRROR_DISABLED'] === 'true') return false;
    if (
        process.env['VITEST'] === 'true' &&
        process.env['MODEL_GATEWAY_RUNTIME_HEALTH_SQLITE_MIRROR_ENABLED'] !== 'true'
    ) {
        return false;
    }
    return true;
}

/**
 * @returns {ReturnType<typeof installByokProviderHealthSqliteMirror> | null}
 */
function ensureModelGatewayRuntimeHealthMirror() {
    if (_modelGatewayRuntimeHealthMirror) return _modelGatewayRuntimeHealthMirror;
    const enabled = shouldEnableModelGatewayRuntimeHealthMirror();
    _modelGatewayRuntimeHealthMirror = installByokProviderHealthSqliteMirror({
        sqliteStore: enabled
            ? new SqliteModelGatewayCatalogStore()
            : {
                  writeRuntimeHealthRecords: async () => ({
                      runId: 'model-gateway:runtime-health:disabled',
                      healthObservations: 0,
                      probeResults: 0,
                  }),
              },
        debounceMs: optionalNonNegativeInteger(process.env['MODEL_GATEWAY_RUNTIME_HEALTH_SQLITE_MIRROR_DEBOUNCE_MS']),
        enabled,
        onError: (error) => {
            const message = error instanceof Error ? error.message : String(error);
            log('WARN', `[model-gateway] runtime health SQLite mirror falhou: ${message}`);
        },
    });
    if (_modelGatewayRuntimeHealthMirror.enabled) {
        log('INFO', '[model-gateway] runtime health SQLite mirror ativo para health BYOK.');
    }
    return _modelGatewayRuntimeHealthMirror;
}

/**
 * SIGHUP é o sinal esperado no terminal POSIX quando o painel é reaberto/fechado.
 * No Windows esse sinal não é suportado de forma confiável pelo Node; registrar o handler lá
 * cria ruído de boot sem capacidade operacional real.
 *
 * @param {NodeJS.Platform} [platform]
 * @returns {boolean}
 */
export function shouldRegisterTerminalSighupHandler(platform = process.platform) {
    return platform !== 'win32';
}

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
    _modelGatewayRuntimeHealthMirror?.dispose();
    _modelGatewayRuntimeHealthMirror = null;
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
    const modelGatewayRuntimeHealthMirror = ensureModelGatewayRuntimeHealthMirror();
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
        flushModelGatewayRuntimeHealthMirrorFn: () => modelGatewayRuntimeHealthMirror?.flush() ?? Promise.resolve(null),
    });

    if (copilotServer.io && isTerminalHubReady()) {
        attachTerminalHubSocketIO(copilotServer.io);
    }

    if (shouldRegisterTerminalSighupHandler() && !_sighupHandlerRegistered) {
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
