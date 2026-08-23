// @ts-check
/** Instance-owned process shutdown orchestration. No module-global handlers, logger or metrics. */

export const PROCESS_SHUTDOWN_PHASE = Object.freeze({
    HOST_EARLY: 'host-early',
    STATE_DRAIN: 'state-drain',
    RUNTIME_CRITICAL: 'runtime-critical',
    APPLICATION_INFRA: 'application-infra',
    CACHE_PERSISTENCE: 'cache-persistence',
    RESOURCE: 'resource',
    ACTIVITY: 'activity',
    NETWORK: 'network',
    OBSERVABILITY_BUS: 'observability-bus',
    OBSERVABILITY_TRACKER: 'observability-tracker',
    OBSERVABILITY_DETACH: 'observability-detach',
    DEFAULT: 'default',
    FINAL: 'final',
});

const PHASE_ORDER = Object.freeze([
    PROCESS_SHUTDOWN_PHASE.HOST_EARLY,
    PROCESS_SHUTDOWN_PHASE.STATE_DRAIN,
    PROCESS_SHUTDOWN_PHASE.RUNTIME_CRITICAL,
    PROCESS_SHUTDOWN_PHASE.APPLICATION_INFRA,
    PROCESS_SHUTDOWN_PHASE.CACHE_PERSISTENCE,
    PROCESS_SHUTDOWN_PHASE.RESOURCE,
    PROCESS_SHUTDOWN_PHASE.ACTIVITY,
    PROCESS_SHUTDOWN_PHASE.NETWORK,
    PROCESS_SHUTDOWN_PHASE.OBSERVABILITY_BUS,
    PROCESS_SHUTDOWN_PHASE.OBSERVABILITY_TRACKER,
    PROCESS_SHUTDOWN_PHASE.OBSERVABILITY_DETACH,
    PROCESS_SHUTDOWN_PHASE.DEFAULT,
    PROCESS_SHUTDOWN_PHASE.FINAL,
]);
const PHASE_INDEX = new Map(PHASE_ORDER.map((phase, index) => [phase, index]));

/** @typedef {typeof PROCESS_SHUTDOWN_PHASE[keyof typeof PROCESS_SHUTDOWN_PHASE]} ProcessShutdownPhase */
/** @typedef {'ok'|'failed'|'timed-out-and-aborted'|'timed-out-still-running'} ProcessShutdownHandlerStatus */
/** @typedef {{name:string;phase:ProcessShutdownPhase;timeoutMs:number;status:ProcessShutdownHandlerStatus;startedAt:number;completedAt:number;durationMs:number;error:string|null}} ProcessShutdownHandlerReport */
/** @typedef {{reason:string;startedAt:number;completedAt:number;durationMs:number;handlerCount:number;okCount:number;failedCount:number;timedOutAbortedCount:number;timedOutStillRunningCount:number;handlers:ProcessShutdownHandlerReport[]}} ProcessShutdownReport */
/** @typedef {{signal:AbortSignal;reason:string;name:string;phase:ProcessShutdownPhase}} ProcessShutdownContext */
/** @typedef {(context:ProcessShutdownContext)=>void|Promise<void>} ProcessShutdownHandler */
/** @typedef {(level:'DEBUG'|'INFO'|'WARN'|'ERROR'|'FATAL',message:string)=>void} ProcessShutdownLog */
/** @typedef {(event:{type:string;timestamp:number;[key:string]:unknown})=>void} ProcessShutdownEmit */

class ProcessShutdownTimeoutError extends Error {
    /** @param {string} name @param {number} timeoutMs */
    constructor(name, timeoutMs) {
        super(`Shutdown handler "${name}" timed out after ${timeoutMs}ms`);
        this.name = 'ProcessShutdownTimeoutError';
        this.code = 'ERR_PROCESS_SHUTDOWN_HANDLER_TIMEOUT';
    }
}

/** @param {unknown} error */
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}

/**
 * @param {{processId:string;defaultTimeoutMs?:number;abortGraceMs?:number;now?:()=>number}} options
 */
