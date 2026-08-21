// @ts-check
/**
 * Pure JSONL batching/backpressure queue. Filesystem identity and persistence authority are injected by composition.
 *
 * @module copilot/infra/persistence/jsonl/queue/service
 */

import { Buffer } from 'node:buffer';

/**
 * @typedef {{
 *   persistBatch:(data:string)=>Promise<unknown>;
 *   batchLines?:number;
 *   maxQueueLines?:number;
 *   softQueueLines?:number;
 *   autoFlush?:boolean;
 *   onError?:(error:unknown)=>void;
 *   onSuccess?:()=>void;
 *   getExtraState?:()=>Record<string,unknown>;
 *   resetExtra?:()=>void;
 * }} JsonlBatchQueueOptions
 */

/** @param {unknown} error */
function mutationWasApplied(error) {
    return Boolean(
        error &&
        typeof error === 'object' &&
        /** @type {{mutationApplied?:unknown}} */ (error).mutationApplied === true,
    );
}

/** @param {JsonlBatchQueueOptions} options */
export function createJsonlBatchQueue(options) {
    if (typeof options.persistBatch !== 'function') throw new TypeError('JSONL batch queue requires persistBatch().');
    const batchLines = Math.max(1, Math.trunc(options.batchLines ?? 256));
    const maxQueueLines = Math.max(batchLines, Math.trunc(options.maxQueueLines ?? Number.MAX_SAFE_INTEGER));
    const softQueueLines = Math.max(1, Math.min(maxQueueLines, Math.trunc(options.softQueueLines ?? maxQueueLines)));
    const autoFlush = options.autoFlush !== false;

    /** @type {string[]} */
    const queue = [];
    let scheduled = false;
    /** @type {Promise<void> | null} */
    let inFlight = null;
    let persistedLines = 0;
    let persistedBytes = 0;
    let failedBatches = 0;
    let droppedLines = 0;
    let appliedButUnconfirmedBatches = 0;
    let appliedButUnconfirmedLines = 0;
    /** @type {string | null} */
    let lastError = null;

    function flushOneBatch() {
        if (inFlight) return inFlight;
        const batch = queue.splice(0, batchLines);
        if (batch.length === 0) return Promise.resolve();
        const data = batch.join('');
        const dataBytes = Buffer.byteLength(data, 'utf8');
        let succeeded = false;
        const operation = Promise.resolve()
            .then(() => options.persistBatch(data))
            .then(() => {
                succeeded = true;
                persistedLines += batch.length;
                persistedBytes += dataBytes;
                lastError = null;
                options.onSuccess?.();
            })
            .catch((error) => {
                if (mutationWasApplied(error)) {
                    appliedButUnconfirmedBatches += 1;
                    appliedButUnconfirmedLines += batch.length;
                    persistedLines += batch.length;
                    persistedBytes += dataBytes;
                } else {
                    queue.unshift(...batch);
                }
                failedBatches += 1;
                lastError = error instanceof Error ? error.message : String(error);
                options.onError?.(error);
                throw error;
            })
            .finally(() => {
                if (inFlight === operation) inFlight = null;
                if (succeeded && queue.length > 0 && autoFlush) scheduleFlush();
            });
        inFlight = operation;
        return operation;
    }

    function scheduleFlush() {
        if (scheduled || inFlight) return;
        scheduled = true;
        setImmediate(() => {
            scheduled = false;
            void flushOneBatch().catch(() => undefined);
        });
    }

    /** @param {string} line */
    function enqueueLine(line) {
        queue.push(line.endsWith('\n') ? line : `${line}\n`);
        if (queue.length > maxQueueLines) {
            const overflow = queue.length - softQueueLines;
            queue.splice(0, overflow);
            droppedLines += overflow;
        }
        if (autoFlush) scheduleFlush();
    }

    async function flush() {
        scheduled = false;
        while (inFlight || queue.length > 0) {
            if (inFlight) await inFlight;
            else await flushOneBatch();
        }
    }

    function clearQueue() {
        queue.length = 0;
        scheduled = false;
    }

    function reset() {
        clearQueue();
        options.resetExtra?.();
        persistedLines = 0;
        persistedBytes = 0;
        failedBatches = 0;
        droppedLines = 0;
        appliedButUnconfirmedBatches = 0;
        appliedButUnconfirmedLines = 0;
        lastError = null;
    }

    return Object.freeze({
        enqueueLine,
        flush,
        clearQueue,
        reset,
        getState: () => ({
            queueDepth: queue.length,
            scheduled,
            inFlight: inFlight !== null,
            persistedLines,
            persistedBytes,
            failedBatches,
            droppedLines,
            lastError,
            ...(options.getExtraState?.() ?? {}),
            appliedButUnconfirmedBatches,
            appliedButUnconfirmedLines,
        }),
    });
}
