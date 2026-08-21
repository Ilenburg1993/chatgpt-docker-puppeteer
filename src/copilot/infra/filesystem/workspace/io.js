// @ts-check
/**
 * Workspace-bound IO capability.
 *
 * Normal string paths are evaluated by the async canonical policy immediately before the underlying IO operation.
 * Internal callers may reuse opaque capabilities emitted by that same policy result, avoiding a duplicate realpath walk
 * while preserving workspace/mode/policy-version checks. Mutable fast paths are separate methods and intentionally
 * limited to single-target write/patch operations; string APIs always keep full canonical validation.
 *
 * @module copilot/infra/filesystem/workspace/io
 */

import { withIoResourceLock } from '#copilot/infra/internal/concurrency/locks';
import {
    copyFileLocked,
    deleteFileLocked,
    moveFileLocked,
    patchTextBatchLocked,
    patchTextLocked,
    removePathLocked,
} from '#copilot/infra/internal/filesystem/mutation';
import { diffText } from '#copilot/infra/internal/filesystem/patch';
import {
    listDirectoryNamesFresh,
    lstatPath,
    readBytes,
    readBytesFresh,
    readBytesRangeFresh,
    readLines,
    readText,
    readTextChunks,
    readTextFresh,
    statPath,
} from '#copilot/infra/internal/filesystem/read';
import {
    appendTextLocked,
    chmodFileLocked,
    createOrReplaceFileAtomic,
    mkdirPathLocked,
    writeFileAtomic,
} from '#copilot/infra/internal/filesystem/write';
import { beginIoAdvisoryBudget } from '#copilot/infra/internal/telemetry';
import path from 'node:path';
import { assertWorkspaceIoContext, requireValidatedWorkspaceReadPath, resolveWorkspacePath } from './path-boundary.js';
import { resolveValidatedMutableWorkspacePath } from './validated-path.js';

/** @typedef {import('./path-boundary.js').WorkspaceIoMode} WorkspaceIoMode */
/** @typedef {import('./path-boundary.js').WorkspaceIoContext} WorkspaceIoContext */
/** @typedef {import('./validated-path.js').ValidatedReadWorkspacePath} ValidatedReadWorkspacePath */
/** @typedef {import('./validated-path.js').ValidatedMutableWorkspacePath} ValidatedMutableWorkspacePath */

const MUTABLE_MODES = new Set(['append', 'copy', 'delete', 'metadata', 'mkdir', 'move', 'patch', 'write']);

/**
 * @param {unknown[]} args
 * @returns {number}
 */
function estimateMutationBytes(args) {
    const value = args[0];
    if (typeof value === 'string') return Buffer.byteLength(value);
    if (ArrayBuffer.isView(value)) return value.byteLength;
    if (value instanceof ArrayBuffer) return value.byteLength;
    if (value && typeof value === 'object' && 'newString' in value) {
        const replacement = /** @type {{ newString?: unknown }} */ (value).newString;
        if (typeof replacement === 'string') return Buffer.byteLength(replacement);
    }
    return 0;
}

/**
 * @template {unknown[]} Args
 * @template Result
 * @param {(filePath: string, ...args: Args) => Promise<Result>} operation
 * @param {WorkspaceIoMode} mode
 * @param {WorkspaceIoContext} context
 * @returns {(filePath: string, ...args: Args) => Promise<Result>}
 */
function bindWorkspacePathOperation(operation, mode, context) {
    return async (filePath, ...args) => {
        const resolvedPath = await resolveWorkspacePath(filePath, mode, context);
        if (!MUTABLE_MODES.has(mode)) return operation(resolvedPath, ...args);
        const budget = beginIoAdvisoryBudget({
            operation: `workspace.${mode}`,
            estimatedBytes: estimateMutationBytes(args),
        });
        try {
            return await operation(resolvedPath, ...args);
        } finally {
            budget.finish();
        }
    };
}