export function createProcessShutdownController(options) {
    const processId = String(options?.processId ?? '').trim();
    if (!processId) throw new TypeError('createProcessShutdownController requires processId.');
    const defaultTimeoutMs = normalizePositive(options.defaultTimeoutMs, 5_000);
    const abortGraceMs = normalizePositive(options.abortGraceMs, 50);
    const now = options.now ?? Date.now;
    /** @type {{name:string;phase:ProcessShutdownPhase;fn:ProcessShutdownHandler;timeoutMs:number;sequence:number}[]} */
    const handlers = [];
    /** @type {Map<string,{attempts:number;okCount:number;failedCount:number;timedOutAbortedCount:number;timedOutStillRunningCount:number;totalDurationMs:number;lastStatus:ProcessShutdownHandlerStatus;lastDurationMs:number;lastCompletedAt:number;lastError:string|null}>} */
    const metrics = new Map();
    let sequence = 0;
    let state = /** @type {'active'|'running'|'completed'|'disposed'} */ ('active');
    let ownerDisposed = false;
    /** @type {Promise<void>|null} */ let runPromise = null;
    /** @type {ProcessShutdownReport|null} */ let lastReport = null;
    /** @type {ProcessShutdownLog|null} */ let log = null;
    /** @type {ProcessShutdownEmit|null} */ let emit = null;

    function assertActive() {
        if (state !== 'active' || ownerDisposed)
            throw new Error(`ProcessShutdown(${processId}) is ${ownerDisposed ? 'disposed' : state}.`);
    }
    /** @param {'DEBUG'|'INFO'|'WARN'|'ERROR'|'FATAL'} level @param {string} message */
    function writeLog(level, message) {
        try {
            log?.(level, message);
        } catch {
            /* observability cannot break shutdown */
        }
    }
    /** @param {string} type @param {Record<string,unknown>} payload */
    function writeEvent(type, payload) {
        try {
            emit?.({ type, timestamp: now(), processId, ...payload });
        } catch {
            /* best effort */
        }
    }
    /** @param {ProcessShutdownHandlerReport} report */
    function recordMetric(report) {
        const previous = metrics.get(report.name) ?? {
            attempts: 0,
            okCount: 0,
            failedCount: 0,
            timedOutAbortedCount: 0,
            timedOutStillRunningCount: 0,
            totalDurationMs: 0,
            lastStatus: report.status,
            lastDurationMs: 0,
            lastCompletedAt: 0,
            lastError: null,
        };
        previous.attempts += 1;
        previous.totalDurationMs += report.durationMs;
        previous.lastStatus = report.status;
        previous.lastDurationMs = report.durationMs;
        previous.lastCompletedAt = report.completedAt;
        previous.lastError = report.error;
        if (report.status === 'ok') previous.okCount += 1;
        else if (report.status === 'failed') previous.failedCount += 1;
        else if (report.status === 'timed-out-and-aborted') previous.timedOutAbortedCount += 1;
        else previous.timedOutStillRunningCount += 1;
        metrics.set(report.name, previous);
    }

    /** @param {{name:string;phase:ProcessShutdownPhase;fn:ProcessShutdownHandler;timeoutMs:number;sequence:number}} handler @param {string} reason */
    async function execute(handler, reason) {
        const startedAt = now();
        const controller = new AbortController();
        const timeoutError = new ProcessShutdownTimeoutError(handler.name, handler.timeoutMs);
        /** @type {ReturnType<typeof setTimeout>|null} */ let timeoutHandle = null;
        const task = Promise.resolve()
            .then(() => handler.fn({ signal: controller.signal, reason, name: handler.name, phase: handler.phase }))
            .then(
                () => /** @type {const} */ ({ kind: 'settled', ok: true, error: null }),
                (error) => ({ kind: /** @type {const} */ ('settled'), ok: false, error }),
            );
        const timeout = new Promise((resolve) => {
            timeoutHandle = setTimeout(() => {
                controller.abort(timeoutError);
                resolve({ kind: /** @type {const} */ ('timeout') });
            }, handler.timeoutMs);
            timeoutHandle.unref?.();
        });
        const first = await Promise.race([task, timeout]);
        if (timeoutHandle) clearTimeout(timeoutHandle);
        if (first.kind === 'settled') {
            const completedAt = now();
            return /** @type {ProcessShutdownHandlerReport} */ ({
                name: handler.name,
                phase: handler.phase,
                timeoutMs: handler.timeoutMs,
                status: first.ok ? 'ok' : 'failed',
                startedAt,
                completedAt,
                durationMs: completedAt - startedAt,
                error: first.ok ? null : errorMessage(first.error),
            });
        }

        // Timeout reached: signal cooperative cancellation, then observe a short bounded grace window.
        const grace = new Promise((resolve) => {
            const timer = setTimeout(() => resolve({ kind: /** @type {const} */ ('still-running') }), abortGraceMs);
            timer.unref?.();
        });
        const afterAbort = await Promise.race([task, grace]);
        const completedAt = now();
        if (afterAbort.kind === 'settled') {
            return {
                name: handler.name,
                phase: handler.phase,
                timeoutMs: handler.timeoutMs,
                status: /** @type {const} */ ('timed-out-and-aborted'),
                startedAt,
                completedAt,
                durationMs: completedAt - startedAt,
                error: errorMessage(afterAbort.error ?? timeoutError),
            };
        }
        // `task` is already rejection-contained by its `.then(..., ...)`; if it later settles it cannot become unhandled.
        return {
            name: handler.name,
            phase: handler.phase,
            timeoutMs: handler.timeoutMs,
            status: /** @type {const} */ ('timed-out-still-running'),
            startedAt,
            completedAt,
            durationMs: completedAt - startedAt,
            error: timeoutError.message,
        };
    }

    const api = Object.freeze({
        processId,
        /** @param {string} name @param {ProcessShutdownHandler} fn @param {ProcessShutdownPhase} [phase=PROCESS_SHUTDOWN_PHASE.DEFAULT] @param {{timeoutMs?:number}} [registerOptions] */
        register(name, fn, phase = PROCESS_SHUTDOWN_PHASE.DEFAULT, registerOptions = {}) {
            assertActive();
            const normalizedName = String(name ?? '').trim();
            if (!normalizedName) throw new TypeError('Process shutdown handler name is required.');
            if (typeof fn !== 'function')
                throw new TypeError(`Process shutdown handler ${normalizedName} must be a function.`);
            if (!PHASE_INDEX.has(phase)) throw new TypeError(`Unknown process shutdown phase: ${String(phase)}`);
            const entry = {
                name: normalizedName,
                phase,
                fn,
                timeoutMs: normalizePositive(registerOptions.timeoutMs, defaultTimeoutMs),
                sequence: sequence++,
            };
            const existing = handlers.findIndex((candidate) => candidate.name === normalizedName);
            if (existing >= 0) handlers.splice(existing, 1, entry);
            else handlers.push(entry);
            return () => {
                const index = handlers.indexOf(entry);
                if (index >= 0) handlers.splice(index, 1);
            };
        },
        /** @param {{log?:ProcessShutdownLog|null;emit?:ProcessShutdownEmit|null}} observer */
        configureObservability(observer = {}) {
            if (ownerDisposed) throw new Error(`ProcessShutdown(${processId}) is disposed.`);
            log = typeof observer.log === 'function' ? observer.log : null;
            emit = typeof observer.emit === 'function' ? observer.emit : null;
        },
        /** @param {string} [reason='unknown'] */
        run(reason = 'unknown') {
            if (runPromise) return runPromise;
            if (state === 'completed' || state === 'disposed') return Promise.resolve();
            state = 'running';
            const snapshot = [...handlers].sort(
                (a, b) =>
                    (PHASE_INDEX.get(a.phase) ?? 999) - (PHASE_INDEX.get(b.phase) ?? 999) || a.sequence - b.sequence,
            );
            runPromise = (async () => {
                const startedAt = now();
                /** @type {ProcessShutdownHandlerReport[]} */ const reports = [];
                writeLog('INFO', `Process shutdown started (${reason}) — ${snapshot.length} handlers.`);
                writeEvent('runtime.shutdown.started', {
                    reason,
                    handlers: snapshot.map(({ name, phase, timeoutMs }) => ({ name, phase, timeoutMs })),
                });
                for (const handler of snapshot) {
                    const report = await execute(handler, reason);
                    reports.push(report);
                    recordMetric(report);
                    if (report.status === 'ok') writeLog('INFO', `✓ ${handler.name}`);
                    else {
                        writeLog('WARN', `✗ ${handler.name}: ${report.status}: ${report.error ?? 'unknown'}`);
                        writeEvent('runtime.shutdown.handler_failed', { reason, handler: report });
                    }
                }
                const completedAt = now();
                lastReport = {
                    reason,
                    startedAt,
                    completedAt,
                    durationMs: completedAt - startedAt,
                    handlerCount: reports.length,
                    okCount: reports.filter((r) => r.status === 'ok').length,
                    failedCount: reports.filter((r) => r.status === 'failed').length,
                    timedOutAbortedCount: reports.filter((r) => r.status === 'timed-out-and-aborted').length,
                    timedOutStillRunningCount: reports.filter((r) => r.status === 'timed-out-still-running').length,
                    handlers: reports,
                };
                state = ownerDisposed ? 'disposed' : 'completed';
                writeEvent('runtime.shutdown.completed', { reason, report: api.lastReport() });
                writeLog('INFO', 'Process shutdown completed.');
                if (ownerDisposed) {
                    log = null;
                    emit = null;
                }
            })();
            return runPromise;
        },
        isShuttingDown() {
            return state === 'running' || state === 'completed' || state === 'disposed';
        },
        handlers() {
            return [...handlers]
                .sort(
                    (a, b) =>
                        (PHASE_INDEX.get(a.phase) ?? 999) - (PHASE_INDEX.get(b.phase) ?? 999) ||
                        a.sequence - b.sequence,
                )
                .map(({ name, phase, timeoutMs }) => Object.freeze({ name, phase, timeoutMs }));
        },
        lastReport() {
            return lastReport ? structuredClone(lastReport) : null;
        },
        metrics() {
            return [...metrics.entries()]
                .map(([name, metric]) =>
                    Object.freeze({
                        name,
                        ...metric,
                        avgDurationMs: metric.attempts ? Math.round(metric.totalDurationMs / metric.attempts) : 0,
                    }),
                )
                .sort((a, b) => b.totalDurationMs - a.totalDurationMs || a.name.localeCompare(b.name));
        },
        snapshot() {
            return Object.freeze({
                processId,
                state,
                ownerDisposed,
                handlers: api.handlers(),
                lastReport: api.lastReport(),
                metrics: api.metrics(),
            });
        },
        dispose() {
            ownerDisposed = true;
            handlers.length = 0;
            if (state !== 'running') {
                log = null;
                emit = null;
            }
            if (state === 'active' || state === 'completed') state = 'disposed';
        },
    });
    return api;
}

/** @param {unknown} value @param {number} fallback */
function normalizePositive(value, fallback) {
    const number = Number(value ?? fallback);
    return Number.isFinite(number) && number > 0 ? Math.trunc(number) : fallback;
}
