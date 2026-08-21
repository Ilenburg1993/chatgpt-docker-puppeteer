// @ts-check
/** Low-level public line-chunk API: retry orchestration plus Web ReadableStream delivery. */

import { createStaleChunkSnapshotError, isStaleChunkSnapshotError } from '../snapshot/index.js';
import { readTextLineChunksByByteIndex } from './byte-seek.js';
import { throwAbortError } from './codec.js';
import { iterateTextLineChunks } from './stream.js';

const DEFAULT_CHUNK_SNAPSHOT_RETRIES = 2;
/** @typedef {import('./types.js').TextLineChunk} TextLineChunk */

/**
 * @param {string} filePath
 * @param {{
 *     chunkLines?: number;
 *     startLine?: number;
 *     endLine?: number;
 *     highWaterMark?: number;
 *     signal?: AbortSignal;
 *     maxRetries?: number;
 *     onPhase?: (phase: string, details: Record<string, unknown>) => void | Promise<void>;
 *     readRuntime?: {byteLineIndex:ReturnType<typeof import('../line-index/index.js').createByteLineIndexRuntime>};
 * }} [options]
 * @returns {Promise<{
 *     path: string;
 *     chunks: TextLineChunk[];
 *     totalLines: number;
 *     totalLinesKnown?: boolean;
 *     returnedLineCount: number;
 *     lastScannedLine: number;
 *     stoppedAtRequestedWindow: boolean;
 *     bytesRead: number;
 *     indexBytesRead?: number;
 *     rangeBytesRead?: number;
 *     indexCacheState?: 'hit' | 'build' | 'extend';
 *     rangeSource?: 'index-capture' | 'file-range';
 *     chunkLines: number;
 *     startLine: number;
 *     endLine: number | null;
 *     engine?: string;
 *     cacheFingerprintStrategy?: string;
 *     snapshotFingerprintStrategy: string;
 *     snapshotVersion: string;
 *     sizeBytes: number;
 *     mtimeMs: number;
 *     ctimeMs: number;
 *     dev: number;
 *     ino: number;
 *     attempts: number;
 *     consistent: true;
 * }>}
 */
export async function readTextLineChunks(filePath, options = {}) {
    const byteLineIndex = options.readRuntime?.byteLineIndex ?? null;
    byteLineIndex?.ensureInvalidationHook();
    if (options.signal?.aborted) throwAbortError();
    const startLine = Math.max(1, options.startLine ?? 1);
    const maxRetries =
        Number.isInteger(options.maxRetries) && Number(options.maxRetries) >= 0
            ? Math.min(10, Number(options.maxRetries))
            : DEFAULT_CHUNK_SNAPSHOT_RETRIES;

    for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
        try {
            const attemptOptions = { ...options, attempt, deliveryMode: /** @type {const} */ ('materialized') };
            if (startLine > 1 && byteLineIndex) {
                const seekSnapshot = await readTextLineChunksByByteIndex(filePath, attemptOptions);
                if (seekSnapshot) return { ...seekSnapshot, attempts: attempt };
            }
            const state = {
                totalLines: 0,
                bytesRead: 0,
                stoppedAtRequestedWindow: false,
                chunksEmitted: 0,
                snapshotVersion: /** @type {string | null} */ (null),
                sizeBytes: /** @type {number | null} */ (null),
                mtimeMs: /** @type {number | null} */ (null),
                ctimeMs: /** @type {number | null} */ (null),
                dev: /** @type {number | null} */ (null),
                ino: /** @type {number | null} */ (null),
            };
            const arrayFromAsync =
                /**
                 * @type {{
                 *     fromAsync: <T>(items: AsyncIterable<T> | Iterable<T>) => Promise<T[]>;
                 * }}
                 */ (/** @type {unknown} */ (Array)).fromAsync;
            const chunks = await arrayFromAsync(iterateTextLineChunks(filePath, attemptOptions, state));
            if (
                !state.snapshotVersion ||
                state.sizeBytes === null ||
                state.mtimeMs === null ||
                state.ctimeMs === null ||
                state.dev === null ||
                state.ino === null
            ) {
                throw createStaleChunkSnapshotError(filePath, attempt);
            }

            byteLineIndex?.rememberStreamSeed(filePath, state);

            return {
                path: filePath,
                chunks,
                totalLines: state.totalLines,
                totalLinesKnown: options.endLine === undefined,
                returnedLineCount: chunks.reduce(
                    (sum, chunk) => sum + Math.max(0, chunk.endLine - chunk.startLine + 1),
                    0,
                ),
                lastScannedLine: state.totalLines,
                stoppedAtRequestedWindow: state.stoppedAtRequestedWindow,
                bytesRead: state.bytesRead,
                chunkLines:
                    Number.isFinite(options.chunkLines) && Number(options.chunkLines) > 0
                        ? Math.floor(Number(options.chunkLines))
                        : 200,
                startLine,
                endLine: Number.isFinite(options.endLine) ? Math.max(startLine, Number(options.endLine)) : null,
                engine: 'io-engine.fs.createReadStream.textChunks',
                cacheFingerprintStrategy: 'stream-bypass',
                snapshotFingerprintStrategy: 'mtime-size-ctime-dev-ino',
                snapshotVersion: state.snapshotVersion,
                sizeBytes: state.sizeBytes,
                mtimeMs: state.mtimeMs,
                ctimeMs: state.ctimeMs,
                dev: state.dev,
                ino: state.ino,
                attempts: attempt,
                consistent: true,
            };
        } catch (error) {
            if (!isStaleChunkSnapshotError(error) || attempt > maxRetries) throw error;
            byteLineIndex?.discardStale(filePath);
        }
    }

    throw createStaleChunkSnapshotError(filePath, maxRetries + 1);
}

/**
 * Exponibiliza o mesmo particionamento textual como `ReadableStream`.
 *
 * @param {string} filePath
 * @param {{
 *     chunkLines?: number;
 *     startLine?: number;
 *     endLine?: number;
 *     highWaterMark?: number;
 *     signal?: AbortSignal;
 *     onPhase?: (phase: string, details: Record<string, unknown>) => void | Promise<void>;
 *     readRuntime?: {byteLineIndex:ReturnType<typeof import('../line-index/index.js').createByteLineIndexRuntime>};
 * }} [options]
 * @returns {ReadableStream<TextLineChunk>}
 */
export function readTextLineChunksStream(filePath, options = {}) {
    const state = {
        totalLines: 0,
        bytesRead: 0,
        stoppedAtRequestedWindow: false,
        chunksEmitted: 0,
        snapshotVersion: /** @type {string | null} */ (null),
        sizeBytes: /** @type {number | null} */ (null),
        mtimeMs: /** @type {number | null} */ (null),
        ctimeMs: /** @type {number | null} */ (null),
        dev: /** @type {number | null} */ (null),
        ino: /** @type {number | null} */ (null),
    };
    const iterable = iterateTextLineChunks(filePath, { ...options, attempt: 1, deliveryMode: 'stream' }, state);
    const readableStreamFrom =
        /**
         * @type {{
         *     from: <T>(items: AsyncIterable<T> | Iterable<T>) => ReadableStream<T>;
         * }}
         */ (/** @type {unknown} */ (ReadableStream)).from;
    return readableStreamFrom(iterable);
}
