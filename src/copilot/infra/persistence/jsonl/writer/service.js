// @ts-check
/** Serialized JSONL writer queue with bounded backpressure and at-most-once handling after applied mutations. */
import { utf8ByteLength } from '#copilot/infra/internal/platform';
import { syncParentDirectoryBestEffort } from '#copilot/infra/internal/platform/node/filesystem';
import { isMutationAppliedError } from '#copilot/infra/internal/policy';
import path from 'node:path';
import { createJsonlBatchPersistence } from './persistence.js';
import { createJsonlSizeTracker } from './size-tracker.js';
/** @typedef {import('./types.js').JsonlFileWriterOptions} JsonlFileWriterOptions */

const DEFAULT_SIZE_REVALIDATE_MS = 250;
const MAX_SIZE_REVALIDATE_MS = 10_000;

/** @param {JsonlFileWriterOptions} options */
export function createJsonlFileWriter(options) {
    const batchLines = Math.max(1, Math.trunc(options.batchLines ?? 256));
    const maxQueueLines = Math.max(batchLines, Math.trunc(options.maxQueueLines ?? Number.MAX_SAFE_INTEGER));
    const softQueueLines = Math.max(1, Math.min(maxQueueLines, Math.trunc(options.softQueueLines ?? maxQueueLines)));
    const maxTrackedFiles = Math.max(1, Math.trunc(options.maxTrackedFiles ?? 64));
    const autoFlush = options.autoFlush !== false;
    const durability = options.durability ?? (options.flushToDisk === true ? 'file' : 'none');
    const sizeRevalidateMs = Math.max(
        0,
        Math.min(MAX_SIZE_REVALIDATE_MS, Math.trunc(options.sizeRevalidateMs ?? DEFAULT_SIZE_REVALIDATE_MS)),
    );
    const maxBytes =
        Number.isFinite(options.maxBytes) && Number(options.maxBytes) > 0 ? Math.trunc(Number(options.maxBytes)) : null;
    const resolveRotatedPath = options.resolveRotatedPath ?? ((filePath) => `${filePath}.1`);
    const syncDirectory = options.syncDirectory ?? syncParentDirectoryBestEffort;
    const sizeTracker = createJsonlSizeTracker({ maxTrackedFiles, sizeRevalidateMs });
    const persistence = createJsonlBatchPersistence({
        maxBytes,
        durability,
        resolveRotatedPath,
        syncDirectory,
        ...(options.onPhase ? { onPhase: options.onPhase } : {}),
        sizeTracker,
    });

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

    function resolveFilePath() {
        const value = typeof options.filePath === 'function' ? options.filePath() : options.filePath;
        return path.resolve(value);
    }

    function flushOneBatch() {
        if (inFlight) return inFlight;
        const batch = queue.splice(0, batchLines);
        if (batch.length === 0) return Promise.resolve();
        const filePath = resolveFilePath();
        const data = batch.join('');
        const dataBytes = utf8ByteLength(data, 'jsonl queued batch');
        let succeeded = false;
        const operation = persistence
            .persist(filePath, data)
            .then(() => {
                succeeded = true;
                persistedLines += batch.length;
                persistedBytes += dataBytes;
                lastError = null;
                options.onSuccess?.();
            })
            .catch((error) => {
                if (isMutationAppliedError(error)) {
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
        sizeTracker.reset();
        persistence.reset();
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
            durability,
            ...sizeTracker.stats(),
            ...persistence.stats(),
            appliedButUnconfirmedBatches,
            appliedButUnconfirmedLines,
        }),
    });
}
