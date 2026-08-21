// @ts-check
/** Worker-pool lifecycle and backpressure for parser execution. */

import { performance } from 'node:perf_hooks';
import { Worker } from 'node:worker_threads';
import {
    PARSER_WORKER_ENABLED,
    PARSER_WORKER_POOL_SIZE,
    PARSER_WORKER_QUEUE_MAX,
    PARSER_WORKER_REQUEST_TIMEOUT_MS,
    PARSER_WORKER_RESTART_BACKOFF_MS,
    parserRuntimeStats,
} from '../foundation/index.js';

/** @typedef {import('#copilot/types/io-analysis').SymbolEntry} SymbolEntry */
/** @typedef {import('#copilot/types/io-analysis').ImportEntry} ImportEntry */
/** @typedef {{ symbols: import('#copilot/types/io-analysis').SymbolEntry[]; imports: import('#copilot/types/io-analysis').ImportEntry[]; exports: string[]; parseError: string | null; parseDurationMs: number }} ParserWorkerResult */
/** @typedef {{ id: number; payload: { source: string; parserOptions: import('@babel/parser').ParserOptions; maxParseDurationMs: number }; timeoutMs: number; queuedAtMs: number; queueTimeout: NodeJS.Timeout | null; abortCleanup: (() => void) | null; resolve: (value: ParserWorkerResult) => void; reject: (reason?: unknown) => void }} WorkerTask */
/** @typedef {{ id: number; ok: boolean; result?: ParserWorkerResult; error?: string }} ParserWorkerMessage */
/** @typedef {{ index: number; worker: Worker; busy: boolean; currentTaskId: number | null; restarting: boolean; restartPromise: Promise<void> | null }} WorkerSlot */

const WORKER_URL = new URL('./entry.js', import.meta.url);
/** @type {WorkerSlot[]} */ const workerPool = [];
/** @type {WorkerTask[]} */ const workerQueue = [];
/** @type {Map<number, { task: WorkerTask; timeout: NodeJS.Timeout; slot: WorkerSlot }>} */ const workerInFlight =
    new Map();
let requestSeq = 0;
let poolInitialized = false;
let poolDisabledByError = false;
let poolShuttingDown = false;
let poolGeneration = 0;
let consecutiveInitFailures = 0;
let nextInitAttemptAtMs = 0;

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
    if (slot.busy || slot.restarting) return;
    const task = workerQueue.shift();
    if (!task) return;
    if (task.queueTimeout) {
        clearTimeout(task.queueTimeout);
        task.queueTimeout = null;
    }
    const waitMs = Math.max(0, Math.round(performance.now() - task.queuedAtMs));
    parserRuntimeStats.workerQueueWaitMsLast = waitMs;
    parserRuntimeStats.workerQueueWaitMsMax = Math.max(parserRuntimeStats.workerQueueWaitMsMax, waitMs);
    const remaining = task.timeoutMs - waitMs;
    if (remaining <= 0) {
        parserRuntimeStats.workerQueueTimeouts += 1;
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
        parserRuntimeStats.workerTimeouts += 1;
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
        parserRuntimeStats.workerFailures += 1;
        inFlight.task.reject(new Error('parser worker returned no result'));
    } else {
        parserRuntimeStats.workerFailures += 1;
        inFlight.task.reject(new Error(message.error ?? 'parser worker error'));
    }
    dispatch(slot);
}

