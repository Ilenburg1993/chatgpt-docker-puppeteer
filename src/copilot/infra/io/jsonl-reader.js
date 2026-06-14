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
const DEFAULT_MAX_REPAIR_SCAN_BYTES = 16 * 1024 * 1024;

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
 *     maxRepairScanBytes?: number;
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
    const maxRepairScanBytes = Math.max(
        maxTrailingRecordBytes,
        Math.trunc(options.maxRepairScanBytes ?? DEFAULT_MAX_REPAIR_SCAN_BYTES),
    );
    try {
        const { value } = await withIoResourceLock(
            filePath,
            async () => {
                /** @type {import('node:fs/promises').FileHandle | null} */
                let handle = null;
                try {
                    handle = await open(filePath, 'r+');
                    const { size } = await handle.stat();
                    if (size === 0) return repairResult('empty', size, size);

                    const trailingByte = Buffer.alloc(1);
                    await handle.read(trailingByte, 0, 1, size - 1);
                    if (trailingByte[0] === 0x0a) return repairResult('newline-terminated', size, size);

                    const recordStart = await findTrailingRecordStart(handle, size, maxRepairScanBytes);
                    if (recordStart === null || (recordStart === 0 && size > maxTrailingRecordBytes)) {
                        return repairResult('trailing-record-too-large', size, size);
                    }
                    const recordBytes = size - recordStart;
                    const recordBuffer = Buffer.alloc(recordBytes);
                    await handle.read(recordBuffer, 0, recordBytes, recordStart);
                    const record = recordBuffer.toString('utf8');
                    try {
                        JSON.parse(record);
                        return repairResult('valid-trailing-record', size, size);
                    } catch {
                        await options.onPhase?.('before-truncate', {
                            filePath,
                            previousBytes: size,
                            finalBytes: recordStart,
                        });
                        await handle.truncate(recordStart);
                        if (options.flushToDisk !== false) await handle.sync();
                        await options.onPhase?.('after-truncate', {
                            filePath,
                            previousBytes: size,
                            finalBytes: recordStart,
                        });
                        return repairResult('invalid-trailing-partial', size, recordStart);
                    }
                } finally {
                    await handle?.close();
                }
            },
            { operation: 'jsonl-repair', target: filePath, riskClass: 'high' },
        );
        return value;
    } catch (error) {
        const code = /** @type {{ code?: unknown }} */ (error)?.code;
        if (code === 'ENOENT') return repairResult('missing', 0, 0);
        throw error;
    }
}

/**
 * Procura o início da última linha JSONL a partir do fim, com limite estrito de bytes para evitar varredura/memória
 * sem bound em arquivos corrompidos ou registros anormalmente grandes.
 *
 * @param {import('node:fs/promises').FileHandle} handle
 * @param {number} size
 * @param {number} maxScanBytes
 * @returns {Promise<number | null>}
 */
async function findTrailingRecordStart(handle, size, maxScanBytes) {
    let searchEnd = size;
    let scannedBytes = 0;
    while (searchEnd > 0 && scannedBytes < maxScanBytes) {
        const readSize = Math.min(DEFAULT_BLOCK_SIZE, searchEnd, maxScanBytes - scannedBytes);
        const readStart = searchEnd - readSize;
        const buffer = Buffer.alloc(readSize);
        const { bytesRead } = await handle.read(buffer, 0, readSize, readStart);
        const chunk = bytesRead === readSize ? buffer : buffer.subarray(0, bytesRead);
        const lastNewline = chunk.lastIndexOf(0x0a);
        if (lastNewline >= 0) return readStart + lastNewline + 1;
        scannedBytes += bytesRead;
        searchEnd = readStart;
    }
    return searchEnd === 0 ? 0 : null;
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
