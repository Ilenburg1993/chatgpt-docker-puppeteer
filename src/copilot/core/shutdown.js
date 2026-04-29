// @ts-check
import { toError } from './error-handlers.js';
import { SHUTDOWN_PRIORITY } from './shutdown-priorities.js';
/**
 * src/copilot/core/shutdown.js
 *
 * Gerenciador de graceful shutdown centralizado. Registra handlers nomeados com prioridade e os executa em ordem
 * durante o shutdown.
 *
 * L0 (core) — não importa camadas superiores. Logger é injetado via `setShutdownLogger`.
 *
 * @module copilot/core/shutdown
 * @see EventBus
 */

/**
 * @typedef {(level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL', msg: string) => void} ShutdownLogFn
 *
 * @typedef {(event: { type: string; timestamp: number; [key: string]: unknown }) => void} ShutdownEventEmitter
 */

/** @type {ShutdownLogFn} */
let _log = (level, msg) => {
    const fn = level === 'WARN' || level === 'ERROR' ? console.warn : console.log;
    fn(`[shutdown][${level}] ${msg}`);
};

/** @type {ShutdownEventEmitter | null} */
let _emitShutdownEvent = null;

/**
 * @typedef {object} ShutdownHandler
 * @property {string} name - Nome do handler (para log)
 * @property {number} priority - Prioridade (menor = executa primeiro)
 * @property {() => Promise<void>} fn - Função de cleanup
 * @property {number} timeoutMs - Timeout do handler em ms
 *
 * @typedef {'ok' | 'failed' | 'timeout'} ShutdownHandlerStatus
 *
 * @typedef {object} ShutdownHandlerReport
 * @property {string} name
 * @property {number} priority
 * @property {number} timeoutMs
 * @property {ShutdownHandlerStatus} status
 * @property {number} startedAt
 * @property {number} completedAt
 * @property {number} durationMs
 * @property {string | null} error
 *
 * @typedef {object} ShutdownReport
 * @property {string} reason
 * @property {number} startedAt
 * @property {number} completedAt
 * @property {number} durationMs
 * @property {number} handlerCount
 * @property {number} okCount
 * @property {number} failedCount
 * @property {number} timeoutCount
 * @property {ShutdownHandlerReport[]} handlers
 *
 * @typedef {object} ShutdownHandlerMetric
 * @property {string} name
 * @property {number} priority
 * @property {number} attempts
 * @property {number} okCount
 * @property {number} failedCount
 * @property {number} timeoutCount
 * @property {number} totalDurationMs
 * @property {number} avgDurationMs
 * @property {ShutdownHandlerStatus} lastStatus
 * @property {number} lastDurationMs
 * @property {number} lastCompletedAt
 * @property {string | null} lastError
 */

/** @type {ShutdownHandler[]} */
const handlers = [];

/** @type {boolean} */
let shuttingDown = false;

/** @type {Promise<void> | null} */
let shutdownInFlight = null;

/** @type {ShutdownReport | null} */
let lastShutdownReport = null;
/** @type {Map<string, Omit<ShutdownHandlerMetric, 'avgDurationMs'>>} */
const shutdownHandlerMetrics = new Map();

class ShutdownHandlerTimeoutError extends Error {
    constructor(/** @type {string} */ handlerName) {
        super(`Shutdown handler "${handlerName}" timeout`);
        this.name = 'ShutdownHandlerTimeoutError';
    }
}

/**
 * Injeta logger externo (ex: observability/logger). Chamado no bootstrap.
 *
 * @param {ShutdownLogFn} logFn
 */
export function setShutdownLogger(logFn) {
    _log = logFn;
}

/**
 * Injeta emissor opcional de eventos de lifecycle. Mantém `core/` independente do EventBus concreto.
 *
 * @param {ShutdownEventEmitter | null | undefined} emitFn
 */
export function setShutdownEventEmitter(emitFn) {
    _emitShutdownEvent = typeof emitFn === 'function' ? emitFn : null;
}

