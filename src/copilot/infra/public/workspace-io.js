// @ts-check
/**
 * Workspace-bound IO capability.
 *
 * Normal string paths are evaluated by the async canonical policy immediately before the underlying IO operation.
 * Internal read-only callers may reuse an opaque capability emitted by that same policy result, avoiding a duplicate
 * realpath walk while preserving workspace/mode/policy-version checks. Mutable operations never accept the fast path.
 *
 * @module copilot/infra/public/workspace-io
 */

import { evaluateIoPathPolicyAsync } from '#copilot/core';
import path from 'node:path';
import { beginIoAdvisoryBudget } from '../io-advisory-budget.js';
import { resolveValidatedReadWorkspacePath } from '../io/policy/validated-path.js';
import {
    appendTextLocked,
    copyFileLocked,
    createOrReplaceFileAtomic,
    deleteFileLocked,
    mkdirPathLocked,
    moveFileLocked,
    patchTextBatchLocked,
    patchTextLocked,
    readBytes,
    readLines,
    readText,
    readTextChunks,
    removePathLocked,
    statPath,
    withIoResourceLock,
    writeFileAtomic,
} from '../io/fs/index.js';
import { diffText } from '../io/patch/index.js';
import { searchText, searchWorkspaceSymbols } from '../io/search/index.js';
import { warmReadThroughContext } from '../io-prefetch.js';
import { scanDirectory } from '../io-scanner.js';

/**
 * @typedef {'append' | 'copy' | 'delete' | 'mkdir' | 'move' | 'patch' | 'read' | 'scan' | 'search' | 'stat' | 'write'} WorkspaceIoMode
 * @typedef {{ workspaceRoot: string; blockedSegments?: readonly string[] }} WorkspaceIoContext
 */

const MUTABLE_MODES = new Set(['append', 'copy', 'delete', 'mkdir', 'move', 'patch', 'write']);

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
 * @param {string} filePath
 * @param {WorkspaceIoMode} mode
 * @param {WorkspaceIoContext} context
 * @returns {Promise<string>}
 */
async function resolveWorkspacePath(filePath, mode, context) {
    const result = await evaluateIoPathPolicyAsync(filePath, {
        workspaceRoot: context.workspaceRoot,
        ...(context.blockedSegments ? { blockedSegments: context.blockedSegments } : {}),
        mode,
    });
    if (result.ok) return result.realPath;

    const error = /** @type {Error & { code?: string; policyVersion?: string }} */ (
        new Error(`Workspace IO denied: ${result.reason}`)
    );
    error.code = result.code;
    error.policyVersion = result.policyVersion;
    throw error;
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
 * @param {'read' | 'search' | 'stat'} mode
 * @param {WorkspaceIoContext} context
 * @returns {(capability: unknown, ...args: Args) => Promise<Result>}
 */
function bindValidatedReadOperation(operation, mode, context) {
    return async (capability, ...args) => {
        const resolvedPath = resolveValidatedReadWorkspacePath(capability, {
            workspaceRoot: context.workspaceRoot,
            mode,
        });
        if (!resolvedPath) {
            const error = /** @type {Error & { code?: string }} */ (
                new Error('Validated workspace read method requires an opaque validated-path capability.')
            );
            error.code = 'EVALIDATEDPATHREQUIRED';
            throw error;
        }
        return operation(resolvedPath, ...args);
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
    if (typeof context?.workspaceRoot !== 'string' || context.workspaceRoot.trim().length === 0) {
        throw new TypeError('createWorkspaceIo requires a non-empty workspaceRoot');
    }

    /** @type {typeof scanDirectory} */
    const scanWorkspaceDirectory = async (rootPath, options = {}) =>
        scanDirectory(await resolveWorkspacePath(rootPath, 'scan', context), {
            ...options,
            workspaceRoot: context.workspaceRoot,
        });
    /** @type {typeof searchText} */
    const searchWorkspaceText = async (targetPath, options) =>
        searchText(await resolveWorkspacePath(targetPath, 'search', context), {
            ...options,
            workspaceRoot: context.workspaceRoot,
        });
    /** @type {typeof searchWorkspaceSymbols} */
    const searchBoundWorkspaceSymbols = async (targetPath, options) =>
        searchWorkspaceSymbols(await resolveWorkspacePath(targetPath, 'search', context), {
            ...options,
            workspaceRoot: context.workspaceRoot,
        });

    const readBytesValidated = bindValidatedReadOperation(readBytes, 'read', context);
    const readTextValidated = bindValidatedReadOperation(readText, 'read', context);
    const readTextChunksValidated = bindValidatedReadOperation(readTextChunks, 'read', context);
    const statPathValidated = bindValidatedReadOperation(statPath, 'stat', context);
    const searchTextValidated = bindValidatedReadOperation(
        async (targetPath, options) =>
            searchText(targetPath, {
                .../** @type {Parameters<typeof searchText>[1]} */ (options),
                workspaceRoot: context.workspaceRoot,
            }),
        'search',
        context,
    );
    const searchWorkspaceSymbolsValidated = bindValidatedReadOperation(
        async (targetPath, options) =>
            searchWorkspaceSymbols(targetPath, {
                .../** @type {Parameters<typeof searchWorkspaceSymbols>[1]} */ (options),
                workspaceRoot: context.workspaceRoot,
            }),
        'search',
        context,
    );

    return Object.freeze({
        appendTextLocked: bindWorkspacePathOperation(appendTextLocked, 'append', context),
        copyFileLocked: bindWorkspacePathPairOperation(copyFileLocked, 'read', 'write', context),
        createOrReplaceFileAtomic: bindWorkspacePathOperation(createOrReplaceFileAtomic, 'write', context),
        deleteFileLocked: bindWorkspacePathOperation(deleteFileLocked, 'delete', context),
        diffText: bindWorkspacePathPairOperation(diffText, 'read', 'read', context),
        mkdirPathLocked: bindWorkspacePathOperation(mkdirPathLocked, 'mkdir', context),
        moveFileLocked: bindWorkspacePathPairOperation(moveFileLocked, 'move', 'write', context),
        patchTextBatchLocked: bindWorkspacePathOperation(patchTextBatchLocked, 'patch', context),
        patchTextLocked: bindWorkspacePathOperation(patchTextLocked, 'patch', context),
        readBytes: bindWorkspacePathOperation(readBytes, 'read', context),
        readBytesValidated,
        readLines: bindWorkspacePathOperation(readLines, 'read', context),
        readText: bindWorkspacePathOperation(readText, 'read', context),
        readTextValidated,
        readTextChunks: bindWorkspacePathOperation(readTextChunks, 'read', context),
        readTextChunksValidated,
        removePathLocked: bindWorkspaceRemovePathOperation(removePathLocked, context),
        scanDirectory: scanWorkspaceDirectory,
        searchText: searchWorkspaceText,
        searchTextValidated,
        searchWorkspaceSymbols: searchBoundWorkspaceSymbols,
        searchWorkspaceSymbolsValidated,
        statPath: bindWorkspacePathOperation(statPath, 'stat', context),
        statPathValidated,
        withIoResourceLock: bindWorkspacePathOperation(withIoResourceLock, 'write', context),
        warmReadThroughContext: bindWorkspacePathOperation(warmReadThroughContext, 'read', context),
        writeFileAtomic: bindWorkspacePathOperation(writeFileAtomic, 'write', context),
    });
}
