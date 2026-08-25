// @ts-check
/** Shared repository-write runtime capability and I/O primitives. */

import path from 'node:path';

/** @typedef {import('./contracts.js').RepoWriteRuntime} RepoWriteRuntime */
/** @typedef {import('./contracts.js').RepoWriteWorkspaceCapability} RepoWriteWorkspaceCapability */
/** @typedef {import('./contracts.js').RepoWriteIo} RepoWriteIo */
/** @typedef {import('./contracts.js').RepoWriteQuarantineMetadataWriter} RepoWriteQuarantineMetadataWriter */

/**
 * @param {RepoWriteWorkspaceCapability} workspace
 * @param {NonNullable<import('#copilot/mcp/public/protocol/tools').McpToolCapabilityProjection['audit']>} audit
 * @param {RepoWriteQuarantineMetadataWriter} quarantineMetadataWriter
 * @param {AbortSignal} [signal]
 * @param {{ quarantineDir?: string }} [options]
 * @returns {RepoWriteRuntime}
 */
export function createRepoWriteRuntime(workspace, audit, quarantineMetadataWriter, signal, options = {}) {
    const quarantineDir = resolveRepoWriteQuarantineDir(workspace.workspaceRoot, options.quarantineDir);
    return Object.freeze({
        workspace,
        io: workspace.io,
        workspaceRoot: workspace.workspaceRoot,
        quarantineDir,
        quarantineMetadataWriter,
        audit,
        ...(signal ? { signal } : {}),
    });
}

/** @param {string} workspaceRoot @param {string | undefined} configuredDir */
function resolveRepoWriteQuarantineDir(workspaceRoot, configuredDir) {
    if (!path.isAbsolute(workspaceRoot)) throw new TypeError('Repo write workspaceRoot must be absolute.');
    const canonicalRoot = path.join(path.normalize(workspaceRoot), 'src/copilot/.ai/quarantine');
    if (configuredDir === undefined) return canonicalRoot;
    if (!path.isAbsolute(configuredDir)) throw new TypeError('Repo write quarantineDir override must be absolute.');
    const candidate = path.normalize(configuredDir);
    const relative = path.relative(canonicalRoot, candidate);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new TypeError('Repo write quarantineDir override must remain inside the canonical quarantine root.');
    }
    return candidate;
}

/** @param {RepoWriteRuntime} runtime */
export function throwIfRepoWriteAborted(runtime) {
    runtime.signal?.throwIfAborted();
}

/**
 * Use the opaque validated mutable capability when the upstream path adapter supplied one; keep the canonical string
 * method as a compatibility fallback for internal mocks/legacy callers.
 *
 * @param {{ resolved: string; validatedWritePath?: import('#copilot/infra/public/composition/workspace/authority').ValidatedMutableWorkspacePath }} resolved
 * @param {Parameters<RepoWriteIo['patchTextLocked']>[1]} options
 */
export function patchResolvedTarget(/** @type {RepoWriteRuntime} */ runtime, resolved, options) {
    const executionOptions = { ...options, ...(runtime.signal ? { signal: runtime.signal } : {}) };
    return resolved.validatedWritePath
        ? runtime.io.patchTextLockedValidated(resolved.validatedWritePath, executionOptions)
        : runtime.io.patchTextLocked(resolved.resolved, executionOptions);
}

/**
 * @param {{ resolved: string; validatedWritePath?: import('#copilot/infra/public/composition/workspace/authority').ValidatedMutableWorkspacePath }} resolved
 * @param {Parameters<RepoWriteIo['createOrReplaceFileAtomic']>[1]} content
 * @param {Parameters<RepoWriteIo['createOrReplaceFileAtomic']>[2]} options
 */
export function createResolvedTarget(/** @type {RepoWriteRuntime} */ runtime, resolved, content, options) {
    const executionOptions = { ...(options ?? {}), ...(runtime.signal ? { signal: runtime.signal } : {}) };
    return resolved.validatedWritePath
        ? runtime.io.createOrReplaceFileAtomicValidated(resolved.validatedWritePath, content, executionOptions)
        : runtime.io.createOrReplaceFileAtomic(resolved.resolved, content, executionOptions);
}

