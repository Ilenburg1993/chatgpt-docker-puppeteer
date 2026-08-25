// @ts-check
/** High-level single-file repository write/query operations. */

import { clearRepoReadFileResultCacheForResolvedPath } from '#copilot/mcp/public/workspace/repository/read-cache';
import {
    buildQuarantineId,
    listQuarantineMetadata,
    quarantineResolvedFile,
    readQuarantineMetadata,
    resolveQuarantinePaths,
    restoreQuarantinedFile,
    sha256File,
} from '../quarantine/runtime.js';
import {
    createResolvedTarget,
    moveResolvedTargets,
    pathExists,
    regularFileExists,
    repoWriteStat,
    writeResolvedTarget,
} from '../runtime.js';

/** @typedef {import('../contracts.js').RepoWriteRuntime} RepoWriteRuntime */
/** @typedef {{ diff: string; truncated: boolean; lines: number; bytes: number; contextLines: number }} RepoWriteDiff */
/** @typedef {{ ok: true; value: Record<string, unknown>; audit?: Record<string, unknown>; text?: string; diff?: RepoWriteDiff } | { ok: false; message: string; details: Record<string, unknown>; audit?: Record<string, unknown> }} RepoWriteOperationOutcome */

/** @param {unknown} error */
function errorCode(error) {
    return error && typeof error === 'object' && 'code' in error ? error.code : undefined;
}

/** @param {string} message @param {Record<string, unknown>} details @returns {RepoWriteOperationOutcome} */
function failure(message, details) {
    return { ok: false, message, details };
}

/**
 * @param {string} contentA
 * @param {string} contentB
 * @param {{ contextLines?: number; maxLines?: number }} [options]
 * @returns {RepoWriteDiff}
 */
function buildInlineDiffPreview(contentA, contentB, options = {}) {
    const aLines = contentA.split('\n');
    const bLines = contentB.split('\n');
    let prefix = 0;
    while (prefix < aLines.length && prefix < bLines.length && aLines[prefix] === bLines[prefix]) prefix += 1;
    let suffix = 0;
    while (
        suffix < aLines.length - prefix &&
        suffix < bLines.length - prefix &&
        aLines[aLines.length - 1 - suffix] === bLines[bLines.length - 1 - suffix]
    )
        suffix += 1;
    const contextLines = Math.max(0, Math.min(20, Number(options.contextLines ?? 3)));
    const start = Math.max(0, prefix - contextLines);
    const aEnd = Math.min(aLines.length, aLines.length - suffix + contextLines);
    const bEnd = Math.min(bLines.length, bLines.length - suffix + contextLines);
    const rows = ['--- before', '+++ after'];
    for (let index = start; index < Math.max(aEnd, bEnd); index += 1) {
        const a = index < aEnd ? aLines[index] : undefined;
        const b = index < bEnd ? bLines[index] : undefined;
        if (a === b && a !== undefined) rows.push(` ${a}`);
        else {
            if (a !== undefined) rows.push(`-${a}`);
            if (b !== undefined) rows.push(`+${b}`);
        }
    }
    const maxLines = Math.max(1, Number(options.maxLines ?? 2_000));
    const truncated = rows.length > maxLines;
    const selected = truncated ? rows.slice(0, maxLines) : rows;
    const diff = selected.join('\n');
    return { diff, truncated, lines: rows.length, bytes: Buffer.byteLength(diff, 'utf8'), contextLines };
}

/**
 * @param {RepoWriteRuntime} runtime
 * @param {{ path:string; content:string; expectedHash?:string; dryRun?:boolean; diffContextLines?:number; maxDiffLines?:number; durability?: import('#copilot/infra/public/policy').IoDurabilityMode }} input
 * @returns {Promise<RepoWriteOperationOutcome>}
 */
