// @ts-check
/**
 * Writer JSONL serializado, reencaminhável, com rotação opcional e durability explícita.
 *
 * @module copilot/infra/io/jsonl-file-writer
 */

import { rename, stat } from 'node:fs/promises';
import path from 'node:path';
import { withIoResourceLock } from '../io-locks.js';
import { utf8ByteLength } from '../shared/buffer.js';
import { appendFileUnlocked } from './fs/append.js';
import { assertSuccessfulSync, syncParentDirectoryBestEffort } from './fs/durability.js';
import { mkdirPathUnlocked } from './fs/mkdir.js';
import { isMutationAppliedError, markMutationAppliedError } from './fs/mutation-state.js';

/** @typedef {import('./fs/durability.js').IoDurabilityMode} IoDurabilityMode */

const DEFAULT_SIZE_REVALIDATE_MS = 250;
const MAX_SIZE_REVALIDATE_MS = 10_000;

/**
 * @typedef {object} JsonlFileWriterOptions
 * @property {string | (() => string)} filePath
 * @property {number} [maxBytes]
 * @property {number} [batchLines]
 * @property {number} [maxQueueLines]
 * @property {number} [softQueueLines]
 * @property {number} [maxTrackedFiles]
 * @property {boolean} [autoFlush]
 * @property {boolean} [flushToDisk] Backward-compatible alias: true maps to durability='file'.
 * @property {IoDurabilityMode} [durability]
 * @property {number} [sizeRevalidateMs] Fixed, non-sliding physical size revalidation window. 0 means every batch.
 * @property {(filePath: string) => string} [resolveRotatedPath]
 * @property {typeof syncParentDirectoryBestEffort} [syncDirectory]
 * @property {(error: unknown) => void} [onError]
 * @property {() => void} [onSuccess]
 * @property {(phase: string, details: Record<string, unknown>) => void | Promise<void>} [onPhase]
 */

/**
 * @param {unknown} error
 * @returns {string}
 */
function errorCode(error) {
    return String(/** @type {{ code?: unknown }} */ (error)?.code ?? '');
}

