// @ts-check
/** Atomic same-file exact-text patch batches under one lock/read/write cycle. */

import { buildIoMeta, createIoTraceId } from '#copilot/core';
import { acquireIoResourceLock } from '#copilot/infra/internal/concurrency/locks';
import { invalidateIoCoherencePath } from '#copilot/infra/internal/filesystem/invalidation/coherence';
import { buildSimpleTextDiffAroundLineRange, computeTextPatch } from '#copilot/infra/internal/filesystem/patch';
import { writeAtomicFileUnlocked } from '#copilot/infra/internal/filesystem/write';
import { decodeUtf8Buffer, sha256, toOwnedBuffer, utf8ByteLength } from '#copilot/infra/internal/platform';
import { assertExpectedSha256Digest, assertValidIoFilePath } from '#copilot/infra/internal/policy';
import {
    elapsedIoMs,
    getIoTelemetryRuntimeOption,
    nowIoMs,
    publishIoOperationResult,
} from '#copilot/infra/internal/telemetry';
import * as fs from 'node:fs/promises';
import { buildRollbackSnapshot, discardRollbackSidecar, isUnpublishedSnapshotConflict } from '../rollback/index.js';
import { annotatePatchBatchOperationError, annotatePatchRecoveryState } from './errors.js';
import { windowTextPreview } from './preview.js';

const DEFAULT_PATCH_DIFF_CONTEXT_LINES = 3;
const DEFAULT_PATCH_DIFF_MAX_LINES = 160;
const DEFAULT_PATCH_DIFF_MAX_BYTES = 48 * 1024;

/**
 * Apply several exact-text patches to one file under a single lock/read/write cycle. Operations are evaluated in order
 * against the virtual content produced by the previous operation, so same-file patch batches are atomic and can safely
 * depend on earlier replacements.
 *
 * @param {string} filePath
 * @param {{
 *     baselineExpectedHash?: string;
 *     operations: {
 *         oldString: string;
 *         newString: string;
 *         replaceAll?: boolean;
 *         expectedOccurrences?: number;
 *         occurrenceIndex?: number;
 *         expectedHash?: string;
 *         allowNoop?: boolean;
 *         diffContextLines?: number;
 *         maxDiffLines?: number;
 *         maxDiffBytes?: number;
 *         computeDiff?: boolean;
 *     }[];
 *     dryRun?: boolean;
 *     captureRollback?: boolean;
 *     rollbackPolicy?: ReturnType<typeof import('#copilot/infra/internal/filesystem/transaction').readIoRollbackPolicy>;
 *     capacityPreflight?: typeof import('#copilot/infra/internal/filesystem/transaction').preflightIoCapacity;
 *     onPhase?: (phase: string, details: Record<string, unknown>) => void | Promise<void>;
 *     durability?: import('#copilot/infra/internal/platform/node/filesystem').IoDurabilityMode;
 *     advisoryLimits?: Record<string, unknown>;
 * }} options
 * @param {ReturnType<typeof import('#copilot/infra/internal/filesystem/invalidation/bus').createIoInvalidationBusRuntime>} [invalidationBus]
 */
