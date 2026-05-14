// @ts-check
/**
 * Metadados canônicos da tool `read_file_content`.
 *
 * @module copilot/tools/file/read/metadata
 */

/**
 * @param {import('node:fs').Stats} stats
 * @param {{
 *     resolved: string;
 *     encoding: 'utf8' | 'base64';
 *     readStrategy: 'cached' | 'stream';
 *     cache: string | null;
 *     cursor: string | undefined;
 *     nextCursor: string | null;
 *     maxBytes: number;
 *     maxLines?: number;
 *     bytesRead: number;
 *     bytesReturned: number;
 *     rawReturnedBytes?: number;
 *     totalLines?: number | null;
 *     totalLinesKnown?: boolean;
 *     returnedLines?: { start: number; end: number } | null;
 *     truncated: boolean;
 *     sanitized?: boolean;
 *     redactions?: number;
 *     contentHash?: string;
 *     returnedContentHash?: string;
 *     cacheFingerprintStrategy?: string | null;
 *     cacheStats?: Record<string, unknown> | null;
 * }} input
 */
export function buildReadFileMetadata(stats, input) {
    return {
        path: input.resolved,
        fileType: 'file',
        encoding: input.encoding,
        readStrategy: input.readStrategy,
        cache: input.cache,
        cursor: input.cursor ?? null,
        nextCursor: input.nextCursor,
        sizeBytes: stats.size,
        bytesRead: input.bytesRead,
        bytesReturned: input.bytesReturned,
        rawReturnedBytes: input.rawReturnedBytes ?? input.bytesReturned,
        maxBytes: Number.isFinite(input.maxBytes) ? input.maxBytes : null,
        maxLines: input.maxLines ?? null,
        totalLines: input.totalLines ?? null,
        totalLinesKnown: input.totalLinesKnown ?? input.totalLines !== undefined,
        returnedLines: input.returnedLines ?? null,
        truncated: input.truncated,
        sanitized: Boolean(input.sanitized),
        redactions: input.redactions ?? 0,
        mtimeMs: stats.mtimeMs,
        ctimeMs: stats.ctimeMs,
        birthtimeMs: stats.birthtimeMs,
        mode: stats.mode,
        uid: stats.uid,
        gid: stats.gid,
        ino: stats.ino,
        dev: stats.dev,
        ...(input.contentHash ? { contentHash: input.contentHash } : {}),
        ...(input.returnedContentHash ? { returnedContentHash: input.returnedContentHash } : {}),
        ...(input.cacheFingerprintStrategy !== undefined
            ? { cacheFingerprintStrategy: input.cacheFingerprintStrategy }
            : {}),
        ...(input.cacheStats !== undefined ? { cacheStats: input.cacheStats } : {}),
    };
}
