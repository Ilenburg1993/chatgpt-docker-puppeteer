// @ts-check
/** Ordered repository file-batch planning and application orchestration. */

import { quarantineResolvedFile } from '../quarantine/runtime.js';
import {
    createResolvedTarget,
    durabilityOption,
    moveResolvedTargets,
    pathExists,
    repoWriteStat,
    throwIfRepoWriteAborted,
} from '../runtime.js';

/** @typedef {import('../contracts.js').RepoWriteRuntime} RepoWriteRuntime */

/**
 * File batches preserve order because later operations may depend on earlier ones. The adaptive default skips the
 * duplicate whole-batch preview for operations whose failure cannot overwrite/delete existing data. Irreversible delete
 * and overwrite stay behind the conservative preview gate unless the caller explicitly selects sequential-fast.
 *
 * @param {Record<string, unknown>[]} operations
 * @param {'global-preflight' | 'sequential-fast' | undefined} requested
 */
export function resolveFileBatchApplyMode(operations, requested) {
    if (requested) return { mode: requested, reason: 'explicit', conservativeOperationIndices: [] };
    const conservativeOperationIndices = [];
    for (const [index, operation] of operations.entries()) {
        const type = String(operation['type'] ?? '');
        if (type === 'remove_file' || (type === 'move_file' && operation['overwrite'] === true)) {
            conservativeOperationIndices.push(index);
        }
    }
    return conservativeOperationIndices.length > 0
        ? {
              mode: /** @type {const} */ ('global-preflight'),
              reason: 'adaptive-destructive-gate',
              conservativeOperationIndices,
          }
        : {
              mode: /** @type {const} */ ('sequential-fast'),
              reason: 'adaptive-safe-sequential',
              conservativeOperationIndices,
          };
}

/**
 * @param {unknown} operation
 * @param {number} index
 * @param {{ virtualFiles: Map<string, { relative: string; bytes: number }> }} [context]
 * @returns {Promise<Record<string, unknown>>}
 */
async function previewBatchFileOperation(
    /** @type {RepoWriteRuntime} */ runtime,
    operation,
    index,
    context = { virtualFiles: new Map() },
) {
    const item = /** @type {Record<string, unknown>} */ (operation);
    const type = String(item['type'] ?? '');
    if (type === 'create_file') {
        const resolved = await runtime.workspace.resolveWritePath(String(item['path'] ?? ''));
        if (!resolved.ok) throw new Error(`operation ${index}: ${resolved.reason}`);
        const exists = await pathExists(runtime, resolved.resolved);
        const bytes = Buffer.byteLength(String(item['content'] ?? ''), 'utf8');
        if (!exists) context.virtualFiles.set(resolved.resolved, { relative: resolved.relative, bytes });
        return {
            index,
            type,
            path: resolved.relative,
            wouldCreate: !exists,
            destinationExists: exists,
            bytes,
        };
    }
    if (type === 'move_file') {
        // A move mutates the source as well as the destination. Preflight must therefore use write policy on both sides,
        // matching the actual move facade instead of producing a read-only false green for the source.
        const source = await runtime.workspace.resolveWritePath(String(item['source'] ?? ''));
        if (!source.ok) throw new Error(`operation ${index}: ${source.reason}`);
        const destination = await runtime.workspace.resolveWritePath(String(item['destination'] ?? ''));
        if (!destination.ok) throw new Error(`operation ${index}: ${destination.reason}`);
        const virtualSource = context.virtualFiles.get(source.resolved);
        const stats = virtualSource ? null : await repoWriteStat(runtime, source.resolved);
        const destinationExists = await pathExists(runtime, destination.resolved);
        const virtualDestinationExists = context.virtualFiles.has(destination.resolved);
        if ((destinationExists || virtualDestinationExists) && item['overwrite'] !== true) {
            throw new Error(`operation ${index}: destination already exists: ${destination.relative}`);
        }
        if (item['overwrite'] === true && item['confirmOverwrite'] !== true) {
            throw new Error(`operation ${index}: confirmOverwrite must be true when overwrite=true`);
        }
        if (virtualSource) {
            context.virtualFiles.delete(source.resolved);
            context.virtualFiles.set(destination.resolved, {
                relative: destination.relative,
                bytes: virtualSource.bytes,
            });
        }
        return {
            index,
            type,
            source: source.relative,
            destination: destination.relative,
            sourceBytes: virtualSource?.bytes ?? stats?.size ?? 0,
            destinationExists: destinationExists || virtualDestinationExists,
            overwrite: item['overwrite'] === true,
            virtualSource: Boolean(virtualSource),
        };
    }
    if (type === 'set_executable') {
        const resolved = await runtime.workspace.resolveWritePath(String(item['path'] ?? ''));
        if (!resolved.ok) throw new Error(`operation ${index}: ${resolved.reason}`);
        const stats = await repoWriteStat(runtime, resolved.resolved);
        if (!stats.isFile()) throw new Error(`operation ${index}: only regular files are supported`);
        const currentMode = stats.mode & 0o777;
        const targetMode = item['executable'] === true ? currentMode | 0o111 : currentMode & ~0o111;
        return {
            index,
            type,
            path: resolved.relative,
            executable: item['executable'] === true,
            currentMode: `0${currentMode.toString(8).padStart(3, '0')}`,
            targetMode: `0${targetMode.toString(8).padStart(3, '0')}`,
            wouldChange: targetMode !== currentMode,
            metadataOnly: true,
        };
    }
    if (type === 'quarantine_file' || type === 'remove_file') {
        const resolved = await runtime.workspace.resolveWritePath(String(item['path'] ?? ''));
        if (!resolved.ok) throw new Error(`operation ${index}: ${resolved.reason}`);
        const stats = await repoWriteStat(runtime, resolved.resolved);
        if (!stats.isFile()) throw new Error(`operation ${index}: only regular files are supported`);
        return {
            index,
            type,
            path: resolved.relative,
            bytes: stats.size,
            destructive: type === 'remove_file',
            reversible: type === 'quarantine_file',
        };
    }
    throw new Error(`operation ${index}: unsupported batch operation type`);
}

