// @ts-check
/**
 * Leitura tolerante da cauda de arquivos JSONL.
 *
 * @module copilot/infra/io/jsonl-reader
 */

import { open } from 'node:fs/promises';
import { withIoResourceLock } from '../io-locks.js';

const DEFAULT_BLOCK_SIZE = 65_536;
const DEFAULT_MAX_TRAILING_RECORD_BYTES = 4 * 1024 * 1024;

/**
 * @typedef {{
 *     repaired: boolean;
 *     reason: 'missing' | 'empty' | 'newline-terminated' | 'valid-trailing-record' | 'trailing-record-too-large' | 'invalid-trailing-partial';
 *     previousBytes: number;
 *     finalBytes: number;
 *     truncatedBytes: number;
 * }} JsonlTrailingRepairResult
 */

/**
 * Remove fisicamente apenas uma última linha JSONL inválida, sob o mesmo lock canônico usado pelos writers.
 *
 * @param {string} filePath
 * @param {{
 *     maxTrailingRecordBytes?: number;
 *     flushToDisk?: boolean;
 *     onPhase?: (phase: string, details: Record<string, unknown>) => void | Promise<void>;
 * }} [options]
 * @returns {Promise<JsonlTrailingRepairResult>}
 */
export async function repairJsonlTrailingPartial(filePath, options = {}) {
    const maxTrailingRecordBytes = Math.max(
        1_024,
        Math.trunc(options.maxTrailingRecordBytes ?? DEFAULT_MAX_TRAILING_RECORD_BYTES),
    );
    try {
        const { value } = await withIoResourceLock(filePath, async () => {
            /** @type {import('node:fs/promises').FileHandle | null} */
            let handle = null;
            try {
                handle = await open(filePath, 'r+');
                const { size } = await handle.stat();
                if (size === 0) return repairResult('empty', size, size);

                const readStart = Math.max(0, size - maxTrailingRecordBytes);
                const trailing = Buffer.alloc(size - readStart);
                await handle.read(trailing, 0, trailing.byteLength, readStart);
                if (trailing.at(-1) === 0x0a) return repairResult('newline-terminated', size, size);

                const lastNewline = trailing.lastIndexOf(0x0a);
                if (readStart > 0 && lastNewline < 0) return repairResult('trailing-record-too-large', size, size);
                const recordStart = lastNewline < 0 ? 0 : readStart + lastNewline + 1;
                const record = trailing.subarray(lastNewline + 1).toString('utf8');
                try {
                    JSON.parse(record);
                    return repairResult('valid-trailing-record', size, size);
                } catch {
                    await options.onPhase?.('before-truncate', { filePath, previousBytes: size, finalBytes: recordStart });
                    await handle.truncate(recordStart);
                    if (options.flushToDisk !== false) await handle.sync();
                    await options.onPhase?.('after-truncate', { filePath, previousBytes: size, finalBytes: recordStart });
                    return repairResult('invalid-trailing-partial', size, recordStart);
                }
            } finally {
                await handle?.close();
            }
        });
        return value;
    } catch (error) {
        const code = /** @type {{ code?: unknown }} */ (error)?.code;
        if (code === 'ENOENT') return repairResult('missing', 0, 0);
        throw error;
    }
}

/**
 * @param {JsonlTrailingRepairResult['reason']} reason
 * @param {number} previousBytes
 * @param {number} finalBytes
 * @returns {JsonlTrailingRepairResult}
 */
function repairResult(reason, previousBytes, finalBytes) {
    return {
        repaired: reason === 'invalid-trailing-partial',
        reason,
        previousBytes,
        finalBytes,
        truncatedBytes: Math.max(0, previousBytes - finalBytes),
    };
}

/**
 * @param {string} filePath
 * @param {{
 *     maxLines?: number;
 *     blockSize?: number;
 *     repairTrailingPartial?: boolean;
 *     maxTrailingRecordBytes?: number;
 *     flushRepairToDisk?: boolean;
 * }} [options]
 * @returns {Promise<{
 *     records: unknown[];
 *     invalidLines: number;
 *     trailingPartialIgnored: boolean;
 *     trailingRepair: JsonlTrailingRepairResult | null;
 * }>}
 */
export async function readJsonlTail(filePath, options = {}) {
    const maxLines = Math.max(1, Math.trunc(options.maxLines ?? 50));
    const blockSize = Math.max(1_024, Math.trunc(options.blockSize ?? DEFAULT_BLOCK_SIZE));
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
        if (size === 0) return { records: [], invalidLines: 0, trailingPartialIgnored: false, trailingRepair };

        const finalByte = Buffer.alloc(1);
        await handle.read(finalByte, 0, 1, size - 1);
        const hasTrailingNewline = finalByte[0] === 0x0a;
        let remaining = size;
        let newlineCount = 0;
        let collectedBytes = 0;
        /** @type {Buffer[]} */
        const chunks = [];
        while (remaining > 0 && newlineCount <= maxLines) {
            const readSize = Math.min(blockSize, remaining);
            remaining -= readSize;
            const buffer = Buffer.alloc(readSize);
            await handle.read(buffer, 0, readSize, remaining);
            chunks.unshift(buffer);
            collectedBytes += readSize;
            for (const byte of buffer) {
                if (byte === 0x0a) newlineCount += 1;
            }
        }
        const split = Buffer.concat(chunks, collectedBytes).toString('utf8').split('\n');
        if (remaining > 0) split.shift();
        const lines = split.filter((line) => line.trim()).slice(-maxLines);

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
        return { records, invalidLines, trailingPartialIgnored, trailingRepair };
    } catch (error) {
        const code = /** @type {{ code?: unknown }} */ (error)?.code;
        if (code === 'ENOENT') return { records: [], invalidLines: 0, trailingPartialIgnored: false, trailingRepair };
        throw error;
    } finally {
        await handle?.close();
    }
}
