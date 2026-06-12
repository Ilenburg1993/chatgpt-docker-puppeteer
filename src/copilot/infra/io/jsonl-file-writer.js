// @ts-check
/**
 * Writer JSONL serializado, reencaminhável e com rotação opcional.
 *
 * @module copilot/infra/io/jsonl-file-writer
 */

import { appendFile, mkdir, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import { withIoResourceLock } from '../io-locks.js';
import { utf8ByteLength } from '../shared/buffer.js';

/**
 * @typedef {object} JsonlFileWriterOptions
 * @property {string | (() => string)} filePath
 * @property {number} [maxBytes]
 * @property {number} [batchLines]
 * @property {number} [maxQueueLines]
 * @property {number} [softQueueLines]
 * @property {boolean} [autoFlush]
 * @property {boolean} [flushToDisk]
 * @property {(filePath: string) => string} [resolveRotatedPath]
 * @property {(error: unknown) => void} [onError]
 * @property {() => void} [onSuccess]
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
    const autoFlush = options.autoFlush !== false;
    const flushToDisk = options.flushToDisk === true;
    const maxBytes =
        Number.isFinite(options.maxBytes) && Number(options.maxBytes) > 0 ? Math.trunc(Number(options.maxBytes)) : null;
    const resolveRotatedPath = options.resolveRotatedPath ?? ((filePath) => `${filePath}.1`);

    /** @type {string[]} */
    const queue = [];
    /** @type {Map<string, number>} */
    const sizes = new Map();
    let scheduled = false;
    /** @type {Promise<void> | null} */
    let inFlight = null;
    let persistedLines = 0;
    let persistedBytes = 0;
    let failedBatches = 0;
    let droppedLines = 0;
    /** @type {string | null} */
    let lastError = null;

    /**
     * @returns {string}
     */
    function resolveFilePath() {
        const value = typeof options.filePath === 'function' ? options.filePath() : options.filePath;
        return path.resolve(value);
    }

    /**
     * @param {string} filePath
     * @param {string} data
     * @returns {Promise<void>}
     */
    async function persistBatch(filePath, data) {
        await withIoResourceLock(filePath, async () => {
            await mkdir(path.dirname(filePath), { recursive: true });
            let currentSize = sizes.get(filePath);
            if (currentSize === undefined) {
                try {
                    currentSize = (await stat(filePath)).size;
                } catch (error) {
                    if (errorCode(error) !== 'ENOENT') throw error;
                    currentSize = 0;
                }
            }

            const dataBytes = utf8ByteLength(data, 'jsonl batch');
            if (maxBytes !== null && currentSize > 0 && currentSize + dataBytes >= maxBytes) {
                await rename(filePath, resolveRotatedPath(filePath));
                currentSize = 0;
            }
            await appendFile(filePath, data, { encoding: 'utf8', flush: flushToDisk });
            sizes.set(filePath, currentSize + dataBytes);
        });
    }

    /**
     * @returns {Promise<void>}
     */
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
                queue.unshift(...batch);
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

    /**
     * @returns {void}
     */
    function scheduleFlush() {
        if (scheduled || inFlight) return;
        scheduled = true;
        setImmediate(() => {
            scheduled = false;
            void flushOneBatch().catch(() => undefined);
        });
    }

    /**
     * @param {string} line
     * @returns {void}
     */
    function enqueueLine(line) {
        queue.push(line.endsWith('\n') ? line : `${line}\n`);
        if (queue.length > maxQueueLines) {
            const overflow = queue.length - softQueueLines;
            queue.splice(0, overflow);
            droppedLines += overflow;
        }
        if (autoFlush) scheduleFlush();
    }

    /**
     * @returns {Promise<void>}
     */
    async function flush() {
        scheduled = false;
        while (inFlight || queue.length > 0) {
            if (inFlight) await inFlight;
            else await flushOneBatch();
        }
    }

    /**
     * @returns {void}
     */
    function clearQueue() {
        queue.length = 0;
        scheduled = false;
    }

    /**
     * @returns {void}
     */
    function reset() {
        clearQueue();
        sizes.clear();
        persistedLines = 0;
        persistedBytes = 0;
        failedBatches = 0;
        droppedLines = 0;
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
        }),
    };
}