/**
 * Registra um handler de shutdown com nome e prioridade. Prioridades recomendadas:
 *
 * - 10: agent/session stop
 * - 20: bridges/connections
 * - 30: database close
 * - 40: terminal/infra
 * - 50: final cleanup
 *
 * @param {string} name - Nome descritivo do handler
 * @param {() => Promise<void>} fn - Função de cleanup async
 * @param {number} [priority=50] - Prioridade (menor = executa primeiro). Default is `50`
 * @param {{ timeoutMs?: number }} [options] - Opções do handler. Default timeout is `5000`
 */
export function registerShutdownHandler(name, fn, priority = SHUTDOWN_PRIORITY.DEFAULT, options = {}) {
    const timeoutMs =
        typeof options.timeoutMs === 'number' && Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
            ? options.timeoutMs
            : 5_000;
    const nextHandler = { name, priority, fn, timeoutMs };
    const existingIndex = handlers.findIndex((handler) => handler.name === name);
    if (existingIndex >= 0) {
        handlers.splice(existingIndex, 1, nextHandler);
    } else {
        handlers.push(nextHandler);
    }
    handlers.sort((a, b) => a.priority - b.priority);
}

/**
 * Executa todos os handlers de shutdown em ordem de prioridade. Cada handler tem timeout próprio; o default é 5s. Se um
 * falhar, os próximos continuam. Seguro para chamar múltiplas vezes (idempotente).
 *
 * @param {string} [reason='unknown'] - Motivo do shutdown (para log). Default is `'unknown'`
 * @returns {Promise<void>}
 */
export function runShutdown(reason = 'unknown') {
    if (shutdownInFlight) return shutdownInFlight;
    shuttingDown = true;

    shutdownInFlight = (async () => {
        const startedAt = Date.now();
        /** @type {ShutdownHandlerReport[]} */
        const handlerReports = [];
        _log('INFO', `Graceful shutdown iniciado (reason: ${reason}) — ${handlers.length} handlers`);
        emitShutdownLifecycleEvent('runtime.shutdown.started', {
            reason,
            handlerCount: handlers.length,
            handlers: listShutdownHandlers(),
        });

        for (const handler of handlers) {
            const handlerStartedAt = Date.now();
            try {
                await runHandlerWithTimeout(handler);
                const completedAt = Date.now();
                const report = {
                    name: handler.name,
                    priority: handler.priority,
                    timeoutMs: handler.timeoutMs,
                    status: /** @type {const} */ ('ok'),
                    startedAt: handlerStartedAt,
                    completedAt,
                    durationMs: completedAt - handlerStartedAt,
                    error: null,
                };
                handlerReports.push(report);
                recordShutdownHandlerMetric(report);
                _log('INFO', `  ✓ ${handler.name}`);
            } catch (err) {
                const error = toError(err);
                const completedAt = Date.now();
                const status = err instanceof ShutdownHandlerTimeoutError ? 'timeout' : 'failed';
                const report = {
                    name: handler.name,
                    priority: handler.priority,
                    timeoutMs: handler.timeoutMs,
                    status: /** @type {ShutdownHandlerStatus} */ (status),
                    startedAt: handlerStartedAt,
                    completedAt,
                    durationMs: completedAt - handlerStartedAt,
                    error: error.message,
                };
                handlerReports.push(report);
                recordShutdownHandlerMetric(report);
                _log('WARN', `  ✗ ${handler.name}: ${error.message}`);
                emitShutdownLifecycleEvent('runtime.shutdown.handler_failed', {
                    reason,
                    handler: {
                        name: handler.name,
                        priority: handler.priority,
                        timeoutMs: handler.timeoutMs,
                        status,
                        durationMs: completedAt - handlerStartedAt,
                        error: error.message,
                    },
                });
            }
        }

        const completedAt = Date.now();
        const okCount = handlerReports.filter((handler) => handler.status === 'ok').length;
        const timeoutCount = handlerReports.filter((handler) => handler.status === 'timeout').length;
        const failedCount = handlerReports.length - okCount - timeoutCount;
        lastShutdownReport = {
            reason,
            startedAt,
            completedAt,
            durationMs: completedAt - startedAt,
            handlerCount: handlerReports.length,
            okCount,
            failedCount,
            timeoutCount,
            handlers: handlerReports,
        };

        _log('INFO', 'Graceful shutdown concluído');
        emitShutdownLifecycleEvent('runtime.shutdown.completed', {
            reason,
            ok: failedCount === 0 && timeoutCount === 0,
            durationMs: lastShutdownReport.durationMs,
            handlerCount: lastShutdownReport.handlerCount,
            okCount,
            failedCount,
            timeoutCount,
        });
    })();

    return shutdownInFlight;
}