/**
 * Bind an operation to an already-validated read-only path capability. This is intentionally a separate method family:
 * normal string methods always run the canonical async policy, while only internal callers holding the opaque brand can
 * take the fast path.
 *
 * @template {unknown[]} Args
 * @template Result
 * @param {(filePath: string, ...args: Args) => Promise<Result>} operation
 * @param {'read' | 'search' | 'stat' | 'scan'} mode
 * @param {WorkspaceIoContext} context
 * @returns {(capability: ValidatedReadWorkspacePath, ...args: Args) => Promise<Result>}
 */
function bindValidatedReadOperation(operation, mode, context) {
    return async (capability, ...args) =>
        operation(requireValidatedWorkspaceReadPath(capability, mode, context), ...args);
}

/**
 * Bind a single-target mutable operation to an opaque capability produced by canonical async write validation.
 * This never accepts strings and therefore cannot become an accidental `trustPath` escape hatch.
 *
 * @template {unknown[]} Args
 * @template Result
 * @param {(filePath: string, ...args: Args) => Promise<Result>} operation
 * @param {'write' | 'patch' | 'metadata'} mode
 * @param {WorkspaceIoContext} context
 * @returns {(capability: ValidatedMutableWorkspacePath, ...args: Args) => Promise<Result>}
 */
function bindValidatedMutableOperation(operation, mode, context) {
    return async (capability, ...args) => {
        const resolvedPath = resolveValidatedMutableWorkspacePath(capability, {
            workspaceRoot: context.workspaceRoot,
            mode,
        });
        if (!resolvedPath) {
            const error = /** @type {Error & { code?: string }} */ (
                new Error('Validated workspace mutable method requires an opaque mutable validated-path capability.')
            );
            error.code = 'EVALIDATEDMUTABLEPATHREQUIRED';
            throw error;
        }
        const budget = beginIoAdvisoryBudget({
            operation: `workspace.${mode}.validated`,
            estimatedBytes: estimateMutationBytes(args),
        });
        try {
            return await operation(resolvedPath, ...args);
        } finally {
            budget.finish();
        }
    };
}

/**
 * Compose two independently authorized read-only capabilities without introducing a pair brand.
 * Each side keeps its own workspace/policy-version checks before the canonical two-path operation runs.
 *
 * @template {unknown[]} Args
 * @template Result
 * @param {(pathA: string, pathB: string, ...args: Args) => Promise<Result>} operation
 * @param {WorkspaceIoContext} context
 * @returns {(pathACapability: ValidatedReadWorkspacePath, pathBCapability: ValidatedReadWorkspacePath, ...args: Args) => Promise<Result>}
 */
function bindValidatedReadPairOperation(operation, context) {
    return async (pathACapability, pathBCapability, ...args) => {
        const pathA = requireValidatedWorkspaceReadPath(pathACapability, 'read', context);
        const pathB = requireValidatedWorkspaceReadPath(pathBCapability, 'read', context);
        return operation(pathA, pathB, ...args);
    };
}

/**
 * Compose an already-validated read source with an already-validated write destination. Used only for copy semantics;
 * no new capability class is introduced and each side retains the policy that originally authorized it.
 *
 * @template {unknown[]} Args
 * @template Result
 * @param {(source: string, destination: string, ...args: Args) => Promise<Result>} operation
 * @param {WorkspaceIoContext} context
 * @returns {(sourceCapability: ValidatedReadWorkspacePath, destinationCapability: ValidatedMutableWorkspacePath, ...args: Args) => Promise<Result>}
 */
function bindValidatedReadMutablePairOperation(operation, context) {
    return async (sourceCapability, destinationCapability, ...args) => {
        const source = requireValidatedWorkspaceReadPath(sourceCapability, 'read', context);
        const destination = resolveValidatedMutableWorkspacePath(destinationCapability, {
            workspaceRoot: context.workspaceRoot,
            mode: 'write',
        });
        if (!destination) {
            const error = /** @type {Error & { code?: string }} */ (
                new Error('Validated workspace copy requires opaque read-source and mutable-destination capabilities.')
            );
            error.code = 'EVALIDATEDPAIRREQUIRED';
            throw error;
        }
        const budget = beginIoAdvisoryBudget({
            operation: 'workspace.read-write.validated',
            estimatedBytes: estimateMutationBytes(args),
        });
        try {
            return await operation(source, destination, ...args);
        } finally {
            budget.finish();
        }
    };
}