/**
 * Run the global file-batch preview without discarding already-computed evidence when a later operation fails.
 *
 * @param {unknown[]} operations
 * @returns {Promise<{
 *     success: boolean;
 *     previews: Record<string, unknown>[];
 *     failureIndex: number;
 *     error: string | null;
 *     durationMs: number;
 * }>}
 */
export async function runFileBatchPreflight(/** @type {RepoWriteRuntime} */ runtime, operations) {
    const startedAt = performance.now();
    /** @type {Record<string, unknown>[]} */
    const previews = [];
    const previewContext = { virtualFiles: new Map() };
    for (const [index, operation] of operations.entries()) {
        try {
            throwIfRepoWriteAborted(runtime);
            previews.push(await previewBatchFileOperation(runtime, operation, index, previewContext));
        } catch (error) {
            return {
                success: false,
                previews,
                failureIndex: index,
                error: error instanceof Error ? error.message : String(error),
                durationMs: Math.round((performance.now() - startedAt) * 1000) / 1000,
            };
        }
    }
    return {
        success: true,
        previews,
        failureIndex: -1,
        error: null,
        durationMs: Math.round((performance.now() - startedAt) * 1000) / 1000,
    };
}

/**
 * @param {unknown} operation
 * @param {number} index
 * @returns {Promise<Record<string, unknown>>}
 */