export async function executeRepositoryWriteFile(runtime, input) {
    const resolved = await runtime.workspace.resolveWritePath(input.path, {
        issueMutableCapability: input.dryRun !== true,
    });
    if (!resolved.ok) return failure(resolved.reason, /** @type {Record<string, unknown>} */ (resolved));
    try {
        const previous = await runtime.io.readText(resolved.resolved);
        const diff = buildInlineDiffPreview(previous.content, input.content, {
            contextLines: input.diffContextLines ?? 3,
            maxLines: input.maxDiffLines ?? 2_000,
        });
        if (input.dryRun === true) {
            return {
                ok: true,
                value: {
                    success: true,
                    path: resolved.relative,
                    dryRun: true,
                    bytesWritten: 0,
                    previousBytes: previous.bytesRead,
                },
                diff,
                text: 'Write dry run complete; diff preview suppressed.',
                audit: {
                    event: 'repo_write_file_dry_run',
                    tool: 'repo_write_file',
                    path: resolved.relative,
                    previousBytes: previous.bytesRead,
                },
            };
        }
        const write = await writeResolvedTarget(runtime, resolved, input.content, {
            requireExists: true,
            ...(input.expectedHash ? { expectedHash: input.expectedHash } : {}),
            ...(input.durability ? { durability: input.durability } : {}),
            riskClass: 'high',
            advisoryLimits: {
                tool: 'repo_write_file',
                contentChars: input.content.length,
                expectedHash: input.expectedHash ?? null,
            },
        });
        clearRepoReadFileResultCacheForResolvedPath(resolved.resolved);
        return {
            ok: true,
            value: {
                success: true,
                path: resolved.relative,
                dryRun: false,
                bytesWritten: write.bytesWritten,
                previousBytes: previous.bytesRead,
                previousHash: write.previousHash,
                contentHash: write.contentHash,
                io: {
                    operation: write.io.operation,
                    targetKind: write.io.targetKind,
                    bytesWritten: write.io.bytesWritten,
                    durationMs: write.io.durationMs,
                    engine: write.io.engine,
                    traceId: write.io.traceId ?? null,
                },
            },
            diff,
            text: 'Write applied; diff preview suppressed.',
            audit: {
                event: 'repo_write_file_applied',
                tool: 'repo_write_file',
                path: resolved.relative,
                previousHash: write.previousHash,
                contentHash: write.contentHash,
                bytesWritten: write.bytesWritten,
                traceId: write.io.traceId ?? null,
            },
        };
    } catch (error) {
        return failure(error instanceof Error ? error.message : String(error), {
            path: resolved.relative,
            code: errorCode(error),
        });
    }
}

/**
 * @param {RepoWriteRuntime} runtime
 * @param {{ path:string; content?:string; createParentDirs?:boolean; dryRun?:boolean; maxDiffLines?:number; durability?: import('#copilot/infra/public/policy').IoDurabilityMode }} input
 * @returns {Promise<RepoWriteOperationOutcome>}
 */
export async function executeRepositoryCreateFile(runtime, input) {
    const resolved = await runtime.workspace.resolveWritePath(input.path, {
        issueMutableCapability: input.dryRun !== true,
    });
    if (!resolved.ok) return failure(resolved.reason, /** @type {Record<string, unknown>} */ (resolved));
    const content = input.content ?? '';
    const diff = buildInlineDiffPreview('', content, { contextLines: 0, maxLines: input.maxDiffLines ?? 2_000 });
    try {
        if (input.dryRun === true) {
            return {
                ok: true,
                value: { success: true, path: resolved.relative, dryRun: true, bytesWritten: 0 },
                diff,
                text: 'Create file dry run complete; diff preview suppressed.',
                audit: { event: 'repo_create_file_dry_run', tool: 'repo_create_file', path: resolved.relative },
            };
        }
        const write = await createResolvedTarget(runtime, resolved, content, {
            encoding: 'utf8',
            createParentDirs: input.createParentDirs !== false,
            failIfExists: true,
            ...(input.durability ? { durability: input.durability } : {}),
            riskClass: 'medium',
            advisoryLimits: { tool: 'repo_create_file', contentChars: content.length },
        });
        clearRepoReadFileResultCacheForResolvedPath(resolved.resolved);
        return {
            ok: true,
            value: {
                success: true,
                path: resolved.relative,
                dryRun: false,
                bytesWritten: write.bytesWritten,
                previousHash: write.previousHash,
                contentHash: write.contentHash,
                io: {
                    operation: write.io.operation,
                    targetKind: write.io.targetKind,
                    bytesWritten: write.io.bytesWritten,
                    durationMs: write.io.durationMs,
                    engine: write.io.engine,
                    traceId: write.io.traceId ?? null,
                },
            },
            diff,
            text: 'Create file applied; diff preview suppressed.',
            audit: {
                event: 'repo_create_file_applied',
                tool: 'repo_create_file',
                path: resolved.relative,
                contentHash: write.contentHash,
                bytesWritten: write.bytesWritten,
                traceId: write.io.traceId ?? null,
            },
        };
    } catch (error) {
        return failure(error instanceof Error ? error.message : String(error), {
            path: resolved.relative,
            code: errorCode(error),
        });
    }
}

