// @ts-check
/** Single exact-text locked patch with atomic publish, preview and rollback evidence. */

import { buildIoMeta, createIoTraceId } from '#copilot/core';
import { acquireIoResourceLock } from '#copilot/infra/internal/concurrency/locks';
import { invalidateIoCoherencePath } from '#copilot/infra/internal/filesystem/invalidation';
import { buildSimpleTextDiffAroundLineRange, computeTextPatch } from '#copilot/infra/internal/filesystem/patch';
import { shouldCaptureIoRollback } from '#copilot/infra/internal/filesystem/transaction';
import { writeAtomicFileUnlocked } from '#copilot/infra/internal/filesystem/write';
import { decodeUtf8Buffer, sha256, toOwnedBuffer } from '#copilot/infra/internal/platform';
import { assertExpectedSha256, assertValidIoFilePath } from '#copilot/infra/internal/policy';
import { elapsedIoMs, nowIoMs, publishIoOperationResult } from '#copilot/infra/internal/telemetry';
import * as fs from 'node:fs/promises';
import { buildRollbackSnapshot, discardRollbackSidecar, isUnpublishedSnapshotConflict } from '../rollback/index.js';
import { annotatePatchRecoveryState } from './errors.js';
import { windowTextPreview } from './preview.js';

const DEFAULT_PATCH_DIFF_CONTEXT_LINES = 3;
const DEFAULT_PATCH_DIFF_MAX_LINES = 160;
const DEFAULT_PATCH_DIFF_MAX_BYTES = 48 * 1024;

/**
 * Patch textual com read + write dentro do mesmo lock e preview otimizado quando seguro.
 *
 * @param {string} filePath
 * @param {{
 *     oldString: string;
 *     newString: string;
 *     replaceAll?: boolean;
 *     expectedOccurrences?: number;
 *     occurrenceIndex?: number;
 *     expectedHash?: string;
 *     dryRun?: boolean;
 *     allowNoop?: boolean;
 *     diffContextLines?: number;
 *     maxDiffLines?: number;
 *     maxDiffBytes?: number;
 *     computeDiff?: boolean;
 *     captureRollback?: boolean;
 *     onPhase?: (phase: string, details: Record<string, unknown>) => void | Promise<void>;
 *     durability?: import('#copilot/infra/internal/platform/node/filesystem').IoDurabilityMode;
 *     advisoryLimits?: Record<string, unknown>;
 * }} options
 */
