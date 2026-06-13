// @ts-check
/**
 * Workspace-bound IO capability.
 *
 * Every path is evaluated by the async canonical policy immediately before the underlying IO operation. Consumers
 * bind an explicit workspace root once and receive the same operational contracts exposed by the low-level facade.
 *
 * @module copilot/infra/public/workspace-io
 */

import { evaluateIoPathPolicyAsync } from '#copilot/core';
import {
    appendTextLocked,
    copyFileLocked,
    createOrReplaceFileAtomic,
    deleteFileLocked,
    mkdirPathLocked,
    moveFileLocked,
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
    return async (filePath, ...args) => operation(await resolveWorkspacePath(filePath, mode, context), ...args);
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
        return operation(resolvedSource, resolvedDestination, ...args);
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

    return Object.freeze({
        appendTextLocked: bindWorkspacePathOperation(appendTextLocked, 'append', context),
        copyFileLocked: bindWorkspacePathPairOperation(copyFileLocked, 'read', 'write', context),
        createOrReplaceFileAtomic: bindWorkspacePathOperation(createOrReplaceFileAtomic, 'write', context),
        deleteFileLocked: bindWorkspacePathOperation(deleteFileLocked, 'delete', context),
        diffText: bindWorkspacePathPairOperation(diffText, 'read', 'read', context),
        mkdirPathLocked: bindWorkspacePathOperation(mkdirPathLocked, 'mkdir', context),
        moveFileLocked: bindWorkspacePathPairOperation(moveFileLocked, 'move', 'write', context),
        patchTextLocked: bindWorkspacePathOperation(patchTextLocked, 'patch', context),
        readBytes: bindWorkspacePathOperation(readBytes, 'read', context),
        readLines: bindWorkspacePathOperation(readLines, 'read', context),
        readText: bindWorkspacePathOperation(readText, 'read', context),
        readTextChunks: bindWorkspacePathOperation(readTextChunks, 'read', context),
        removePathLocked: bindWorkspacePathOperation(removePathLocked, 'delete', context),
        scanDirectory: scanWorkspaceDirectory,
        searchText: searchWorkspaceText,
        searchWorkspaceSymbols: searchBoundWorkspaceSymbols,
        statPath: bindWorkspacePathOperation(statPath, 'stat', context),
        withIoResourceLock: bindWorkspacePathOperation(withIoResourceLock, 'write', context),
        warmReadThroughContext: bindWorkspacePathOperation(warmReadThroughContext, 'read', context),
        writeFileAtomic: bindWorkspacePathOperation(writeFileAtomic, 'write', context),
    });
}