/**
 * Retorna se o processo está em shutdown.
 *
 * @returns {boolean}
 */
export function isShuttingDown() {
    return shuttingDown;
}

/**
 * Retorna um snapshot do último ciclo de shutdown concluído ou `null` se nenhum shutdown terminou ainda.
 *
 * @returns {ShutdownReport | null}
 */
export function getLastShutdownReport() {
    if (!lastShutdownReport) return null;
    return {
        ...lastShutdownReport,
        handlers: lastShutdownReport.handlers.map((handler) => ({ ...handler })),
    };
}

/**
 * Retorna métricas agregadas por handler desde o último reset do processo.
 *
 * @returns {ShutdownHandlerMetric[]}
 */
export function getShutdownLifecycleMetrics() {
    return Array.from(shutdownHandlerMetrics.values())
        .map((metric) => ({
            ...metric,
            avgDurationMs: metric.attempts > 0 ? Math.round(metric.totalDurationMs / metric.attempts) : 0,
        }))
        .sort((a, b) => b.totalDurationMs - a.totalDurationMs || a.name.localeCompare(b.name));
}

/**
 * Snapshot dos handlers registrados, em ordem de execução.
 *
 * @returns {{ name: string; priority: number; timeoutMs: number }[]}
 */
export function listShutdownHandlers() {
    return handlers.map(({ name, priority, timeoutMs }) => ({ name, priority, timeoutMs }));
}

/**
 * @param {ShutdownHandler} handler
 * @returns {Promise<void>}
 */
async function runHandlerWithTimeout(handler) {
    /** @type {ReturnType<typeof setTimeout> | null} */
    let timeout = null;
    try {
        await Promise.race([
            handler.fn(),
            new Promise((_, reject) => {
                timeout = setTimeout(() => reject(new ShutdownHandlerTimeoutError(handler.name)), handler.timeoutMs);
            }),
        ]);
    } finally {
        if (timeout) clearTimeout(timeout);
    }
}

/**
 * @param {ShutdownHandlerReport} report
 * @returns {void}
 */
function recordShutdownHandlerMetric(report) {
    const existing = shutdownHandlerMetrics.get(report.name) ?? {
        name: report.name,
        priority: report.priority,
        attempts: 0,
        okCount: 0,
        failedCount: 0,
        timeoutCount: 0,
        totalDurationMs: 0,
        lastStatus: report.status,
        lastDurationMs: 0,
        lastCompletedAt: 0,
        lastError: null,
    };
    existing.priority = report.priority;
    existing.attempts += 1;
    existing.totalDurationMs += report.durationMs;
    existing.lastStatus = report.status;
    existing.lastDurationMs = report.durationMs;
    existing.lastCompletedAt = report.completedAt;
    existing.lastError = report.error;
    if (report.status === 'ok') existing.okCount += 1;
    else if (report.status === 'timeout') existing.timeoutCount += 1;
    else existing.failedCount += 1;
    shutdownHandlerMetrics.set(report.name, existing);
}

/**
 * Emite eventos de shutdown em modo best-effort; falha em observabilidade nunca pode interromper shutdown.
 *
 * @param {string} type
 * @param {Record<string, unknown>} payload
 * @returns {void}
 */
function emitShutdownLifecycleEvent(type, payload) {
    if (!_emitShutdownEvent) return;
    try {
        _emitShutdownEvent({ type, timestamp: Date.now(), ...payload });
    } catch (error) {
        _log('WARN', `Falha ao emitir evento ${type}: ${toError(error).message}`);
    }
}

/**
 * Remove todos os handlers (apenas para testes).
 */
export function _resetForTesting() {
    handlers.length = 0;
    shuttingDown = false;
    shutdownInFlight = null;
    lastShutdownReport = null;
    shutdownHandlerMetrics.clear();
    _emitShutdownEvent = null;
}