/**
 * Compose two independently write-validated capabilities for move semantics. Source and destination both use the write
 * policy class, matching the existing string facade where move-source resolves through mode `move` -> write policy.
 *
 * @template {unknown[]} Args
 * @template Result
 * @param {(source: string, destination: string, ...args: Args) => Promise<Result>} operation
 * @param {WorkspaceIoContext} context
 * @returns {(sourceCapability: ValidatedMutableWorkspacePath, destinationCapability: ValidatedMutableWorkspacePath, ...args: Args) => Promise<Result>}
 */
function bindValidatedMutablePairOperation(operation, context) {
    return async (sourceCapability, destinationCapability, ...args) => {
        const source = resolveValidatedMutableWorkspacePath(sourceCapability, {
            workspaceRoot: context.workspaceRoot,
            mode: 'write',
        });
        const destination = resolveValidatedMutableWorkspacePath(destinationCapability, {
            workspaceRoot: context.workspaceRoot,
            mode: 'write',
        });
        if (!source || !destination) {
            const error = /** @type {Error & { code?: string }} */ (
                new Error('Validated workspace move requires opaque mutable source and destination capabilities.')
            );
            error.code = 'EVALIDATEDPAIRREQUIRED';
            throw error;
        }
        const budget = beginIoAdvisoryBudget({
            operation: 'workspace.write-write.validated',
            estimatedBytes: estimateMutationBytes(args),
        });
        try {
            return await operation(source, destination, ...args);
        } finally {
            budget.finish();
        }
    };
}

/**
 * @param {typeof removePathLocked} operation
 * @param {WorkspaceIoContext} context
 * @returns {typeof removePathLocked}
 */
function bindWorkspaceRemovePathOperation(operation, context) {
    return async (filePath, options = {}) => {
        const resolvedPath = await resolveWorkspacePath(filePath, 'delete', context);
        if (options.recursive && path.resolve(resolvedPath) === path.resolve(context.workspaceRoot)) {
            const error = /** @type {Error & { code?: string }} */ (
                new Error('Workspace IO refuses recursive removal of the workspace root.')
            );
            error.code = 'ERECURSIVEWORKSPACEROOT';
            throw error;
        }
        const budget = beginIoAdvisoryBudget({ operation: 'workspace.delete' });
        try {
            return await operation(resolvedPath, {
                ...options,
                ...(options.recursive && options.recursiveConfirmation === filePath
                    ? { recursiveConfirmation: resolvedPath }
                    : {}),
            });
        } finally {
            budget.finish();
        }
    };
}

/**
 * @template {unknown[]} Args
 * @template Result
 * @param {(source: string, destination: string, ...args: Args) => Promise<Result>} operation
 * @param {WorkspaceIoMode} sourceMode
 * @param {WorkspaceIoMode} destinationMode
 * @param {WorkspaceIoContext} context
 * @returns {(source: string, destination: string, ...args: Args) => Promise<Result>}
 */
function bindWorkspacePathPairOperation(operation, sourceMode, destinationMode, context) {
    return async (source, destination, ...args) => {
        const [resolvedSource, resolvedDestination] = await Promise.all([
            resolveWorkspacePath(source, sourceMode, context),
            resolveWorkspacePath(destination, destinationMode, context),
        ]);
        const mutable = MUTABLE_MODES.has(sourceMode) || MUTABLE_MODES.has(destinationMode);
        if (!mutable) return operation(resolvedSource, resolvedDestination, ...args);
        const budget = beginIoAdvisoryBudget({
            operation: `workspace.${sourceMode}-${destinationMode}`,
            estimatedBytes: estimateMutationBytes(args),
        });
        try {
            return await operation(resolvedSource, resolvedDestination, ...args);
        } finally {
            budget.finish();
        }
    };
}

/**
 * @param {WorkspaceIoContext} context
 */