export async function patchTextBatchLocked(filePath, options, invalidationBus = undefined) {
    assertValidIoFilePath(filePath);
    if (!Array.isArray(options.operations) || options.operations.length === 0) {
        const error = /** @type {TypeError & { code?: string }} */ (new TypeError('patch batch requires operations'));
        error.code = 'ERR_PATCH_BATCH_EMPTY';
        throw error;
    }
    const traceId = createIoTraceId();
    const startedAt = nowIoMs();
    const riskClass = options.dryRun ? 'low' : 'high';
    const captureRollback = (options.captureRollback ?? options.rollbackPolicy?.enabled ?? false) && !options.dryRun;
    try {
        const lease = await acquireIoResourceLock(filePath, {
            operation: 'patch',
            target: filePath,
            riskClass,
        });
        const value = await (async () => {
            try {
                return await lease.run(async () => {
                    const rawContent = await fs.readFile(filePath);
                    const rawBuffer = typeof rawContent === 'string' ? toOwnedBuffer(rawContent) : rawContent;
                    const initialContent = typeof rawContent === 'string' ? rawContent : decodeUtf8Buffer(rawContent);
                    const previousHash = sha256(rawBuffer);
                    try {
                        assertExpectedSha256Digest(previousHash, options.baselineExpectedHash);
                    } catch (error) {
                        throw annotatePatchBatchOperationError(error, 0, 0, 'baseline-hash');
                    }
                    let currentContent = initialContent;
                    // Hash identity flows with the virtual content. Reusing H(n-1) as the next previousHash preserves
                    // every expectedHash precondition while avoiding a second full-content SHA pass per operation.
                    let currentHash = previousHash;
                    /** @type {Record<string, unknown>[]} */
                    const operations = [];

                    for (const [index, operation] of options.operations.entries()) {
                        try {
                            const operationPreviousHash = currentHash;
                            assertExpectedSha256Digest(operationPreviousHash, operation.expectedHash);
                            let patch;
                            try {
                                patch = computeTextPatch(currentContent, operation);
                            } catch (error) {
                                throw annotatePatchRecoveryState(
                                    error,
                                    operationPreviousHash,
                                    utf8ByteLength(currentContent, 'patch batch recovery current content'),
                                    {
                                        currentStateKind: 'virtual-batch',
                                        diskBaselineHash: previousHash,
                                        diskBaselineBytes: rawBuffer.byteLength,
                                    },
                                );
                            }
                            const updated = patch.updated;
                            const operationContentHash = patch.noop ? operationPreviousHash : sha256(updated);
                            const diffContextLines = operation.diffContextLines ?? DEFAULT_PATCH_DIFF_CONTEXT_LINES;
                            const shouldComputeDiff = operation.computeDiff === true;
                            const diff = shouldComputeDiff
                                ? buildSimpleTextDiffAroundLineRange(currentContent, updated, {
                                      firstMatchLine: patch.firstMatchLine,
                                      lastMatchLine: patch.lastMatchLine,
                                      lineDelta: patch.lineDelta,
                                      contextLines: diffContextLines,
                                      replacedOccurrences: patch.replacedOccurrences,
                                  })
                                : { diff: '', contextLines: diffContextLines, rangeOptimized: false };
                            const diffPreview = shouldComputeDiff
                                ? windowTextPreview(diff.diff, {
                                      maxLines: operation.maxDiffLines ?? DEFAULT_PATCH_DIFF_MAX_LINES,
                                      maxBytes: operation.maxDiffBytes ?? DEFAULT_PATCH_DIFF_MAX_BYTES,
                                  })
                                : { text: '', truncated: false, lines: 0, bytes: 0 };
                            operations.push({
                                index,
                                occurrences: patch.occurrences,
                                replacedOccurrences: patch.replacedOccurrences,
                                previousBytes: patch.previousBytes,
                                projectedBytes: patch.bytesWritten,
                                byteDelta: patch.byteDelta,
                                firstMatchLine: patch.firstMatchLine,
                                lastMatchLine: patch.lastMatchLine,
                                lineDelta: patch.lineDelta,
                                occurrenceIndex: patch.occurrenceIndex,
                                noop: patch.noop,
                                previousHash: operationPreviousHash,
                                contentHash: operationContentHash,
                                diffPreview: diffPreview.text,
                                diffPreviewTruncated: diffPreview.truncated,
                                diffPreviewLines: diffPreview.lines,
                                diffPreviewBytes: diffPreview.bytes,
                                diffContextLines: diff.contextLines,
                                diffRangeOptimized: diff.rangeOptimized === true,
                            });
                            currentContent = updated;
                            currentHash = operationContentHash;
                        } catch (error) {
                            throw annotatePatchBatchOperationError(error, index, operations.length, 'operation');
                        }
                    }

                    const finalNoop = currentContent === initialContent;
                    const contentHash = currentHash;
                    const projectedBytes = utf8ByteLength(currentContent, 'patch batch result');
                    const previousSnapshot =
                        finalNoop || !captureRollback
                            ? { snapshotBase64: null, snapshotTruncated: false, rollbackSidecar: null }
                            : await buildRollbackSnapshot(rawBuffer, {
                                  persistLarge: true,
                                  contentHash: previousHash,
                                  ...(options.rollbackPolicy ? { rollbackPolicy: options.rollbackPolicy } : {}),
                              });
                    let durability = null;
                    if (!options.dryRun && !finalNoop) {
                        try {
                            durability = await writeAtomicFileUnlocked(filePath, currentContent, {
                                expectedHash: previousHash,
                                ...(options.onPhase === undefined ? {} : { onPhase: options.onPhase }),
                                ...(options.durability === undefined ? {} : { durability: options.durability }),
                                ...(options.capacityPreflight === undefined
                                    ? {}
                                    : { capacityPreflight: options.capacityPreflight }),
                            });
                        } catch (error) {
                            if (isUnpublishedSnapshotConflict(error)) {
                                await discardRollbackSidecar(previousSnapshot.rollbackSidecar);
                            }
                            throw error;
                        }
                    }
                    return {
                        operations,
                        operationCount: operations.length,
                        previousBytes: rawBuffer.byteLength,
                        projectedBytes,
                        bytesWritten: options.dryRun || finalNoop ? 0 : projectedBytes,
                        byteDelta: projectedBytes - rawBuffer.byteLength,
                        previousHash,
                        contentHash,
                        noop: finalNoop,
                        dryRun: Boolean(options.dryRun),
                        rollbackCaptureEnabled: captureRollback,
                        previousSnapshotBase64: previousSnapshot.snapshotBase64,
                        previousSnapshotTruncated: previousSnapshot.snapshotTruncated,
                        previousRollbackSidecar: previousSnapshot.rollbackSidecar,
                        capacityPreflight: durability?.capacityPreflight ?? null,
                        durability,
                    };
                });
            } finally {
                await lease.releaseAsync();
            }
        })();
        const waitMs = lease.waitMs;
        if (!options.dryRun && !value.noop) invalidateIoCoherencePath(filePath, {}, invalidationBus);
        const io = publishIoOperationResult(
            buildIoMeta({
                operation: 'patch',
                target: filePath,
                targetKind: 'file',
                bytesWritten: value.bytesWritten,
                durationMs: elapsedIoMs(startedAt),
                engine: 'io-engine.patchTextBatchLocked',
                riskClass,
                traceId,
                advisoryLimits: {
                    ...(options.advisoryLimits ?? {}),
                    lockWaitMs: waitMs,
                    operationCount: value.operationCount,
                    previousHash: value.previousHash,
                    contentHash: value.contentHash,
                    dryRun: Boolean(options.dryRun),
                    projectedBytes: value.projectedBytes,
                    byteDelta: value.byteDelta,
                    capacityPreflight: value.capacityPreflight,
                    durability: value.durability,
                    rollbackCaptureEnabled: value.rollbackCaptureEnabled,
                },
            }),
            true,
            undefined,
            getIoTelemetryRuntimeOption(options),
        );
        return { path: filePath, ...value, lockWaitMs: waitMs, io };
    } catch (error) {
        publishIoOperationResult(
            buildIoMeta({
                operation: 'patch',
                target: filePath,
                targetKind: 'file',
                durationMs: elapsedIoMs(startedAt),
                engine: 'io-engine.patchTextBatchLocked',
                riskClass,
                traceId,
            }),
            false,
            error,
            getIoTelemetryRuntimeOption(options),
        );
        throw error;
    }
}
