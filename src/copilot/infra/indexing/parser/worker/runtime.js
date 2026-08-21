// @ts-check
/**
 * Instance-owned worker-pool lifecycle and backpressure for parser execution.
 *
 * Worker threads are an optimization resource, not an implicit side effect of parsing. Every pool belongs to an
 * explicit runtime and terminates with that runtime. Stateless parsing therefore never creates background workers.
 *
 * @module copilot/infra/indexing/parser/worker/runtime
 */

import { performance } from 'node:perf_hooks';
import { Worker } from 'node:worker_threads';
import {
    PARSER_WORKER_ENABLED,
    PARSER_WORKER_POOL_SIZE,
    PARSER_WORKER_QUEUE_MAX,
    PARSER_WORKER_REQUEST_TIMEOUT_MS,
    PARSER_WORKER_RESTART_BACKOFF_MS,
    incrementParserRuntimeCounter,
    recordParserWorkerQueueDepth,
    recordParserWorkerQueueWait,
} from '../foundation/index.js';

/** @typedef {{ symbols: import('#copilot/types/io-analysis').SymbolEntry[]; imports: import('#copilot/types/io-analysis').ImportEntry[]; exports: string[]; parseError: string | null; parseDurationMs: number }} ParserWorkerResult */
/** @typedef {{ id: number; payload: { source: string; parserOptions: import('@babel/parser').ParserOptions; maxParseDurationMs: number }; timeoutMs: number; queuedAtMs: number; queueTimeout: NodeJS.Timeout | null; abortCleanup: (() => void) | null; resolve: (value: ParserWorkerResult) => void; reject: (reason?: unknown) => void }} WorkerTask */
/** @typedef {{ id: number; ok: boolean; result?: ParserWorkerResult; error?: string }} ParserWorkerMessage */
/** @typedef {{ index: number; worker: Worker; busy: boolean; currentTaskId: number | null; restarting: boolean; restartPromise: Promise<void> | null }} WorkerSlot */

const WORKER_URL = new URL('./entry.js', import.meta.url);

/** @param {string} message @param {string} code */
function runtimeError(message, code) {
    const error = /** @type {Error & { code: string }} */ (new Error(message));
    error.code = code;
    return error;
}

/** @param {unknown} error */
export function getParserWorkerRuntimeErrorCode(error) {
    return typeof error === 'object' &&
        error !== null &&
        typeof (/** @type {{ code?: unknown }} */ (error).code) === 'string'
        ? /** @type {{ code: string }} */ (error).code
        : null;
}

/** @param {unknown} value @returns {value is ParserWorkerMessage} */
function isParserWorkerMessage(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const record = /** @type {Record<string, unknown>} */ (value);
    return Number.isFinite(Number(record['id'])) && typeof record['ok'] === 'boolean';
}

/**
 * Create one parser-worker resource owner.
 *
 * @param {{ runtimeId?: string }} [options]
 */
