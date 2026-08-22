// @ts-check
/**
 * @module copilot/terminal/terminal-phases/boot-shutdown
 * @file Registro dos shutdown handlers do terminal.
 */

import { registerShutdownHandler, SHUTDOWN_PRIORITY } from '#copilot/core/shutdown';
import { log } from '#copilot/observability';
import { flushTerminalSseEventArchive, flushTerminalTranscriptArchive } from '../state/index.js';
import { rollbackTerminalPinnedContextPhase } from './boot-pinned.js';

/**
 * Registra os shutdown handlers centrais do terminal.
 *
 * @param {import('../runtime-root.js').TerminalBootContext} ctx
 * @param {{
 *     rollbackRuntimeListenersPhase: () => Promise<void>;
 *     rollbackPinnedContextPhaseFn?: typeof rollbackTerminalPinnedContextPhase;
 *     flushTerminalSseEventArchiveFn?: typeof flushTerminalSseEventArchive;
 *     flushTerminalTranscriptArchiveFn?: typeof flushTerminalTranscriptArchive;
 *     flushModelGatewayRuntimeHealthMirrorFn?: () => Promise<unknown>;
 *     registerShutdownHandlerFn?: typeof registerShutdownHandler;
 *     logFn?: (level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL', message: string) => void;
 * }} deps
 * @returns {void}
 */
export function registerTerminalShutdownHandlers(ctx, deps) {
    const rollbackRuntimeListenersPhase = deps.rollbackRuntimeListenersPhase;
    const rollbackPinnedContextPhaseFn = deps.rollbackPinnedContextPhaseFn ?? rollbackTerminalPinnedContextPhase;
    const flushTerminalSseEventArchiveFn = deps.flushTerminalSseEventArchiveFn ?? flushTerminalSseEventArchive;
    const flushTerminalTranscriptArchiveFn = deps.flushTerminalTranscriptArchiveFn ?? flushTerminalTranscriptArchive;
    const flushModelGatewayRuntimeHealthMirrorFn = deps.flushModelGatewayRuntimeHealthMirrorFn;
    const registerShutdownHandlerFn = deps.registerShutdownHandlerFn ?? registerShutdownHandler;
    const logFn = deps.logFn ?? log;

    registerShutdownHandlerFn(
        'terminal.modelGatewayRuntimeHealthMirror',
        async () => {
            await flushModelGatewayRuntimeHealthMirrorFn?.();
            logFn('INFO', '[TerminalServer] Model gateway runtime health SQLite mirror drenado via shutdown handler.');
        },
        SHUTDOWN_PRIORITY.RUNTIME_STATE_DRAIN,
        { timeoutMs: 10_000 },
    );

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
        'terminal.transcriptArchive',
        async () => {
            await flushTerminalTranscriptArchiveFn();
            logFn('INFO', '[TerminalServer] Archive de transcript drenado via shutdown handler.');
        },
        SHUTDOWN_PRIORITY.AUDIT_FINALIZER,
        { timeoutMs: 10_000 },
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