export async function patchTextLocked(filePath, options) {
    assertValidIoFilePath(filePath);
    const traceId = createIoTraceId();
    const startedAt = nowIoMs();
    const riskClass = options.dryRun ? 'low' : 'high';
    const captureRollback = shouldCaptureIoRollback(options.captureRollback !== false) && !options.dryRun;
    try {
        const lease = await acquireIoResourceLock(filePath, {
            operation: 'patch',
            target: filePath,
            riskClass,
        });
        const value = await (async () => {
            try {
                return await lease.run(async () => {
                    const readStartedAt = nowIoMs();
                    const rawContent = await fs.readFile(filePath);
                    const readMs = elapsedIoMs(readStartedAt);
                    const rawBuffer = typeof rawContent === 'string' ? toOwnedBuffer(rawContent) : rawContent;
                    const content = typeof rawContent === 'string' ? rawContent : decodeUtf8Buffer(rawContent);
                    const previousHash = assertExpectedSha256(rawBuffer, options.expectedHash) ?? sha256(rawBuffer);
                    const patchStartedAt = nowIoMs();
                    let patch;
                    try {
                        patch = computeTextPatch(content, options);
                    } catch (error) {
                        throw annotatePatchRecoveryState(error, previousHash, rawBuffer.byteLength);
                    }
                    const patchMs = elapsedIoMs(patchStartedAt);
                    void readMs;
                    void patchMs;
                    const { updated, replacedOccurrences, bytesWritten } = patch;
                    const contentHash = sha256(updated);
                    const previousSnapshot =
                        patch.noop || !captureRollback
                            ? { snapshotBase64: null, snapshotTruncated: false, rollbackSidecar: null }
                            : await buildRollbackSnapshot(rawBuffer, {
                                  persistLarge: true,
                                  contentHash: previousHash,
                              });
                    const diffContextLines = options.diffContextLines ?? DEFAULT_PATCH_DIFF_CONTEXT_LINES;
                    const { firstMatchLine, lastMatchLine, lineDelta } = patch;
                    const shouldComputeDiff = options.computeDiff !== false;
                    const diff = shouldComputeDiff
                        ? buildSimpleTextDiffAroundLineRange(content, updated, {
                              firstMatchLine,
                              lastMatchLine,
                              lineDelta,
                              contextLines: diffContextLines,
                              replacedOccurrences: replacedOccurrences,
                          })
                        : { diff: '', contextLines: diffContextLines, rangeOptimized: false };
                    const diffPreview = shouldComputeDiff
                        ? windowTextPreview(diff.diff, {
                              maxLines: options.maxDiffLines ?? DEFAULT_PATCH_DIFF_MAX_LINES,
                              maxBytes: options.maxDiffBytes ?? DEFAULT_PATCH_DIFF_MAX_BYTES,
                          })
                        : { text: '', truncated: false, lines: 0, bytes: 0 };
                    let durability = null;
                    if (!options.dryRun && !patch.noop) {
                        try {
                            durability = await writeAtomicFileUnlocked(filePath, updated, {
                                expectedHash: previousHash,
                                ...(options.onPhase === undefined ? {} : { onPhase: options.onPhase }),
                                ...(options.durability === undefined ? {} : { durability: options.durability }),
                            });
                        } catch (error) {
                            if (isUnpublishedSnapshotConflict(error)) {
                                await discardRollbackSidecar(previousSnapshot.rollbackSidecar);
                            }
                            throw error;
                        }
                    }
                    return {
                        occurrences: patch.occurrences,
                        replacedOccurrences,
                        bytesWritten: options.dryRun || patch.noop ? 0 : bytesWritten,
                        projectedBytes: bytesWritten,
                        previousBytes: patch.previousBytes,
                        byteDelta: patch.byteDelta,
                        oldStringBytes: patch.oldStringBytes,
                        newStringBytes: patch.newStringBytes,
                        firstMatchLine: patch.firstMatchLine,
                        lastMatchLine: patch.lastMatchLine,
                        lineDelta: patch.lineDelta,
                        occurrenceIndex: patch.occurrenceIndex,
                        noop: patch.noop,
                        diffPreview: diffPreview.text,
                        diffPreviewTruncated: diffPreview.truncated,
                        diffPreviewLines: diffPreview.lines,
                        diffPreviewBytes: diffPreview.bytes,
                        diffContextLines: diff.contextLines,
                        diffRangeOptimized: diff.rangeOptimized === true,
                        computeDiff: shouldComputeDiff,
                        previousHash,
                        contentHash,
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
        if (!options.dryRun && !value.noop) invalidateIoCoherencePath(filePath);
        const io = publishIoOperationResult(
            buildIoMeta({
                operation: 'patch',
                target: filePath,
                targetKind: 'file',
                bytesWritten: value.bytesWritten,
                durationMs: elapsedIoMs(startedAt),
                engine: 'io-engine.patchTextLocked',
                riskClass,
                traceId,
                advisoryLimits: {
                    ...(options.advisoryLimits ?? {}),
                    lockWaitMs: waitMs,
                    expectedHash: options.expectedHash ?? null,
                    contentHash: value.contentHash,
                    dryRun: Boolean(options.dryRun),
                    computeDiff: value.computeDiff,
                    diffRangeOptimized: value.diffRangeOptimized,
                    occurrenceIndex: options.occurrenceIndex ?? null,
                    replaceAll: Boolean(options.replaceAll),
                    occurrences: value.occurrences,
                    replacedOccurrences: value.replacedOccurrences,
                    projectedBytes: value.projectedBytes,
                    byteDelta: value.byteDelta,
                    capacityPreflight: value.capacityPreflight,
                    durability: value.durability,
                    rollbackCaptureEnabled: value.rollbackCaptureEnabled,
                    rollbackSidecar: value.previousRollbackSidecar
                        ? {
                              available: true,
                              bytes: value.previousRollbackSidecar.bytes,
                              expiresAtMs: value.previousRollbackSidecar.expiresAtMs,
                          }
                        : null,
                },
            }),
            true,
        );
        return { path: filePath, ...value, lockWaitMs: waitMs, io };
    } catch (error) {
        publishIoOperationResult(
            buildIoMeta({
                operation: 'patch',
                target: filePath,
                targetKind: 'file',
                durationMs: elapsedIoMs(startedAt),
                engine: 'io-engine.patchTextLocked',
                riskClass,
                traceId,
            }),
            false,
            error,
        );
        throw error;
    }
}
