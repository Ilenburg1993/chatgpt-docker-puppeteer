// @ts-check
/** Read-only JSONL tail bound to one already-authorized file identity. */
import path from 'node:path';
import { normalizeJsonlLimit } from '../codec/index.js';
import { parseJsonlTailChunks } from '../kernel/index.js';

const DEFAULT_MAX_TAIL_BYTES = 16 * 1024 * 1024;
const MAX_TAIL_LINES = 10_000;
const MAX_TAIL_BYTES = 64 * 1024 * 1024;

/**
 * @typedef {{
 *   readBytesRangeFresh:(filePath:string, options:{maxBytes:number;fromEnd:true;rejectSymlink:true})=>Promise<{
 *     content:Buffer;bytesRead:number;sizeBytes:number;truncatedBefore:boolean;
 *   }>;
 * }} AuthorizedJsonlTailIo
 */

/**
 * @param {{
 *   filePath:string|(()=>string);
 *   io:AuthorizedJsonlTailIo;
 *   maxReadBytes?:number;
 * }} options
 */
export function createBoundJsonlTailReader(options) {
    const io = assertAuthorizedTailIo(options?.io);
    const resolveFilePath = createBoundPathResolver(options?.filePath);
    const ownerMaxBytes = normalizeJsonlLimit(options.maxReadBytes, DEFAULT_MAX_TAIL_BYTES, 1_024, MAX_TAIL_BYTES);

    return Object.freeze({
        /**
         * @param {{maxLines?:number;maxBytes?:number}} [request]
         */
        async readTail(request = {}) {
            const maxLines = normalizeJsonlLimit(request.maxLines, 50, 1, MAX_TAIL_LINES);
            const requestedMaxBytes = normalizeJsonlLimit(
                request.maxBytes,
                ownerMaxBytes,
                1_024,
                Math.min(ownerMaxBytes, MAX_TAIL_BYTES),
            );
            const filePath = resolveFilePath();
            try {
                const snapshot = await io.readBytesRangeFresh(filePath, {
                    maxBytes: requestedMaxBytes,
                    fromEnd: true,
                    rejectSymlink: true,
                });
                const original = snapshot.content;
                const parsed = parseJsonlTailChunks([original], {
                    maxLines,
                    truncatedBefore: snapshot.truncatedBefore,
                    hasTrailingNewline: original.length > 0 && original[original.length - 1] === 0x0a,
                });
                return {
                    records: [...parsed.records],
                    invalidLines: parsed.invalidLines,
                    trailingPartialIgnored: parsed.trailingPartialIgnored,
                    trailingRepair: null,
                    bytesRead: snapshot.bytesRead,
                    maxBytes: requestedMaxBytes,
                    truncatedByByteLimit: snapshot.truncatedBefore,
                };
            } catch (error) {
                const code = /** @type {{code?:unknown}} */ (error)?.code;
                if (code === 'ENOENT' || code === 'ENOTDIR') {
                    return {
                        records: [],
                        invalidLines: 0,
                        trailingPartialIgnored: false,
                        trailingRepair: null,
                        bytesRead: 0,
                        maxBytes: requestedMaxBytes,
                        truncatedByByteLimit: false,
                    };
                }
                throw error;
            }
        },
    });
}

/** @param {unknown} value */
function assertAuthorizedTailIo(value) {
    const io = /** @type {Partial<AuthorizedJsonlTailIo>|null|undefined} */ (value);
    if (!io || typeof io.readBytesRangeFresh !== 'function') {
        throw new TypeError('createBoundJsonlTailReader requires already-authorized readBytesRangeFresh IO.');
    }
    return /** @type {AuthorizedJsonlTailIo} */ (io);
}

/** @param {unknown} input */
function createBoundPathResolver(input) {
    if (typeof input === 'function') return () => path.resolve(assertPath(input()));
    const fixed = path.resolve(assertPath(input));
    return () => fixed;
}

/** @param {unknown} value */
function assertPath(value) {
    if (typeof value !== 'string' || !value.trim())
        throw new TypeError('JSONL bound filePath must be a non-empty string.');
    return value;
}
