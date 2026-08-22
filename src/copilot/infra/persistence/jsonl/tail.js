// @ts-check
/** Bounded reverse tail reader for JSONL, optionally repairing one trailing partial record first. */
import { open } from 'node:fs/promises';
import { normalizeJsonlLimit } from './codec/index.js';
import { parseJsonlTailChunks } from './kernel/index.js';
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
        const parsed = parseJsonlTailChunks(chunks.reverse(), {
            maxLines,
            truncatedBefore: remaining > 0,
            hasTrailingNewline,
        });
        return {
            records: [...parsed.records],
            invalidLines: parsed.invalidLines,
            trailingPartialIgnored: parsed.trailingPartialIgnored,
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