/**
 * @param {RepoWriteRuntime} runtime
 * @param {{ source:string; destination:string; overwrite?:boolean; dryRun?:boolean }} input
 * @returns {Promise<RepoWriteOperationOutcome>}
 */
export async function executeRepositoryMoveFile(runtime, input) {
    const issueMutableCapability = input.dryRun !== true;
    const source = await runtime.workspace.resolveWritePath(input.source, { issueMutableCapability });
    if (!source.ok) return failure(source.reason, { ...source, field: 'source' });
    const destination = await runtime.workspace.resolveWritePath(input.destination, { issueMutableCapability });
    if (!destination.ok) return failure(destination.reason, { ...destination, field: 'destination' });
    try {
        const sourceStats = await repoWriteStat(runtime, source.resolved);
        const destinationExists = await pathExists(runtime, destination.resolved);
        if (destinationExists && input.overwrite !== true)
            return failure(`Destino ja existe: ${destination.relative}`, { code: 'EEXIST' });
        if (input.dryRun === true) {
            return {
                ok: true,
                value: {
                    success: true,
                    dryRun: true,
                    source: source.relative,
                    destination: destination.relative,
                    sourceBytes: sourceStats.size,
                    destinationExists,
                    overwrite: input.overwrite === true,
                },
                audit: {
                    event: 'repo_move_file_dry_run',
                    tool: 'repo_move_file',
                    source: source.relative,
                    destination: destination.relative,
                    overwrite: input.overwrite === true,
                },
            };
        }
        const moved = await moveResolvedTargets(runtime, source, destination, { overwrite: input.overwrite === true });
        return {
            ok: true,
            value: {
                success: true,
                dryRun: false,
                source: source.relative,
                destination: destination.relative,
                sourceBytes: moved.sourceBytes,
                sourceHash: moved.sourceHash,
                destinationPreviousHash: moved.destinationPreviousHash,
                destinationPreviousBytes: moved.destinationPreviousBytes,
                destinationPreviousSnapshotTruncated: moved.destinationPreviousSnapshotTruncated,
                overwrite: input.overwrite === true,
                io: {
                    operation: moved.io.operation,
                    targetKind: moved.io.targetKind,
                    bytesRead: moved.io.bytesRead,
                    durationMs: moved.io.durationMs,
                    engine: moved.io.engine,
                    traceId: moved.io.traceId ?? null,
                },
            },
            audit: {
                event: 'repo_move_file_applied',
                tool: 'repo_move_file',
                source: source.relative,
                destination: destination.relative,
                overwrite: input.overwrite === true,
                sourceHash: moved.sourceHash,
                destinationPreviousHash: moved.destinationPreviousHash,
                traceId: moved.io.traceId ?? null,
            },
        };
    } catch (error) {
        return failure(error instanceof Error ? error.message : String(error), {
            source: source.relative,
            destination: destination.relative,
            code: errorCode(error),
        });
    }
}

/** @param {RepoWriteRuntime} runtime @param {'quarantined'|'restored'|'all'} status @param {number} limit */
export async function listRepositoryQuarantine(runtime, status, limit) {
    const items = (await listQuarantineMetadata(runtime))
        .filter((item) => status === 'all' || item.status === status)
        .slice(0, limit);
    return { success: true, status, count: items.length, items };
}

/** @param {RepoWriteRuntime} runtime @param {string} quarantineId @param {boolean} includeHash @returns {Promise<RepoWriteOperationOutcome>} */
export async function inspectRepositoryQuarantinedFile(runtime, quarantineId, includeHash) {
    const metadata = await readQuarantineMetadata(runtime, quarantineId);
    if (!metadata)
        return failure('Quarantine metadata not found.', {
            code: 'ERR_QUARANTINE_NOT_FOUND',
            hint: 'Use repo_list_quarantine to discover available quarantineId values.',
            quarantineId,
        });
    const paths = resolveQuarantinePaths(runtime, metadata.quarantineId);
    const dataExists = await regularFileExists(runtime, paths.dataPath);
    const dataStats = dataExists ? await repoWriteStat(runtime, paths.dataPath) : null;
    const dataHash = dataExists && includeHash ? await sha256File(runtime, paths.dataPath) : null;
    return {
        ok: true,
        value: {
            success: true,
            quarantineId: metadata.quarantineId,
            metadata,
            dataExists,
            dataBytes: dataStats?.size ?? null,
            dataSha256: dataHash,
            restorable: metadata.status === 'quarantined' && dataExists,
        },
    };
}