export function createWorkspaceIo(context) {
    assertWorkspaceIoContext(context);

    const readBytesValidated = bindValidatedReadOperation(readBytes, 'read', context);
    const readBytesRangeFreshValidated = bindValidatedReadOperation(readBytesRangeFresh, 'read', context);
    const readTextValidated = bindValidatedReadOperation(readText, 'read', context);
    const readTextChunksValidated = bindValidatedReadOperation(readTextChunks, 'read', context);
    const lstatPathValidated = bindValidatedReadOperation(lstatPath, 'stat', context);
    const statPathValidated = bindValidatedReadOperation(statPath, 'stat', context);
    const diffTextValidated = bindValidatedReadPairOperation(diffText, context);
    const copyFileLockedValidated = bindValidatedReadMutablePairOperation(copyFileLocked, context);
    const chmodFileLockedValidated = bindValidatedMutableOperation(chmodFileLocked, 'metadata', context);
    const createOrReplaceFileAtomicValidated = bindValidatedMutableOperation(
        createOrReplaceFileAtomic,
        'write',
        context,
    );
    const moveFileLockedValidated = bindValidatedMutablePairOperation(moveFileLocked, context);
    const patchTextBatchLockedValidated = bindValidatedMutableOperation(patchTextBatchLocked, 'patch', context);
    const patchTextLockedValidated = bindValidatedMutableOperation(patchTextLocked, 'patch', context);
    const writeFileAtomicValidated = bindValidatedMutableOperation(writeFileAtomic, 'write', context);

    return Object.freeze({
        appendTextLocked: bindWorkspacePathOperation(appendTextLocked, 'append', context),
        chmodFileLocked: bindWorkspacePathOperation(chmodFileLocked, 'metadata', context),
        chmodFileLockedValidated,
        copyFileLocked: bindWorkspacePathPairOperation(copyFileLocked, 'read', 'write', context),
        copyFileLockedValidated,
        createOrReplaceFileAtomic: bindWorkspacePathOperation(createOrReplaceFileAtomic, 'write', context),
        createOrReplaceFileAtomicValidated,
        deleteFileLocked: bindWorkspacePathOperation(deleteFileLocked, 'delete', context),
        diffText: bindWorkspacePathPairOperation(diffText, 'read', 'read', context),
        diffTextValidated,
        mkdirPathLocked: bindWorkspacePathOperation(mkdirPathLocked, 'mkdir', context),
        moveFileLocked: bindWorkspacePathPairOperation(moveFileLocked, 'move', 'write', context),
        moveFileLockedValidated,
        patchTextBatchLocked: bindWorkspacePathOperation(patchTextBatchLocked, 'patch', context),
        patchTextBatchLockedValidated,
        patchTextLocked: bindWorkspacePathOperation(patchTextLocked, 'patch', context),
        patchTextLockedValidated,
        readBytes: bindWorkspacePathOperation(readBytes, 'read', context),
        readBytesFresh: bindWorkspacePathOperation(readBytesFresh, 'read', context),
        readBytesRangeFresh: bindWorkspacePathOperation(readBytesRangeFresh, 'read', context),
        readBytesRangeFreshValidated,
        readBytesValidated,
        readLines: bindWorkspacePathOperation(readLines, 'read', context),
        readText: bindWorkspacePathOperation(readText, 'read', context),
        readTextFresh: bindWorkspacePathOperation(readTextFresh, 'read', context),
        readTextValidated,
        readTextChunks: bindWorkspacePathOperation(readTextChunks, 'read', context),
        readTextChunksValidated,
        removePathLocked: bindWorkspaceRemovePathOperation(removePathLocked, context),
        listDirectoryNamesFresh: bindWorkspacePathOperation(listDirectoryNamesFresh, 'scan', context),
        lstatPath: bindWorkspacePathOperation(lstatPath, 'stat', context),
        lstatPathValidated,
        statPath: bindWorkspacePathOperation(statPath, 'stat', context),
        statPathValidated,
        withIoResourceLock: bindWorkspacePathOperation(withIoResourceLock, 'write', context),
        writeFileAtomic: bindWorkspacePathOperation(writeFileAtomic, 'write', context),
        writeFileAtomicValidated,
    });
}