export function createParserWorkerRuntime(options = {}) {
    const runtimeId = options.runtimeId?.trim() || 'parser-worker-runtime';
    /** @type {WorkerSlot[]} */
    const workerPool = [];
    /** @type {WorkerTask[]} */
    const workerQueue = [];
    /** @type {Map<number, { task: WorkerTask; timeout: NodeJS.Timeout; slot: WorkerSlot }>} */
    const workerInFlight = new Map();
    let requestSeq = 0;
    let poolInitialized = false;
    let poolDisabledByError = false;
    let poolShuttingDown = false;
    let poolGeneration = 0;
    let consecutiveInitFailures = 0;
    let nextInitAttemptAtMs = 0;
    let disposed = false;
    /** @type {Promise<void> | null} */
    let disposePromise = null;

    function assertActive() {
        if (disposed)
            throw runtimeError(`ParserWorkerRuntime(${runtimeId}) is disposed.`, 'ERR_IO_PARSER_WORKER_DISPOSED');
    }

    /** @param {WorkerTask} task */
    function removeQueuedTask(task) {
        const index = workerQueue.findIndex((queued) => queued.id === task.id);
        if (index < 0) return false;
        workerQueue.splice(index, 1);
        return true;
    }

    /** @param {WorkerTask} task */
    function cleanupAbort(task) {
        task.abortCleanup?.();
        task.abortCleanup = null;
    }

    /** @param {WorkerSlot} slot */
    function dispatch(slot) {
        if (disposed || poolShuttingDown || slot.busy || slot.restarting) return;
        const task = workerQueue.shift();
        if (!task) return;
        if (task.queueTimeout) {
            clearTimeout(task.queueTimeout);
            task.queueTimeout = null;
        }
        const waitMs = Math.max(0, Math.round(performance.now() - task.queuedAtMs));
        recordParserWorkerQueueWait(waitMs);
        const remaining = task.timeoutMs - waitMs;
        if (remaining <= 0) {
            incrementParserRuntimeCounter('workerQueueTimeouts');
            cleanupAbort(task);
            task.reject(
                runtimeError(`parser worker queue timeout (${task.timeoutMs}ms)`, 'ERR_IO_PARSER_WORKER_QUEUE_TIMEOUT'),
            );
            dispatch(slot);
            return;
        }
        slot.busy = true;
        slot.currentTaskId = task.id;
        slot.worker.ref?.();
        const timeout = setTimeout(() => {
            incrementParserRuntimeCounter('workerTimeouts');
            workerInFlight.delete(task.id);
            cleanupAbort(task);
            task.reject(runtimeError(`parser worker timeout (${task.timeoutMs}ms)`, 'ERR_IO_PARSER_WORKER_TIMEOUT'));
            void restartSlot(slot);
        }, remaining);
        timeout.unref?.();
        workerInFlight.set(task.id, { task, timeout, slot });
        slot.worker.postMessage({ id: task.id, payload: task.payload });
    }

    /** @param {WorkerSlot} slot @param {ParserWorkerMessage} message */
    function handleMessage(slot, message) {
        const inFlight = workerInFlight.get(Number(message?.id ?? -1));
        if (!inFlight) return;
        clearTimeout(inFlight.timeout);
        workerInFlight.delete(inFlight.task.id);
        cleanupAbort(inFlight.task);
        slot.busy = false;
        slot.currentTaskId = null;
        slot.worker.unref?.();
        if (message.ok && message.result) inFlight.task.resolve(message.result);
        else if (message.ok) {
            incrementParserRuntimeCounter('workerFailures');
            inFlight.task.reject(new Error('parser worker returned no result'));
        } else {
            incrementParserRuntimeCounter('workerFailures');
            inFlight.task.reject(new Error(message.error ?? 'parser worker error'));
        }
        dispatch(slot);
    }

    /** @param {number} index @returns {WorkerSlot} */
    function createSlot(index) {
        const worker = new Worker(WORKER_URL);
        worker.unref?.();
        const slot = { index, worker, busy: false, currentTaskId: null, restarting: false, restartPromise: null };
        worker.on('message', (message) => {
            if (!isParserWorkerMessage(message)) return;
            handleMessage(slot, message);
        });
        /** @param {string} message */
        const fail = (message) => {
            if (disposed || poolShuttingDown) return;
            incrementParserRuntimeCounter('workerFailures');
            if (slot.currentTaskId !== null) {
                const inFlight = workerInFlight.get(slot.currentTaskId);
                if (inFlight) {
                    clearTimeout(inFlight.timeout);
                    workerInFlight.delete(slot.currentTaskId);
                    cleanupAbort(inFlight.task);
                    inFlight.task.reject(new Error(message));
                }
            }
            void restartSlot(slot);
        };
        worker.on('error', () => fail('parser worker crashed'));
        worker.on('exit', (code) => {
            if (code !== 0) fail(`parser worker exited with code ${code}`);
        });
        return slot;
    }

    /** @param {WorkerSlot} slot */
    async function restartSlot(slot) {
        if (disposed || poolShuttingDown) return;
        if (slot.restartPromise) return slot.restartPromise;
        const generation = poolGeneration;
        slot.restarting = true;
        slot.restartPromise = (async () => {
            const previous = slot.worker;
            previous.removeAllListeners();
            previous.unref?.();
            try {
                await previous.terminate();
            } catch {
                // Termination is best-effort; the slot state is reset below.
            }
            slot.busy = false;
            slot.currentTaskId = null;
            let attempt = 0;
            while (!disposed && !poolShuttingDown && generation === poolGeneration) {
                if (attempt > 0) {
                    const delayMs =
                        PARSER_WORKER_RESTART_BACKOFF_MS[
                            Math.min(attempt - 1, PARSER_WORKER_RESTART_BACKOFF_MS.length - 1)
                        ] ?? 5_000;
                    await new Promise((resolve) => {
                        const timer = setTimeout(resolve, delayMs);
                        timer.unref?.();
                    });
                }
                if (disposed || poolShuttingDown || generation !== poolGeneration) return;
                try {
                    const replacement = createSlot(slot.index);
                    workerPool[slot.index] = replacement;
                    poolDisabledByError = false;
                    incrementParserRuntimeCounter('workerRestarts');
                    dispatch(replacement);
                    return;
                } catch {
                    incrementParserRuntimeCounter('workerRestartFailures');
                    attempt += 1;
                }
            }
        })().finally(() => {
            slot.restarting = false;
            slot.restartPromise = null;
        });
        return slot.restartPromise;
    }

    function ensurePool() {
        assertActive();
        if (!PARSER_WORKER_ENABLED || poolInitialized || poolShuttingDown) return;
        const now = Date.now();
        if (poolDisabledByError && now < nextInitAttemptAtMs) return;
        /** @type {WorkerSlot[]} */
        const provisional = [];
        try {
            for (let index = 0; index < PARSER_WORKER_POOL_SIZE; index += 1) provisional.push(createSlot(index));
            workerPool.push(...provisional);
            poolInitialized = true;
            poolDisabledByError = false;
            nextInitAttemptAtMs = 0;
            if (consecutiveInitFailures > 0) {
                incrementParserRuntimeCounter('workerInitRecoveries');
                consecutiveInitFailures = 0;
            }
        } catch {
            for (const slot of provisional) {
                slot.worker.removeAllListeners();
                slot.worker.unref?.();
                void slot.worker.terminate().catch(() => undefined);
            }
            poolInitialized = false;
            poolDisabledByError = true;
            consecutiveInitFailures += 1;
            incrementParserRuntimeCounter('workerInitFailures');
            const retryIndex = Math.min(consecutiveInitFailures - 1, PARSER_WORKER_RESTART_BACKOFF_MS.length - 1);
            nextInitAttemptAtMs = now + (PARSER_WORKER_RESTART_BACKOFF_MS[retryIndex] ?? 5_000);
        }
    }

    /**
     * @param {{ source: string; parserOptions: import('@babel/parser').ParserOptions; maxParseDurationMs: number }} payload
     * @param {AbortSignal} [signal]
     * @returns {Promise<ParserWorkerResult>}
     */
    async function parseSymbols(payload, signal) {
        signal?.throwIfAborted();
        ensurePool();
        if (!PARSER_WORKER_ENABLED || poolDisabledByError || workerPool.length === 0) {
            throw runtimeError('parser worker pool unavailable', 'ERR_IO_PARSER_WORKER_UNAVAILABLE');
        }
        incrementParserRuntimeCounter('workerRequests');
        const id = ++requestSeq;
        return await new Promise((resolve, reject) => {
            const free = workerPool.find((slot) => !slot.busy && !slot.restarting);
            if (!free && workerQueue.length >= PARSER_WORKER_QUEUE_MAX) {
                incrementParserRuntimeCounter('workerQueueRejected');
                reject(
                    runtimeError(
                        `parser worker queue full (${workerQueue.length}/${PARSER_WORKER_QUEUE_MAX})`,
                        'ERR_IO_PARSER_WORKER_QUEUE_FULL',
                    ),
                );
                return;
            }
            /** @type {WorkerTask} */
            const task = {
                id,
                payload,
                timeoutMs: PARSER_WORKER_REQUEST_TIMEOUT_MS,
                queuedAtMs: performance.now(),
                queueTimeout: null,
                abortCleanup: null,
                resolve,
                reject,
            };
            workerQueue.push(task);
            if (signal) {
                const onAbort = () => {
                    const reason =
                        signal.reason instanceof Error
                            ? signal.reason
                            : new DOMException(
                                  typeof signal.reason === 'string' ? signal.reason : 'Parser abortado',
                                  'AbortError',
                              );
                    if (removeQueuedTask(task)) {
                        if (task.queueTimeout) clearTimeout(task.queueTimeout);
                        task.queueTimeout = null;
                        cleanupAbort(task);
                        reject(reason);
                        return;
                    }
                    const inFlight = workerInFlight.get(task.id);
                    if (!inFlight) return;
                    clearTimeout(inFlight.timeout);
                    workerInFlight.delete(task.id);
                    cleanupAbort(task);
                    reject(reason);
                    void restartSlot(inFlight.slot);
                };
                signal.addEventListener('abort', onAbort, { once: true });
                task.abortCleanup = () => signal.removeEventListener('abort', onAbort);
                if (signal.aborted) {
                    onAbort();
                    return;
                }
            }
            recordParserWorkerQueueDepth(workerQueue.length);
            task.queueTimeout = setTimeout(() => {
                if (!removeQueuedTask(task)) return;
                incrementParserRuntimeCounter('workerQueueTimeouts');
                cleanupAbort(task);
                reject(
                    runtimeError(
                        `parser worker queue timeout (${task.timeoutMs}ms)`,
                        'ERR_IO_PARSER_WORKER_QUEUE_TIMEOUT',
                    ),
                );
            }, task.timeoutMs);
            task.queueTimeout.unref?.();
            if (free) dispatch(free);
        });
    }

    async function terminatePool() {
        if (poolShuttingDown) return;
        poolShuttingDown = true;
        poolGeneration += 1;
        while (workerQueue.length > 0) {
            const queued = workerQueue.shift();
            if (queued?.queueTimeout) clearTimeout(queued.queueTimeout);
            if (queued) cleanupAbort(queued);
            queued?.reject(runtimeError('parser worker runtime disposed', 'ERR_IO_PARSER_WORKER_DISPOSED'));
        }
        for (const inFlight of workerInFlight.values()) {
            clearTimeout(inFlight.timeout);
            cleanupAbort(inFlight.task);
            inFlight.task.reject(runtimeError('parser worker runtime disposed', 'ERR_IO_PARSER_WORKER_DISPOSED'));
        }
        workerInFlight.clear();
        await Promise.allSettled(
            workerPool.map(async (slot) => {
                slot.worker.unref?.();
                try {
                    await slot.worker.terminate();
                } finally {
                    slot.worker.removeAllListeners();
                }
            }),
        );
        workerPool.length = 0;
        poolInitialized = false;
        poolDisabledByError = false;
        poolShuttingDown = false;
        consecutiveInitFailures = 0;
        nextInitAttemptAtMs = 0;
        requestSeq = 0;
    }

    function status() {
        return Object.freeze({
            runtimeId,
            disposed,
            queueLength: workerQueue.length,
            inFlight: workerInFlight.size,
            poolSize: workerPool.length,
            poolInitialized,
            poolDisabledByError,
            poolShuttingDown,
            poolRestarting: workerPool.filter((slot) => slot.restarting).length,
            consecutiveInitFailures,
            nextInitAttemptAtMs: nextInitAttemptAtMs || null,
        });
    }

    function dispose() {
        if (disposePromise) return disposePromise;
        disposed = true;
        disposePromise = terminatePool();
        return disposePromise;
    }

    return Object.freeze({ runtimeId, parseSymbols, status, dispose });
}