/** @param {RepoWriteRuntime} runtime @param {{path:string;dryRun?:boolean}} input @returns {Promise<RepoWriteOperationOutcome>} */
export async function executeRepositoryQuarantineFile(runtime, input) {
    const resolved = await runtime.workspace.resolveWritePath(input.path);
    if (!resolved.ok) return failure(resolved.reason, /** @type {Record<string, unknown>} */ (resolved));
    try {
        const stats = await repoWriteStat(runtime, resolved.resolved);
        if (!stats.isFile())
            return failure('repo_quarantine_file move somente arquivos regulares.', {
                path: resolved.relative,
                code: 'ERR_QUARANTINE_NOT_FILE',
            });
        const quarantineId = buildQuarantineId(resolved.relative);
        const paths = resolveQuarantinePaths(runtime, quarantineId);
        if (input.dryRun === true) {
            return {
                ok: true,
                value: {
                    success: true,
                    dryRun: true,
                    path: resolved.relative,
                    quarantineId,
                    quarantinePath: runtime.workspace.toRelativePath(paths.dataPath),
                    metadataPath: runtime.workspace.toRelativePath(paths.metadataPath),
                    previousBytes: stats.size,
                },
                audit: {
                    event: 'repo_quarantine_file_dry_run',
                    tool: 'repo_quarantine_file',
                    path: resolved.relative,
                    quarantineId,
                    previousBytes: stats.size,
                },
            };
        }
        const { metadata, moved } = await quarantineResolvedFile(runtime, resolved);
        return {
            ok: true,
            value: {
                success: true,
                dryRun: false,
                ...metadata,
                io: {
                    operation: moved.io.operation,
                    targetKind: moved.io.targetKind,
                    bytesRead: moved.io.bytesRead,
                    durationMs: moved.io.durationMs,
                    engine: moved.io.engine,
                    traceId: moved.io.traceId ?? null,
                },
            },
            audit: {
                event: 'repo_quarantine_file_applied',
                tool: 'repo_quarantine_file',
                path: resolved.relative,
                quarantineId: metadata.quarantineId,
                quarantinePath: metadata.quarantinePath,
                sourceHash: moved.sourceHash,
                traceId: moved.io.traceId ?? null,
            },
        };
    } catch (error) {
        return failure(error instanceof Error ? error.message : String(error), {
            path: resolved.relative,
            code: errorCode(error),
        });
    }
}

/** @param {RepoWriteRuntime} runtime @param {{quarantineId:string;destinationPath?:string;overwrite?:boolean;dryRun?:boolean}} input @returns {Promise<RepoWriteOperationOutcome>} */
export async function executeRepositoryRestoreQuarantinedFile(runtime, input) {
    const metadata = await readQuarantineMetadata(runtime, input.quarantineId);
    if (!metadata)
        return failure('Quarantine metadata not found.', {
            code: 'ERR_QUARANTINE_NOT_FOUND',
            hint: 'Use the quarantineId returned by repo_quarantine_file.',
            quarantineId: input.quarantineId,
        });
    if (metadata.status !== 'quarantined')
        return failure('Quarantine item is not restorable.', {
            code: 'ERR_QUARANTINE_NOT_RESTORABLE',
            quarantineId: input.quarantineId,
            status: metadata.status,
            restoredPath: metadata.restoredPath,
        });
    const destination = await runtime.workspace.resolveWritePath(input.destinationPath || metadata.originalPath);
    if (!destination.ok) return failure(destination.reason, /** @type {Record<string, unknown>} */ (destination));
    try {
        if (input.dryRun === true) {
            const paths = resolveQuarantinePaths(runtime, metadata.quarantineId);
            const stats = await repoWriteStat(runtime, paths.dataPath);
            const destinationExists = await pathExists(runtime, destination.resolved);
            if (destinationExists && input.overwrite !== true)
                return failure(`Destino ja existe: ${destination.relative}`, { code: 'EEXIST' });
            return {
                ok: true,
                value: {
                    success: true,
                    dryRun: true,
                    quarantineId: metadata.quarantineId,
                    sourcePath: metadata.quarantinePath,
                    destination: destination.relative,
                    sourceBytes: stats.size,
                    destinationExists,
                    overwrite: input.overwrite === true,
                },
                audit: {
                    event: 'repo_restore_quarantined_file_dry_run',
                    tool: 'repo_restore_quarantined_file',
                    quarantineId: metadata.quarantineId,
                    destination: destination.relative,
                    overwrite: input.overwrite === true,
                },
            };
        }
        const restoredOutcome = await restoreQuarantinedFile(
            runtime,
            metadata.quarantineId,
            destination,
            input.overwrite === true,
        );
        const restored = restoredOutcome.restored;
        return {
            ok: true,
            value: {
                success: true,
                dryRun: false,
                quarantineId: metadata.quarantineId,
                sourcePath: metadata.quarantinePath,
                destination: destination.relative,
                sourceBytes: restored.sourceBytes,
                sourceHash: restored.sourceHash,
                destinationPreviousHash: restoredOutcome.destinationPreviousHash,
                destinationPreviousBytes: restoredOutcome.destinationPreviousBytes,
                overwrite: input.overwrite === true,
                restoredAt: restoredOutcome.metadata.restoredAt,
                cleanupPending: restoredOutcome.cleanupPending,
                io: {
                    operation: restored.io.operation,
                    targetKind: restored.io.targetKind,
                    bytesRead: restored.io.bytesRead,
                    durationMs: restored.io.durationMs,
                    engine: restored.io.engine,
                    traceId: restored.io.traceId ?? null,
                },
            },
            audit: {
                event: 'repo_restore_quarantined_file_applied',
                tool: 'repo_restore_quarantined_file',
                quarantineId: metadata.quarantineId,
                destination: destination.relative,
                overwrite: input.overwrite === true,
                sourceHash: restored.sourceHash,
                traceId: restored.io.traceId ?? null,
            },
        };
    } catch (error) {
        return failure(error instanceof Error ? error.message : String(error), {
            quarantineId: input.quarantineId,
            code: errorCode(error),
        });
    }
}

