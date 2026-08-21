// @ts-check
/** Locked repair of one invalid trailing JSONL partial record. */
import { withIoResourceLock } from '#copilot/infra/internal/concurrency/locks';
import { runFileHandleOperation } from '#copilot/infra/internal/filesystem/transaction';
import {
    assertSuccessfulSync,
    shouldFlushFile,
    syncFileHandleBestEffort,
} from '#copilot/infra/internal/platform/node/filesystem';
import { open } from 'node:fs/promises';
import { decodeJsonlUtf8 } from './codec.js';

const DEFAULT_BLOCK_SIZE = 65_536;
const DEFAULT_MAX_TRAILING_RECORD_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_REPAIR_SCAN_BYTES = 16 * 1024 * 1024;
/**
 * @typedef {{ repaired:boolean; reason:'missing'|'empty'|'newline-terminated'|'valid-trailing-record'|'trailing-record-too-large'|'invalid-trailing-partial'; previousBytes:number; finalBytes:number; truncatedBytes:number }} JsonlTrailingRepairResult
 */

/**
 * Remove fisicamente apenas uma última linha JSONL inválida, sob o mesmo lock canônico usado pelos writers.
 *
 * @param {string} filePath
 * @param {{
 *     maxTrailingRecordBytes?: number;
 *     maxRepairScanBytes?: number;
 *     flushToDisk?: boolean;
 *     durability?: import('#copilot/infra/internal/platform/node/filesystem').IoDurabilityMode;
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
