// @ts-check
/**
 * Retenção auxiliar bounded de deltas de resposta.
 *
 * @module copilot/channel/chunk-retention
 */

import { utf8ByteLength } from '#copilot/infra/public/platform';

export const DEFAULT_CAPTURED_CHUNK_MAX_BYTES = 2 * 1024 * 1024;
export const MAX_CAPTURED_CHUNK_MAX_BYTES = 8 * 1024 * 1024;
export const DEFAULT_CAPTURED_CHUNK_MAX_ITEMS = 4096;
export const MAX_CAPTURED_CHUNK_MAX_ITEMS = 16384;

/**
 * @typedef {{
 *     chunks: string[];
 *     observedChunks: number;
 *     observedChunkBytes: number;
 *     capturedChunkBytes: number;
 *     chunksTruncated: boolean;
 * }} ChunkRetentionSnapshot
 */

/**
 * @param {unknown} value
 * @param {number} fallback
 * @param {number} hardMax
 * @returns {number}
 */
function normalizeLimit(value, fallback, hardMax) {
    const numeric = Number(value ?? fallback);
    if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
    return Math.min(hardMax, Math.max(1, Math.trunc(numeric)));
}

/**
 * @param {{ enabled?: boolean; maxBytes?: number; maxItems?: number }} [options]
 */
export function createChunkRetention(options = {}) {
    const enabled = options.enabled ?? true;
    const maxBytes = normalizeLimit(options.maxBytes, DEFAULT_CAPTURED_CHUNK_MAX_BYTES, MAX_CAPTURED_CHUNK_MAX_BYTES);
    const maxItems = normalizeLimit(options.maxItems, DEFAULT_CAPTURED_CHUNK_MAX_ITEMS, MAX_CAPTURED_CHUNK_MAX_ITEMS);
    /** @type {string[]} */
    const chunks = [];
    let observedChunks = 0;
    let observedChunkBytes = 0;
    let capturedChunkBytes = 0;
    let chunksTruncated = false;

    return {
        /**
         * @param {string} chunk
         */
        record(chunk) {
            const bytes = utf8ByteLength(chunk, 'stream chunk');
            observedChunks += 1;
            observedChunkBytes += bytes;
            if (!enabled || chunks.length >= maxItems || capturedChunkBytes + bytes > maxBytes) {
                chunksTruncated = true;
                return;
            }
            chunks.push(chunk);
            capturedChunkBytes += bytes;
        },
        /**
         * @returns {ChunkRetentionSnapshot}
         */
        snapshot() {
            return {
                chunks: [...chunks],
                observedChunks,
                observedChunkBytes,
                capturedChunkBytes,
                chunksTruncated,
            };
        },
    };
}

/**
 * @param {Partial<ChunkRetentionSnapshot> & { chunks?: string[] }} value
 * @returns {ChunkRetentionSnapshot}
 */
function normalizeSnapshot(value) {
    const chunks = Array.isArray(value.chunks) ? value.chunks : [];
    const capturedChunkBytes = Number.isFinite(value.capturedChunkBytes)
        ? Number(value.capturedChunkBytes)
        : chunks.reduce((sum, chunk) => sum + utf8ByteLength(chunk, 'stream chunk'), 0);
    return {
        chunks,
        observedChunks: Number.isFinite(value.observedChunks) ? Number(value.observedChunks) : chunks.length,
        observedChunkBytes: Number.isFinite(value.observedChunkBytes)
            ? Number(value.observedChunkBytes)
            : capturedChunkBytes,
        capturedChunkBytes,
        chunksTruncated: value.chunksTruncated === true,
    };
}

/**
 * @param {(Partial<ChunkRetentionSnapshot> & { chunks?: string[] })[]} values
 * @param {{ maxBytes?: number; maxItems?: number }} [options]
 * @returns {ChunkRetentionSnapshot}
 */
export function mergeChunkRetentions(values, options = {}) {
    const normalized = values.map(normalizeSnapshot);
    const collector = createChunkRetention(options);
    for (const value of normalized) {
        for (const chunk of value.chunks) collector.record(chunk);
    }
    const captured = collector.snapshot();
    return {
        ...captured,
        observedChunks: normalized.reduce((sum, value) => sum + value.observedChunks, 0),
        observedChunkBytes: normalized.reduce((sum, value) => sum + value.observedChunkBytes, 0),
        chunksTruncated: captured.chunksTruncated || normalized.some((value) => value.chunksTruncated),
    };
}
