// @ts-check
/** Bounded reverse tail reader for JSONL, optionally repairing one trailing partial record first. */
import { open } from 'node:fs/promises';
import { decodeJsonlChunks, normalizeJsonlLimit } from './codec.js';
import { repairJsonlTrailingPartial } from './repair.js';

const DEFAULT_BLOCK_SIZE = 65_536;
const DEFAULT_MAX_TAIL_BYTES = 16 * 1024 * 1024;
const MAX_TAIL_LINES = 10_000;
const MAX_BLOCK_SIZE = 1024 * 1024;
const MAX_TAIL_BYTES = 64 * 1024 * 1024;
/** @typedef {import('./repair.js').JsonlTrailingRepairResult} JsonlTrailingRepairResult */

/**
 * @param {string} filePath
 * @param {{
 *     maxLines?: number;
 *     blockSize?: number;
 *     maxBytes?: number;
 *     repairTrailingPartial?: boolean;
 *     maxTrailingRecordBytes?: number;
 *     flushRepairToDisk?: boolean;
 * }} [options]
 * @returns {Promise<{
 *     records: unknown[];
 *     invalidLines: number;
 *     trailingPartialIgnored: boolean;
 *     trailingRepair: JsonlTrailingRepairResult | null;
 *     bytesRead: number;
 *     maxBytes: number;
 *     truncatedByByteLimit: boolean;
 * }>}
 */
export async function readJsonlTail(filePath, options = {}) {
    const maxLines = normalizeJsonlLimit(options.maxLines, 50, 1, MAX_TAIL_LINES);
    const blockSize = normalizeJsonlLimit(options.blockSize, DEFAULT_BLOCK_SIZE, 1_024, MAX_BLOCK_SIZE);
    const maxBytes = normalizeJsonlLimit(options.maxBytes, DEFAULT_MAX_TAIL_BYTES, 1_024, MAX_TAIL_BYTES);
    const trailingRepair = options.repairTrailingPartial
        ? await repairJsonlTrailingPartial(filePath, {
              ...(options.maxTrailingRecordBytes === undefined
                  ? {}
                  : { maxTrailingRecordBytes: options.maxTrailingRecordBytes }),
              ...(options.flushRepairToDisk === undefined ? {} : { flushToDisk: options.flushRepairToDisk }),
          })
        : null;
    /** @type {import('node:fs/promises').FileHandle | null} */
    let handle = null;
    try {
        handle = await open(filePath, 'r');
        const { size } = await handle.stat();
        if (size === 0) {
            return {
                records: [],
                invalidLines: 0,
                trailingPartialIgnored: false,
                trailingRepair,
                bytesRead: 0,
                maxBytes,
                truncatedByByteLimit: false,
            };
        }

        let remaining = size;
        let newlineCount = 0;
        let collectedBytes = 0;
        /** @type {Buffer[]} */
        const chunks = [];
        while (remaining > 0 && newlineCount <= maxLines && collectedBytes < maxBytes) {
            const readSize = Math.min(blockSize, remaining, maxBytes - collectedBytes);
            remaining -= readSize;
            const buffer = Buffer.alloc(readSize);
            const { bytesRead } = await handle.read(buffer, 0, readSize, remaining);
            const chunk = bytesRead === readSize ? buffer : buffer.subarray(0, bytesRead);
            chunks.push(chunk);
            collectedBytes += bytesRead;
            for (const byte of chunk) {
                if (byte === 0x0a) newlineCount += 1;
            }
        }
        const truncatedByByteLimit = remaining > 0 && collectedBytes >= maxBytes && newlineCount <= maxLines;
        const newestChunk = chunks[0];
        const hasTrailingNewline = newestChunk?.[newestChunk.length - 1] === 0x0a;
        const chronologicalChunks = chunks.reverse();
        const completeChunks =
            remaining > 0 ? discardLeadingPartialJsonlLine(chronologicalChunks) : chronologicalChunks;
        const text = decodeJsonlChunks(completeChunks);
        const lines = collectJsonlTailLines(text, maxLines);

        /** @type {unknown[]} */
        const records = [];
        let invalidLines = 0;
        let trailingPartialIgnored = false;
        for (let index = 0; index < lines.length; index += 1) {
            const line = lines[index];
            if (!line) continue;
            try {
                records.push(JSON.parse(line));
            } catch {
                invalidLines += 1;
                if (!hasTrailingNewline && index === lines.length - 1) trailingPartialIgnored = true;
            }
        }
        return {
            records,
            invalidLines,
            trailingPartialIgnored,
            trailingRepair,
            bytesRead: collectedBytes,
            maxBytes,
            truncatedByByteLimit,
        };
    } catch (error) {
        const code = /** @type {{ code?: unknown }} */ (error)?.code;
        if (code === 'ENOENT') {
            return {
                records: [],
                invalidLines: 0,
                trailingPartialIgnored: false,
                trailingRepair,
                bytesRead: 0,
                maxBytes,
                truncatedByByteLimit: false,
            };
        }
        throw error;
    } finally {
        await handle?.close();
    }
}

/**
 * @param {Buffer[]} chunks
 * @returns {Buffer[]}
 */
function discardLeadingPartialJsonlLine(chunks) {
    for (let index = 0; index < chunks.length; index += 1) {
        const newlineIndex = chunks[index]?.indexOf(0x0a) ?? -1;
        if (newlineIndex < 0) continue;
        const remainder = chunks[index]?.subarray(newlineIndex + 1);
        return [...(remainder && remainder.byteLength > 0 ? [remainder] : []), ...chunks.slice(index + 1)];
    }
    return [];
}

/**
 * @param {string} text
 * @param {number} maxLines
 * @returns {string[]}
 */
function collectJsonlTailLines(text, maxLines) {
    const ring = new Array(maxLines);
    let count = 0;
    let next = 0;
    let start = 0;
    for (let index = 0; index <= text.length; index += 1) {
        if (index < text.length && text.charCodeAt(index) !== 10) continue;
        const line = text.slice(start, index);
        start = index + 1;
        if (!line.trim()) continue;
        ring[next] = line;
        next = (next + 1) % maxLines;
        count = Math.min(maxLines, count + 1);
    }
    const first = count === maxLines ? next : 0;
    return Array.from({ length: count }, (_, index) => /** @type {string} */ (ring[(first + index) % maxLines]));
}
