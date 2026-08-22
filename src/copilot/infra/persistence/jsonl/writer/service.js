// @ts-check
/** Filesystem-backed JSONL writer composed from the pure batching queue plus rotate/append persistence. */
import { syncParentDirectoryBestEffort } from '#copilot/infra/internal/platform/node/filesystem';
import path from 'node:path';
import { createJsonlBatchQueue } from '../queue/index.js';
import { createJsonlSizeTracker } from '../size-tracker/index.js';
import { createJsonlBatchPersistence } from './persistence.js';
/** @typedef {import('./types.js').JsonlFileWriterOptions} JsonlFileWriterOptions */

const DEFAULT_SIZE_REVALIDATE_MS = 250;
const MAX_SIZE_REVALIDATE_MS = 10_000;

/** @param {JsonlFileWriterOptions} options */
export function createJsonlFileWriter(options) {
    const maxTrackedFiles = Math.max(1, Math.trunc(options.maxTrackedFiles ?? 64));
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

    function resolveFilePath() {
        const value = typeof options.filePath === 'function' ? options.filePath() : options.filePath;
        return path.resolve(value);
    }

    const queue = createJsonlBatchQueue({
        persistBatch: async (data) => {
            await persistence.persist(resolveFilePath(), data);
        },
        ...(options.batchLines === undefined ? {} : { batchLines: options.batchLines }),
        ...(options.maxQueueLines === undefined ? {} : { maxQueueLines: options.maxQueueLines }),
        ...(options.softQueueLines === undefined ? {} : { softQueueLines: options.softQueueLines }),
        ...(options.autoFlush === undefined ? {} : { autoFlush: options.autoFlush }),
        ...(options.onError === undefined ? {} : { onError: options.onError }),
        ...(options.onSuccess === undefined ? {} : { onSuccess: options.onSuccess }),
        resetExtra: () => {
            sizeTracker.reset();
            persistence.reset();
        },
    });
    return Object.freeze({
        enqueueLine: queue.enqueueLine,
        flush: queue.flush,
        clearQueue: queue.clearQueue,
        reset: queue.reset,
        getState: () => ({
            ...queue.getState(),
            durability,
            ...sizeTracker.stats(),
            ...persistence.stats(),
        }),
    });
}