export async function applyBatchFileOperation(/** @type {RepoWriteRuntime} */ runtime, operation, index) {
    throwIfRepoWriteAborted(runtime);
    const item = /** @type {Record<string, unknown>} */ (operation);
    const type = String(item['type'] ?? '');
    if (type === 'create_file') {
        const resolved = await runtime.workspace.resolveWritePath(String(item['path'] ?? ''), {
            issueMutableCapability: true,
        });
        if (!resolved.ok) throw new Error(`operation ${index}: ${resolved.reason}`);
        const content = String(item['content'] ?? '');
        const write = await createResolvedTarget(runtime, resolved, content, {
            encoding: 'utf8',
            createParentDirs: item['createParentDirs'] !== false,
            failIfExists: true,
            ...durabilityOption(item['durability']),
            riskClass: 'medium',
            advisoryLimits: { tool: 'repo_apply_file_batch', operation: type, contentChars: content.length },
        });
        return {
            index,
            type,
            path: resolved.relative,
            bytesWritten: write.bytesWritten,
            contentHash: write.contentHash,
            traceId: write.io.traceId ?? null,
        };
    }
    if (type === 'move_file') {
        const source = await runtime.workspace.resolveWritePath(String(item['source'] ?? ''), {
            issueMutableCapability: true,
        });
        if (!source.ok) throw new Error(`operation ${index}: ${source.reason}`);
        const destination = await runtime.workspace.resolveWritePath(String(item['destination'] ?? ''), {
            issueMutableCapability: true,
        });
        if (!destination.ok) throw new Error(`operation ${index}: ${destination.reason}`);
        if (item['overwrite'] === true && item['confirmOverwrite'] !== true) {
            throw new Error(`operation ${index}: confirmOverwrite must be true when overwrite=true`);
        }
        const moved = await moveResolvedTargets(runtime, source, destination, {
            overwrite: item['overwrite'] === true,
        });
        return {
            index,
            type,
            source: source.relative,
            destination: destination.relative,
            sourceBytes: moved.sourceBytes,
            sourceHash: moved.sourceHash,
            destinationPreviousHash: moved.destinationPreviousHash,
            traceId: moved.io.traceId ?? null,
        };
    }
    if (type === 'set_executable') {
        const resolved = await runtime.workspace.resolveWritePath(String(item['path'] ?? ''), {
            issueMutableCapability: true,
        });
        if (!resolved.ok) throw new Error(`operation ${index}: ${resolved.reason}`);
        const stats = await repoWriteStat(runtime, resolved.resolved);
        if (!stats.isFile()) throw new Error(`operation ${index}: only regular files are supported`);
        const currentMode = stats.mode & 0o777;
        const targetMode = item['executable'] === true ? currentMode | 0o111 : currentMode & ~0o111;
        const changed = resolved.validatedWritePath
            ? await runtime.io.chmodFileLockedValidated(resolved.validatedWritePath, targetMode, {
                  riskClass: 'medium',
                  ...(runtime.signal ? { signal: runtime.signal } : {}),
                  advisoryLimits: { tool: 'repo_apply_file_batch', operation: type },
              })
            : await runtime.io.chmodFileLocked(resolved.resolved, targetMode, {
                  riskClass: 'medium',
                  ...(runtime.signal ? { signal: runtime.signal } : {}),
                  advisoryLimits: { tool: 'repo_apply_file_batch', operation: type },
              });
        return {
            index,
            type,
            path: resolved.relative,
            executable: item['executable'] === true,
            previousMode: `0${changed.previousMode.toString(8).padStart(3, '0')}`,
            mode: `0${changed.mode.toString(8).padStart(3, '0')}`,
            changed: changed.changed,
            metadataOnly: true,
            lockWaitMs: changed.lockWaitMs,
            traceId: changed.io.traceId ?? null,
        };
    }
    if (type === 'quarantine_file') {
        const resolved = await runtime.workspace.resolveWritePath(String(item['path'] ?? ''));
        if (!resolved.ok) throw new Error(`operation ${index}: ${resolved.reason}`);
        const stats = await repoWriteStat(runtime, resolved.resolved);
        if (!stats.isFile()) throw new Error(`operation ${index}: only regular files are supported`);
        const { metadata, moved } = await quarantineResolvedFile(runtime, resolved);
        return { index, type, path: resolved.relative, ...metadata, traceId: moved.io.traceId ?? null };
    }
    if (type === 'remove_file') {
        if (item['confirm'] !== true) throw new Error(`operation ${index}: confirm must be true for remove_file`);
        const resolved = await runtime.workspace.resolveWritePath(String(item['path'] ?? ''));
        if (!resolved.ok) throw new Error(`operation ${index}: ${resolved.reason}`);
        const stats = await repoWriteStat(runtime, resolved.resolved);
        if (!stats.isFile()) throw new Error(`operation ${index}: only regular files are supported`);
        const removed = await runtime.io.deleteFileLocked(
            resolved.resolved,
            runtime.signal ? { signal: runtime.signal } : {},
        );
        return {
            index,
            type,
            path: resolved.relative,
            deleted: removed.deleted,
            previousHash: removed.previousHash,
            previousBytes: removed.previousBytes,
            rollbackCaptureEnabled: removed.rollbackCaptureEnabled,
            rollbackSnapshotAvailable:
                typeof removed.previousSnapshotBase64 === 'string' || removed.previousRollbackSidecar != null,
            previousSnapshotTruncated: removed.previousSnapshotTruncated,
            rollbackSidecarExpiresAtMs: removed.previousRollbackSidecar?.expiresAtMs ?? null,
            traceId: removed.io.traceId ?? null,
        };
    }
    throw new Error(`operation ${index}: unsupported batch operation type`);
}