/** @param {unknown} value @returns {value is ParserWorkerMessage} */
function isParserWorkerMessage(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const record = /** @type {Record<string, unknown>} */ (value);
    return Number.isFinite(Number(record['id'])) && typeof record['ok'] === 'boolean';
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
        if (poolShuttingDown) return;
        parserRuntimeStats.workerFailures += 1;
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
    if (slot.restartPromise) return slot.restartPromise;
    const generation = poolGeneration;
    slot.restarting = true;
    slot.restartPromise = (async () => {
        const previous = slot.worker;
        previous.removeAllListeners();
        previous.unref?.();
        try {
            await previous.terminate();
        } catch (error) {
            void error; // termination is best-effort; the slot state is reset below.
        }
        slot.busy = false;
        slot.currentTaskId = null;
        let attempt = 0;
        while (!poolShuttingDown && generation === poolGeneration) {
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
            if (poolShuttingDown || generation !== poolGeneration) return;
            try {
                const replacement = createSlot(slot.index);
                workerPool[slot.index] = replacement;
                poolDisabledByError = false;
                parserRuntimeStats.workerRestarts += 1;
                dispatch(replacement);
                return;
            } catch {
                parserRuntimeStats.workerRestartFailures += 1;
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
    if (!PARSER_WORKER_ENABLED || poolInitialized || poolShuttingDown) return;
    const now = Date.now();
    if (poolDisabledByError && now < nextInitAttemptAtMs) return;
    /** @type {WorkerSlot[]} */ const provisional = [];
    try {
        for (let index = 0; index < PARSER_WORKER_POOL_SIZE; index += 1) provisional.push(createSlot(index));
        workerPool.push(...provisional);
        poolInitialized = true;
        poolDisabledByError = false;
        nextInitAttemptAtMs = 0;
        if (consecutiveInitFailures > 0) {
            parserRuntimeStats.workerInitRecoveries += 1;
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
        parserRuntimeStats.workerInitFailures += 1;
        const retryIndex = Math.min(consecutiveInitFailures - 1, PARSER_WORKER_RESTART_BACKOFF_MS.length - 1);
        nextInitAttemptAtMs = now + (PARSER_WORKER_RESTART_BACKOFF_MS[retryIndex] ?? 5_000);
    }
}

/** @param {{ source: string; parserOptions: import('@babel/parser').ParserOptions; maxParseDurationMs: number }} payload @param {AbortSignal} [signal] @returns {Promise<ParserWorkerResult>} */
export async function parseSymbolsInWorker(payload, signal) {
    signal?.throwIfAborted();
    ensurePool();
    if (poolDisabledByError || workerPool.length === 0) throw new Error('parser worker pool unavailable');
    parserRuntimeStats.workerRequests += 1;
    const id = ++requestSeq;
    return await new Promise((resolve, reject) => {
        const free = workerPool.find((slot) => !slot.busy && !slot.restarting);
        if (!free && workerQueue.length >= PARSER_WORKER_QUEUE_MAX) {
            parserRuntimeStats.workerQueueRejected += 1;
            reject(
                runtimeError(
                    `parser worker queue full (${workerQueue.length}/${PARSER_WORKER_QUEUE_MAX})`,
                    'ERR_IO_PARSER_WORKER_QUEUE_FULL',
                ),
            );
            return;
        }
        /** @type {WorkerTask} */ const task = {
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
        parserRuntimeStats.workerQueueHighWater = Math.max(parserRuntimeStats.workerQueueHighWater, workerQueue.length);
        task.queueTimeout = setTimeout(() => {
            if (!removeQueuedTask(task)) return;
            parserRuntimeStats.workerQueueTimeouts += 1;
            cleanupAbort(task);
            reject(
                runtimeError(`parser worker queue timeout (${task.timeoutMs}ms)`, 'ERR_IO_PARSER_WORKER_QUEUE_TIMEOUT'),
            );
        }, task.timeoutMs);
        task.queueTimeout.unref?.();
        if (free) dispatch(free);
    });
}

export async function teardownParserWorkerPoolForTest() {
    poolShuttingDown = true;
    poolGeneration += 1;
    while (workerQueue.length > 0) {
        const queued = workerQueue.shift();
        if (queued?.queueTimeout) clearTimeout(queued.queueTimeout);
        if (queued) cleanupAbort(queued);
        queued?.reject(new Error('parser worker pool reset'));
    }
    for (const inFlight of workerInFlight.values()) {
        clearTimeout(inFlight.timeout);
        cleanupAbort(inFlight.task);
        inFlight.task.reject(new Error('parser worker pool reset'));
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

export async function shutdownParserWorkerPool() {
    await teardownParserWorkerPoolForTest();
}
export function getParserWorkerRuntimeStatus() {
    return {
        queueLength: workerQueue.length,
        poolInitialized,
        poolDisabledByError,
        poolShuttingDown,
        poolRestarting: workerPool.filter((slot) => slot.restarting).length,
        consecutiveInitFailures,
        nextInitAttemptAtMs: nextInitAttemptAtMs || null,
    };
}