/**
 * @param {JsonlFileWriterOptions} options
 */
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

    /** @type {string[]} */
    const queue = [];
    /** @type {Map<string, { size: number; validatedAtMs: number }>} */
    const sizes = new Map();
    let scheduled = false;
    /** @type {Promise<void> | null} */
    let inFlight = null;
    let persistedLines = 0;
    let persistedBytes = 0;
    let failedBatches = 0;
    let droppedLines = 0;
    let rotations = 0;
    let sizeCacheHits = 0;
    let sizeStatReads = 0;
    let sizeExternalCorrections = 0;
    let appliedButUnconfirmedBatches = 0;
    let appliedButUnconfirmedLines = 0;
    /** @type {string | null} */
    let lastError = null;

    /** @returns {string} */
    function resolveFilePath() {
        const value = typeof options.filePath === 'function' ? options.filePath() : options.filePath;
        return path.resolve(value);
    }

    /** @param {string} filePath */
    function touchTrackedSize(filePath) {
        const entry = sizes.get(filePath);
        if (!entry) return;
        sizes.delete(filePath);
        sizes.set(filePath, entry);
    }

    /**
     * Internal writes update the known size but deliberately do not slide the last physical validation timestamp. A
     * busy writer must still eventually stat again so an external append/truncate cannot remain invisible forever.
     *
     * @param {string} filePath
     * @param {number} size
     * @param {{ physicallyValidated?: boolean }} [update]
     */
    function setTrackedSize(filePath, size, update = {}) {
        const previous = sizes.get(filePath);
        const validatedAtMs = update.physicallyValidated === true || !previous ? Date.now() : previous.validatedAtMs;
        sizes.delete(filePath);
        sizes.set(filePath, { size, validatedAtMs });
        while (sizes.size > maxTrackedFiles) {
            const oldest = sizes.keys().next().value;
            if (typeof oldest !== 'string') break;
            sizes.delete(oldest);
        }
    }

    /** @param {string} filePath */
    async function resolveCurrentSize(filePath) {
        const tracked = sizes.get(filePath);
        if (tracked && Date.now() - tracked.validatedAtMs < sizeRevalidateMs) {
            sizeCacheHits += 1;
            touchTrackedSize(filePath);
            return tracked.size;
        }
        try {
            sizeStatReads += 1;
            const physicalSize = (await stat(filePath)).size;
            if (tracked && tracked.size !== physicalSize) sizeExternalCorrections += 1;
            setTrackedSize(filePath, physicalSize, { physicallyValidated: true });
            return physicalSize;
        } catch (error) {
            if (errorCode(error) !== 'ENOENT') throw error;
            if (tracked && tracked.size !== 0) sizeExternalCorrections += 1;
            setTrackedSize(filePath, 0, { physicallyValidated: true });
            return 0;
        }
    }

    /** @param {string} targetPath @param {string} role */
    async function syncRotationDirectory(targetPath, role) {
        await options.onPhase?.(`before-${role}-directory-sync`, { targetPath, role });
        const result = await syncDirectory(targetPath);
        await options.onPhase?.(`after-${role}-directory-sync`, { targetPath, role, ...result });
        assertSuccessfulSync(result, {
            code: 'EDIRECTORYSYNC',
            message: `Falha ao sincronizar diretório da rotação JSONL: ${targetPath}`,
        });
    }

    /**
     * @param {string} filePath
     * @param {string} data
     * @returns {Promise<void>}
     */
    async function persistBatch(filePath, data) {
        await withIoResourceLock(
            filePath,
            async () => {
                await mkdirPathUnlocked(path.dirname(filePath), { recursive: true, durability });
                let currentSize = await resolveCurrentSize(filePath);
                const dataBytes = utf8ByteLength(data, 'jsonl batch');
                /** @type {string | null} */
                let rotatedPath = null;

                try {
                    if (maxBytes !== null && currentSize > 0 && currentSize + dataBytes >= maxBytes) {
                        rotatedPath = path.resolve(resolveRotatedPath(filePath));
                        await mkdirPathUnlocked(path.dirname(rotatedPath), { recursive: true, durability });
                        await options.onPhase?.('before-rotate', { filePath, rotatedPath, currentSize, dataBytes });
                        await rename(filePath, rotatedPath);
                        sizes.delete(filePath);
                        currentSize = 0;
                        rotations += 1;
                        await options.onPhase?.('after-rotate', { filePath, rotatedPath, dataBytes });

                        if (durability === 'file-and-directory') {
                            // Persist the removal from the active directory before attempting the next append. If the
                            // rotated path lives elsewhere, its directory also needs an independent barrier.
                            await syncRotationDirectory(filePath, 'active');
                            if (path.dirname(rotatedPath) !== path.dirname(filePath)) {
                                await syncRotationDirectory(rotatedPath, 'rotated');
                            }
                        }
                    }

                    await options.onPhase?.('before-append', { filePath, dataBytes });
                    await appendFileUnlocked(filePath, data, {
                        durability,
                        syncDirectory,
                    });
                    setTrackedSize(filePath, currentSize + dataBytes);
                    try {
                        await options.onPhase?.('after-append', { filePath, dataBytes, rotatedPath });
                    } catch (error) {
                        throw markMutationAppliedError(error, { phase: 'jsonl-after-append', paths: [filePath] });
                    }
                } catch (error) {
                    // A failed rotate/append may have changed the pathname or size. Never retain speculative size state
                    // across a retry; the next attempt performs a physical revalidation.
                    sizes.delete(filePath);
                    throw error;
                }
            },
            { operation: 'jsonl-append', target: filePath, riskClass: 'medium' },
        );
    }

    /** @returns {Promise<void>} */
    function flushOneBatch() {
        if (inFlight) return inFlight;
        const batch = queue.splice(0, batchLines);
        if (batch.length === 0) return Promise.resolve();
        const filePath = resolveFilePath();
        const data = batch.join('');
        const dataBytes = utf8ByteLength(data, 'jsonl queued batch');
        let succeeded = false;
        const operation = persistBatch(filePath, data)
            .then(() => {
                succeeded = true;
                persistedLines += batch.length;
                persistedBytes += dataBytes;
                lastError = null;
                options.onSuccess?.();
            })
            .catch((error) => {
                if (isMutationAppliedError(error)) {
                    // Bytes were already appended; requeueing would duplicate a complete batch. Surface the durability
                    // failure while keeping at-most-once behavior for completed writes.
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

    /** @returns {void} */
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

    /** @returns {Promise<void>} */
    async function flush() {
        scheduled = false;
        while (inFlight || queue.length > 0) {
            if (inFlight) await inFlight;
            else await flushOneBatch();
        }
    }

    /** @returns {void} */
    function clearQueue() {
        queue.length = 0;
        scheduled = false;
    }

    /** @returns {void} */
    function reset() {
        clearQueue();
        sizes.clear();
        persistedLines = 0;
        persistedBytes = 0;
        failedBatches = 0;
        droppedLines = 0;
        rotations = 0;
        sizeCacheHits = 0;
        sizeStatReads = 0;
        sizeExternalCorrections = 0;
        appliedButUnconfirmedBatches = 0;
        appliedButUnconfirmedLines = 0;
        lastError = null;
    }

    return {
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
            trackedFiles: sizes.size,
            maxTrackedFiles,
            durability,
            sizeRevalidateMs,
            rotations,
            sizeCacheHits,
            sizeStatReads,
            sizeExternalCorrections,
            appliedButUnconfirmedBatches,
            appliedButUnconfirmedLines,
        }),
    };
}
