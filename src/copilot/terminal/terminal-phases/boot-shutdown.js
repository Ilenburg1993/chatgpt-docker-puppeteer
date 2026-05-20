// @ts-check
/**
 * @module copilot/terminal/terminal-phases/boot-shutdown
 * @file Registro dos shutdown handlers do terminal.
 */

import { registerShutdownHandler, SHUTDOWN_PRIORITY } from '#copilot/core';
import { log } from '#copilot/observability';
import { flushTerminalSseEventArchive } from '../state/events/index.js';
import { rollbackTerminalPinnedContextPhase } from './boot-pinned.js';

/**
 * Registra os shutdown handlers centrais do terminal.
 *
 * @param {import('../runtime-root.js').TerminalBootContext} ctx
 * @param {{
 *     rollbackRuntimeListenersPhase: () => Promise<void>;
 *     rollbackPinnedContextPhaseFn?: typeof rollbackTerminalPinnedContextPhase;
 *     flushTerminalSseEventArchiveFn?: typeof flushTerminalSseEventArchive;
 *     registerShutdownHandlerFn?: typeof registerShutdownHandler;
 *     logFn?: (level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL', message: string) => void;
 * }} deps
 * @returns {void}
 */
export function registerTerminalShutdownHandlers(ctx, deps) {
    const rollbackRuntimeListenersPhase = deps.rollbackRuntimeListenersPhase;
    const rollbackPinnedContextPhaseFn = deps.rollbackPinnedContextPhaseFn ?? rollbackTerminalPinnedContextPhase;
    const flushTerminalSseEventArchiveFn = deps.flushTerminalSseEventArchiveFn ?? flushTerminalSseEventArchive;
    const registerShutdownHandlerFn = deps.registerShutdownHandlerFn ?? registerShutdownHandler;
    const logFn = deps.logFn ?? log;

    registerShutdownHandlerFn(
        'terminal.reflectionTimer',
        async () => {
            await rollbackRuntimeListenersPhase();
            logFn('INFO', '[TerminalServer] Reflection timer cancelado via shutdown handler.');
        },
        SHUTDOWN_PRIORITY.RUNTIME_CRITICAL,
    );

    registerShutdownHandlerFn(
        'terminal.pinnedFilesLoader',
        async () => {
            await rollbackPinnedContextPhaseFn(ctx);
            logFn('INFO', '[TerminalServer] PinnedFilesLoader desligado via shutdown handler.');
        },
        SHUTDOWN_PRIORITY.TERMINAL_RESOURCE,
    );

    registerShutdownHandlerFn(
        'terminal.activityEmitter',
        async () => {
            await rollbackRuntimeListenersPhase();
            logFn('INFO', '[TerminalServer] Activity emitter desacoplado via shutdown handler.');
        },
        SHUTDOWN_PRIORITY.TERMINAL_ACTIVITY,
    );

    registerShutdownHandlerFn(
        'terminal.sseEventArchive',
        async () => {
            await flushTerminalSseEventArchiveFn();
            logFn('INFO', '[TerminalServer] Archive SSE drenado via shutdown handler.');
        },
        SHUTDOWN_PRIORITY.AUDIT_FINALIZER,
        { timeoutMs: 10_000 },
    );
}