/** @param {RepoWriteRuntime} runtime @param {{path:string;dryRun?:boolean}} input @returns {Promise<RepoWriteOperationOutcome>} */
export async function executeRepositoryRemoveFile(runtime, input) {
    const resolved = await runtime.workspace.resolveWritePath(input.path);
    if (!resolved.ok) return failure(resolved.reason, /** @type {Record<string, unknown>} */ (resolved));
    try {
        const stats = await repoWriteStat(runtime, resolved.resolved);
        if (!stats.isFile())
            return failure('repo_remove_file remove somente arquivos regulares.', {
                path: resolved.relative,
                code: 'ERR_REMOVE_NOT_FILE',
            });
        if (input.dryRun === true)
            return {
                ok: true,
                value: { success: true, dryRun: true, path: resolved.relative, previousBytes: stats.size },
                audit: {
                    event: 'repo_remove_file_dry_run',
                    tool: 'repo_remove_file',
                    path: resolved.relative,
                    previousBytes: stats.size,
                },
            };
        const removed = await runtime.io.deleteFileLocked(
            resolved.resolved,
            runtime.signal ? { signal: runtime.signal } : {},
        );
        return {
            ok: true,
            value: {
                success: true,
                dryRun: false,
                path: resolved.relative,
                deleted: removed.deleted,
                previousHash: removed.previousHash,
                previousBytes: removed.previousBytes,
                rollbackCaptureEnabled: removed.rollbackCaptureEnabled,
                rollbackSnapshotAvailable:
                    typeof removed.previousSnapshotBase64 === 'string' || removed.previousRollbackSidecar != null,
                previousSnapshotTruncated: removed.previousSnapshotTruncated,
                rollbackSidecarExpiresAtMs: removed.previousRollbackSidecar?.expiresAtMs ?? null,
                io: {
                    operation: removed.io.operation,
                    targetKind: removed.io.targetKind,
                    bytesRead: removed.io.bytesRead,
                    durationMs: removed.io.durationMs,
                    engine: removed.io.engine,
                    traceId: removed.io.traceId ?? null,
                },
            },
            audit: {
                event: 'repo_remove_file_applied',
                tool: 'repo_remove_file',
                path: resolved.relative,
                previousHash: removed.previousHash,
                previousBytes: removed.previousBytes,
                rollbackCaptureEnabled: removed.rollbackCaptureEnabled,
                previousSnapshotTruncated: removed.previousSnapshotTruncated,
                rollbackSidecarAvailable: removed.previousRollbackSidecar != null,
                rollbackSidecarExpiresAtMs: removed.previousRollbackSidecar?.expiresAtMs ?? null,
                traceId: removed.io.traceId ?? null,
            },
        };
    } catch (error) {
        return failure(error instanceof Error ? error.message : String(error), {
            path: resolved.relative,
            code: errorCode(error),
        });
    }
}