/**
 * @param {{ resolved: string; validatedWritePath?: import('#copilot/infra/public/composition/workspace/authority').ValidatedMutableWorkspacePath }} resolved
 * @param {Parameters<RepoWriteIo['writeFileAtomic']>[1]} content
 * @param {Parameters<RepoWriteIo['writeFileAtomic']>[2]} options
 */
export function writeResolvedTarget(/** @type {RepoWriteRuntime} */ runtime, resolved, content, options) {
    const executionOptions = { ...(options ?? {}), ...(runtime.signal ? { signal: runtime.signal } : {}) };
    return resolved.validatedWritePath
        ? runtime.io.writeFileAtomicValidated(resolved.validatedWritePath, content, executionOptions)
        : runtime.io.writeFileAtomic(resolved.resolved, content, executionOptions);
}

/**
 * Move through the pair-capability path only when both sides were independently authorized by canonical write policy.
 * Legacy/mocked callers without capabilities keep the string facade and therefore retain full policy validation.
 *
 * @param {{ resolved: string; validatedWritePath?: import('#copilot/infra/public/composition/workspace/authority').ValidatedMutableWorkspacePath }} source
 * @param {{ resolved: string; validatedWritePath?: import('#copilot/infra/public/composition/workspace/authority').ValidatedMutableWorkspacePath }} destination
 * @param {Parameters<RepoWriteIo['moveFileLocked']>[2]} options
 */
export function moveResolvedTargets(/** @type {RepoWriteRuntime} */ runtime, source, destination, options) {
    const executionOptions = { ...(options ?? {}), ...(runtime.signal ? { signal: runtime.signal } : {}) };
    return source.validatedWritePath && destination.validatedWritePath
        ? runtime.io.moveFileLockedValidated(
              source.validatedWritePath,
              destination.validatedWritePath,
              executionOptions,
          )
        : runtime.io.moveFileLocked(source.resolved, destination.resolved, executionOptions);
}

/** @param {unknown} value @returns {{ durability: import('#copilot/infra/public/policy').IoDurabilityMode } | {}} */
export function durabilityOption(value) {
    return value === 'file-and-directory' || value === 'file' || value === 'none' ? { durability: value } : {};
}

/** @param {RepoWriteRuntime} runtime @param {string} filePath */
export async function repoWriteStat(runtime, filePath) {
    return (await runtime.io.statPath(filePath)).stats;
}

/** @param {RepoWriteRuntime} runtime @param {string} filePath */
export async function repoWriteLstat(runtime, filePath) {
    return (await runtime.io.lstatPath(filePath)).stats;
}

/** @param {RepoWriteRuntime} runtime @param {string} dirPath */
export async function repoWriteListDirectoryNames(runtime, dirPath) {
    return (await runtime.io.listDirectoryNamesFresh(dirPath)).entries;
}

/**
 * @param {string} filePath
 * @returns {Promise<boolean>}
 */
export async function pathExists(/** @type {RepoWriteRuntime} */ runtime, filePath) {
    try {
        await repoWriteStat(runtime, filePath);
        return true;
    } catch (error) {
        const code = /** @type {{ code?: unknown }} */ (error)?.code;
        if (code === 'ENOENT' || code === 'ENOTDIR') return false;
        throw error;
    }
}

/**
 * @param {string} filePath
 * @returns {Promise<boolean>}
 */
export async function regularFileExists(/** @type {RepoWriteRuntime} */ runtime, filePath) {
    try {
        const stats = await repoWriteLstat(runtime, filePath);
        return stats.isFile() && !stats.isSymbolicLink();
    } catch (error) {
        const code = /** @type {{ code?: unknown }} */ (error)?.code;
        if (code === 'ENOENT' || code === 'ENOTDIR') return false;
        throw error;
    }
}
