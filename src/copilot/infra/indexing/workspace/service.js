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
    resolveWorkspacePathAuthority,
} from '#copilot/infra/internal/filesystem/workspace';
import {
    createWorkspaceScopeRuntime,
    warmReadThroughContext as warmReadThroughContextRaw,
} from '#copilot/infra/internal/indexing/context';
import { scanDirectory as scanDirectoryRaw } from '#copilot/infra/internal/indexing/scanner';
import {
    searchText as searchTextRaw,
    searchWorkspaceSymbols as searchWorkspaceSymbolsRaw,
} from '#copilot/infra/internal/indexing/search';

/** @typedef {import('#copilot/infra/internal/filesystem/workspace').WorkspaceIoContext} WorkspaceIoContext */
/** @typedef {import('#copilot/infra/internal/filesystem/workspace').ValidatedReadWorkspacePath} ValidatedReadWorkspacePath */
/** @typedef {import('#copilot/infra/internal/filesystem/workspace').WorkspacePathAuthority} WorkspacePathAuthority */

/**
 * @param {WorkspaceIoContext | WorkspacePathAuthority} input
 * @param {{
 *   indexRegistry?: ReturnType<typeof import('../registry/instance/index.js').createIoIndexRegistryRuntime>;
 *   cacheRuntime?: {l1:ReturnType<typeof import('../../cache/memory/index.js').createIoL1CacheRuntime>};
 *   invalidationBus?: ReturnType<typeof import('../../filesystem/invalidation/bus/index.js').createIoInvalidationBusRuntime>;
 *   parserCacheRuntime?: ReturnType<typeof import('../parser/cache/runtime/index.js').createParserCacheRuntime>;
 * }} [options]
 */
export function createWorkspaceIndexing(input, options = {}) {
    const context = resolveWorkspacePathAuthority(input);
    assertWorkspaceIoContext(context);
    const indexRegistry = options.indexRegistry ?? null;
    const cacheRuntime = options.cacheRuntime ?? null;
    const invalidationBus = options.invalidationBus ?? null;
    const parserCacheRuntime = options.parserCacheRuntime ?? null;
    /** @type {ReturnType<typeof createWorkspaceScopeRuntime> | undefined} */
    let scopeRuntime;
    let disposed = false;

    function assertActive() {
        if (disposed) throw new Error(`WorkspaceIndexing(${context.workspaceRoot}) is disposed.`);
    }

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
        searchTextRaw(
            await resolveWorkspacePath(targetPath, 'search', context),
            { ...options, workspaceRoot: context.workspaceRoot },
            indexRegistry ? { indexRegistry } : {},
        );

    /** @type {(capability: ValidatedReadWorkspacePath, options: Parameters<typeof searchTextRaw>[1]) => ReturnType<typeof searchTextRaw>} */
    const searchTextValidated = async (capability, options) =>
        searchTextRaw(
            requireValidatedWorkspaceReadPath(capability, 'search', context),
            { ...options, workspaceRoot: context.workspaceRoot },
            indexRegistry ? { indexRegistry } : {},
        );

    /** @type {typeof searchWorkspaceSymbolsRaw} */
    const searchWorkspaceSymbols = async (targetPath, options) =>
        searchWorkspaceSymbolsRaw(
            await resolveWorkspacePath(targetPath, 'search', context),
            { ...options, workspaceRoot: context.workspaceRoot },
            indexRegistry ? { indexRegistry } : {},
        );

    /** @type {(capability: ValidatedReadWorkspacePath, options: Parameters<typeof searchWorkspaceSymbolsRaw>[1]) => ReturnType<typeof searchWorkspaceSymbolsRaw>} */
    const searchWorkspaceSymbolsValidated = async (capability, options) =>
        searchWorkspaceSymbolsRaw(
            requireValidatedWorkspaceReadPath(capability, 'search', context),
            { ...options, workspaceRoot: context.workspaceRoot },
            indexRegistry ? { indexRegistry } : {},
        );

    /** @param {string} filePath @param {string} content @param {Parameters<Awaited<typeof import('#copilot/infra/internal/indexing/parser/context')>['parseFileForContext']>[2]} [parseOptions] */
    const parseFileForContext = async (filePath, content, parseOptions = {}) => {
        const { parseFileForContext: parseFileForContextRaw } =
            await import('#copilot/infra/internal/indexing/parser/context');
        return parseFileForContextRaw(await resolveWorkspacePath(filePath, 'read', context), content, {
            ...parseOptions,
            ...(parserCacheRuntime ? { parserCacheRuntime } : {}),
        });
    };

    /** @type {typeof warmReadThroughContextRaw} */
    const warmReadThroughContext = async (filePath, options = {}) =>
        warmReadThroughContextRaw(await resolveWorkspacePath(filePath, 'read', context), {
            ...options,
            ...(indexRegistry ? { indexRegistry } : {}),
            ...(cacheRuntime ? { cacheRuntime } : {}),
            ...(parserCacheRuntime ? { parserCacheRuntime } : {}),
        });

    return Object.freeze({
        scanDirectory,
        scanDirectoryValidated,
        searchText,
        searchTextValidated,
        searchWorkspaceSymbols,
        searchWorkspaceSymbolsValidated,
        warmReadThroughContext,
        parseFileForContext,
        registry: indexRegistry,
        get context() {
            assertActive();
            if (!cacheRuntime || !invalidationBus) {
                throw new Error(
                    `WorkspaceIndexing(${context.workspaceRoot}) requires runtime-owned cache/invalidation for context scopes.`,
                );
            }
            return (scopeRuntime ??= createWorkspaceScopeRuntime({
                runtimeId: `workspace-context:${context.workspaceRoot}`,
                workspaceRoot: context.workspaceRoot,
                cacheRuntime,
                invalidationBus,
                ...(indexRegistry ? { indexRegistry } : {}),
                ...(parserCacheRuntime ? { parserCacheRuntime } : {}),
            }));
        },
        async dispose() {
            if (disposed) return;
            disposed = true;
            await scopeRuntime?.dispose();
        },
    });
}
