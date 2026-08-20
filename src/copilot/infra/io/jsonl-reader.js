// @ts-check
/**
 * Leitura tolerante da cauda de arquivos JSONL.
 *
 * @module copilot/infra/io/jsonl-reader
 */

import { open } from 'node:fs/promises';
import { withIoResourceLock } from '../io-locks.js';
import { assertSuccessfulSync, shouldFlushFile, syncFileHandleBestEffort } from './fs/durability.js';
import { runFileHandleOperation } from './fs/file-handle-lifecycle.js';

const DEFAULT_BLOCK_SIZE = 65_536;
const DEFAULT_MAX_TRAILING_RECORD_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_REPAIR_SCAN_BYTES = 16 * 1024 * 1024;
const DEFAULT_MAX_TAIL_BYTES = 16 * 1024 * 1024;
const MAX_TAIL_LINES = 10_000;
const MAX_BLOCK_SIZE = 1024 * 1024;
const MAX_TAIL_BYTES = 64 * 1024 * 1024;

/**
 * @param {Buffer | Uint8Array} bytes
 * @returns {string}
 */
function decodeJsonlUtf8(bytes) {
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (cause) {
        throw Object.assign(new Error('JSONL contém bytes inválidos para UTF-8.', { cause }), {
            code: 'EUTF8JSONL',
        });
    }
}

/**
 * @param {unknown} value
 * @param {number} fallback
 * @param {number} minimum
 * @param {number} maximum
 * @returns {number}
 */
function normalizeJsonlLimit(value, fallback, minimum, maximum) {
    const numeric = Number(value ?? fallback);
    if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
    return Math.min(maximum, Math.max(minimum, Math.trunc(numeric)));
}

/**
 * @typedef {{
 *     repaired: boolean;
 *     reason:
 *         | 'missing'
 *         | 'empty'
 *         | 'newline-terminated'
 *         | 'valid-trailing-record'
 *         | 'trailing-record-too-large'
 *         | 'invalid-trailing-partial';
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
 *     durability?: import('./fs/durability.js').IoDurabilityMode;
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
    const durability = options.durability ?? (options.flushToDisk === false ? 'none' : 'file');
    const fileFlushRequested = shouldFlushFile(durability);
    try {
        const { value } = await withIoResourceLock(
            filePath,
            async () => {
                const handle = await open(filePath, 'r+');
                let truncateApplied = false;
                return runFileHandleOperation(
                    handle,
                    async () => {
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
                        const record = decodeJsonlUtf8(recordBuffer);
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
                            truncateApplied = true;
                            if (fileFlushRequested) {
                                await options.onPhase?.('before-file-sync', {
                                    filePath,
                                    previousBytes: size,
                                    finalBytes: recordStart,
                                });
                                const fileSync = await syncFileHandleBestEffort(handle);
                                await options.onPhase?.('after-file-sync', {
                                    filePath,
                                    previousBytes: size,
                                    finalBytes: recordStart,
                                    ...fileSync,
                                });
                                assertSuccessfulSync(fileSync, {
                                    code: 'EFILESYNC',
                                    message: `Falha ao sincronizar repair JSONL: ${filePath}`,
                                });
                            }
                            await options.onPhase?.('after-truncate', {
                                filePath,
                                previousBytes: size,
                                finalBytes: recordStart,
                            });
                            return repairResult('invalid-trailing-partial', size, recordStart);
                        }
                    },
                    {
                        mutationApplied: () => truncateApplied,
                        operationPhase: 'jsonl-truncate-confirmation',
                        closePhase: 'jsonl-truncate-close',
                        paths: [filePath],
                    },
                );
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
 * Procura o início da última linha JSONL a partir do fim, com limite estrito de bytes para evitar varredura/memória sem
 * bound em arquivos corrompidos ou registros anormalmente grandes.
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
 * @param {Buffer[]} chunks
 * @returns {string}
 */
function decodeJsonlChunks(chunks) {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    /** @type {string[]} */
    const decoded = [];
    try {
        for (const chunk of chunks) {
            const text = decoder.decode(chunk, { stream: true });
            if (text) decoded.push(text);
        }
        const tail = decoder.decode();
        if (tail) decoded.push(tail);
        return decoded.join('');
    } catch (cause) {
        throw Object.assign(new Error('JSONL contém bytes inválidos para UTF-8.', { cause }), {
            code: 'EUTF8JSONL',
        });
    }
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
