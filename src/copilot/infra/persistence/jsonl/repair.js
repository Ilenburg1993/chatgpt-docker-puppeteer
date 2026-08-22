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
import {
    classifyJsonlTrailingCandidate,
    createJsonlTrailingRepairResult,
    lastJsonlNewlineOffset,
    resolveJsonlRepairPolicy,
} from './kernel/index.js';

const DEFAULT_BLOCK_SIZE = 65_536;
/** @typedef {import('./kernel/repair.js').JsonlTrailingRepairResult} JsonlTrailingRepairResult */

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
    const { maxTrailingRecordBytes, maxRepairScanBytes } = resolveJsonlRepairPolicy(options);
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
                        if (size === 0) return createJsonlTrailingRepairResult('empty', size, size);

                        const trailingByte = Buffer.alloc(1);
                        await handle.read(trailingByte, 0, 1, size - 1);
                        if (trailingByte[0] === 0x0a) {
                            return createJsonlTrailingRepairResult('newline-terminated', size, size);
                        }

                        const recordStart = await findTrailingRecordStart(handle, size, maxRepairScanBytes);
                        if (recordStart === null || (recordStart === 0 && size > maxTrailingRecordBytes)) {
                            const classification = classifyJsonlTrailingCandidate({
                                recordStart,
                                size,
                                maxTrailingRecordBytes,
                                recordBuffer: null,
                            });
                            return createJsonlTrailingRepairResult(
                                classification.reason,
                                size,
                                classification.finalBytes,
                            );
                        }
                        const recordBytes = size - recordStart;
                        const recordBuffer = Buffer.alloc(recordBytes);
                        await handle.read(recordBuffer, 0, recordBytes, recordStart);
                        const classification = classifyJsonlTrailingCandidate({
                            recordStart,
                            size,
                            maxTrailingRecordBytes,
                            recordBuffer,
                        });
                        if (classification.reason === 'valid-trailing-record') {
                            return createJsonlTrailingRepairResult(
                                classification.reason,
                                size,
                                classification.finalBytes,
                            );
                        }
                        const finalBytes = classification.finalBytes;
                        await options.onPhase?.('before-truncate', { filePath, previousBytes: size, finalBytes });
                        await handle.truncate(finalBytes);
                        truncateApplied = true;
                        if (fileFlushRequested) {
                            await options.onPhase?.('before-file-sync', { filePath, previousBytes: size, finalBytes });
                            const fileSync = await syncFileHandleBestEffort(handle);
                            await options.onPhase?.('after-file-sync', {
                                filePath,
                                previousBytes: size,
                                finalBytes,
                                ...fileSync,
                            });
                            assertSuccessfulSync(fileSync, {
                                code: 'EFILESYNC',
                                message: `Falha ao sincronizar repair JSONL: ${filePath}`,
                            });
                        }
                        await options.onPhase?.('after-truncate', { filePath, previousBytes: size, finalBytes });
                        return createJsonlTrailingRepairResult(classification.reason, size, finalBytes);
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
        if (code === 'ENOENT') return createJsonlTrailingRepairResult('missing', 0, 0);
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
        const lastNewline = lastJsonlNewlineOffset(chunk);
        if (lastNewline >= 0) return readStart + lastNewline + 1;
        scannedBytes += bytesRead;
        searchEnd = readStart;
    }
    return searchEnd === 0 ? 0 : null;
}
