// @ts-check
/**
 * Workspace-scoped indexing/search composition.
 *
 * Filesystem owns path authorization. Indexing owns scan/search/context behavior. This adapter composes the two without
 * making `filesystem/workspace` depend on indexing implementations.
 *
 * @module copilot/infra/indexing/workspace/service
 */

import {
    assertWorkspaceIoContext,
    requireValidatedWorkspaceReadPath,
    resolveWorkspacePath,
} from '#copilot/infra/internal/filesystem/workspace';
import { warmReadThroughContext as warmReadThroughContextRaw } from '#copilot/infra/internal/indexing/context';
import { scanDirectory as scanDirectoryRaw } from '#copilot/infra/internal/indexing/scanner';
import {
    searchText as searchTextRaw,
    searchWorkspaceSymbols as searchWorkspaceSymbolsRaw,
} from '#copilot/infra/internal/indexing/search';

/** @typedef {import('#copilot/infra/internal/filesystem/workspace').WorkspaceIoContext} WorkspaceIoContext */
/** @typedef {import('#copilot/infra/internal/filesystem/workspace').ValidatedReadWorkspacePath} ValidatedReadWorkspacePath */

/**
 * @param {WorkspaceIoContext} context
 */
export function createWorkspaceIndexing(context) {
    assertWorkspaceIoContext(context);

    /** @type {typeof scanDirectoryRaw} */
    const scanDirectory = async (rootPath, options = {}) =>
        scanDirectoryRaw(await resolveWorkspacePath(rootPath, 'scan', context), {
            ...options,
            workspaceRoot: context.workspaceRoot,
        });

    /** @type {(capability: ValidatedReadWorkspacePath, options?: Parameters<typeof scanDirectoryRaw>[1]) => ReturnType<typeof scanDirectoryRaw>} */
    const scanDirectoryValidated = async (capability, options = {}) =>
        scanDirectoryRaw(requireValidatedWorkspaceReadPath(capability, 'scan', context), {
            ...options,
            workspaceRoot: context.workspaceRoot,
        });

    /** @type {typeof searchTextRaw} */
    const searchText = async (targetPath, options) =>
        searchTextRaw(await resolveWorkspacePath(targetPath, 'search', context), {
            ...options,
            workspaceRoot: context.workspaceRoot,
        });

    /** @type {(capability: ValidatedReadWorkspacePath, options: Parameters<typeof searchTextRaw>[1]) => ReturnType<typeof searchTextRaw>} */
    const searchTextValidated = async (capability, options) =>
        searchTextRaw(requireValidatedWorkspaceReadPath(capability, 'search', context), {
            ...options,
            workspaceRoot: context.workspaceRoot,
        });

    /** @type {typeof searchWorkspaceSymbolsRaw} */
    const searchWorkspaceSymbols = async (targetPath, options) =>
        searchWorkspaceSymbolsRaw(await resolveWorkspacePath(targetPath, 'search', context), {
            ...options,
            workspaceRoot: context.workspaceRoot,
        });

    /** @type {(capability: ValidatedReadWorkspacePath, options: Parameters<typeof searchWorkspaceSymbolsRaw>[1]) => ReturnType<typeof searchWorkspaceSymbolsRaw>} */
    const searchWorkspaceSymbolsValidated = async (capability, options) =>
        searchWorkspaceSymbolsRaw(requireValidatedWorkspaceReadPath(capability, 'search', context), {
            ...options,
            workspaceRoot: context.workspaceRoot,
        });

    /** @type {typeof warmReadThroughContextRaw} */
    const warmReadThroughContext = async (filePath, options = {}) =>
        warmReadThroughContextRaw(await resolveWorkspacePath(filePath, 'read', context), options);

    return Object.freeze({
        scanDirectory,
        scanDirectoryValidated,
        searchText,
        searchTextValidated,
        searchWorkspaceSymbols,
        searchWorkspaceSymbolsValidated,
        warmReadThroughContext,
    });
}
