// @ts-check
/**
 * Repository index application operations.
 *
 * Owns build/search/symbol/import/invalidation semantics over the workspace index capability. MCP schemas and result
 * framing remain in tools/repo-index.js.
 *
 * @module copilot/mcp/indexing/repository/runtime
 */

import {
    filterIndexRowsByGlob,
    formatIndexImportRows,
    formatIndexSearchRows,
    formatIndexSymbolRows,
    normalizeSearchWindow,
    paginateSearchItems,
} from '#copilot/infra/public/indexing/search';
import { readMcpIndexAutoBuildState } from '#copilot/mcp/public/indexing/auto-build';

export const DEFAULT_REPOSITORY_INDEX_PATH = 'src/copilot';

/** @typedef {import('#copilot/mcp/public/workspace').McpWorkspaceCapability} RepositoryIndexWorkspace */
/**
 * @typedef {{ ok: true; structured: Record<string, unknown>; text?: string } |
 *           { ok: false; message: string; details: Record<string, unknown> }} RepositoryIndexOperationResult
 */

/** @param {Record<string, unknown>} structured @param {string} [text] @returns {RepositoryIndexOperationResult} */
function success(structured, text) {
    return text === undefined ? { ok: true, structured } : { ok: true, structured, text };
}

/** @param {string} message @param {Record<string, unknown>} [details] @returns {RepositoryIndexOperationResult} */
function failure(message, details = {}) {
    return { ok: false, message, details };
}

/** @param {unknown} value @param {string} fallback */
export function normalizeRepositoryIndexPath(value, fallback) {
    if (value === undefined || value === null) return fallback;
    const text = String(value).trim();
    return text === '' ? fallback : text;
}

/** @param {RepositoryIndexWorkspace} workspace @returns {RepositoryIndexOperationResult} */
export function readRepositoryIndexStatus(workspace) {
    return success({
        success: true,
        workspaceRoot: workspace.workspaceRoot,
        defaultPath: DEFAULT_REPOSITORY_INDEX_PATH,
        stats: workspace.indexRegistry.status(),
        autoBuild: readMcpIndexAutoBuildState(),
    });
}

/**
 * @param {RepositoryIndexWorkspace} workspace
 * @param {{ path?: string | undefined; recursive?: boolean | undefined; depth?: number | undefined; respectGitignore?: boolean | undefined; include?: string[] | undefined; exclude?: string[] | undefined; extensions?: string[] | undefined; concurrency?: number | undefined; maxFiles?: number | undefined; pruneMissing?: boolean | undefined }} input
 * @returns {Promise<RepositoryIndexOperationResult>}
 */
export async function buildRepositoryIndex(workspace, input) {
    const resolved = await workspace.resolveReadPath(
        normalizeRepositoryIndexPath(input.path, DEFAULT_REPOSITORY_INDEX_PATH),
    );
    if (!resolved.ok) return failure(resolved.reason, resolved);
    const result = await workspace.indexRegistry.buildDirectory(resolved.resolved, {
        workspaceRoot: workspace.workspaceRoot,
        recursive: input.recursive ?? true,
        depth: input.depth ?? 20,
        respectGitignore: input.respectGitignore ?? true,
        ...(input.include !== undefined ? { include: input.include } : {}),
        ...(input.exclude !== undefined ? { exclude: input.exclude } : {}),
        ...(input.extensions !== undefined ? { extensions: input.extensions } : {}),
        ...(input.concurrency !== undefined ? { concurrency: input.concurrency } : {}),
        ...(input.maxFiles !== undefined ? { maxFiles: input.maxFiles } : {}),
        ...(input.pruneMissing !== undefined ? { pruneMissing: input.pruneMissing } : {}),
    });
    return success({
        success: result.available !== false,
        path: resolved.relative,
        workspaceRoot: workspace.workspaceRoot,
        result,
        stats: workspace.indexRegistry.status(),
    });
}

/**
 * @param {RepositoryIndexWorkspace} workspace
 * @param {{ query: string; path?: string | undefined; maxResults?: number | undefined; cursor?: string | undefined; includePattern?: string | undefined; excludePattern?: string | undefined }} input
 * @returns {Promise<RepositoryIndexOperationResult>}
 */
export async function searchRepositoryIndex(workspace, input) {
    const stats = workspace.indexRegistry.status();
    if (!stats.available) {
        return success({
            success: true,
            available: false,
            query: input.query,
            output: '',
            matchCount: 0,
            totalMatches: 0,
            truncated: false,
            nextCursor: null,
            engine: 'fts5-index',
            stats,
        });
    }
    const window = normalizeSearchWindow({
        ...(input.maxResults === undefined ? {} : { maxResults: input.maxResults }),
        ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
    });
    let pathPrefix;
    let relativePath = null;
    if (input.path !== undefined) {
        const resolved = await workspace.resolveReadPath(normalizeRepositoryIndexPath(input.path, '.'));
        if (!resolved.ok) return failure(resolved.reason, resolved);
        pathPrefix = resolved.resolved;
        relativePath = resolved.relative;
    }
    const rows = workspace.indexRegistry.search(input.query, {
        ...(window.commandMaxCount != null ? { maxResults: window.commandMaxCount } : {}),
        ...(pathPrefix !== undefined ? { pathPrefix } : {}),
    });
    const filtered = filterIndexRowsByGlob(rows, input.includePattern, input.excludePattern);
    const paged = paginateSearchItems(filtered, window);
    const output = formatIndexSearchRows(paged.items);
    return success(
        {
            success: true,
            available: true,
            query: input.query,
            path: relativePath,
            output,
            matchCount: paged.items.length,
            totalMatches: paged.totalItems,
            truncated: paged.truncated,
            nextCursor: paged.nextCursor,
            cursorOffset: paged.cursorOffset,
            engine: 'fts5-index',
            stats,
        },
        output,
    );
}

/**
 * @param {RepositoryIndexWorkspace} workspace
 * @param {{ symbol: string; maxResults?: number | undefined; cursor?: string | undefined; exactMatch?: boolean | undefined }} input
 * @returns {RepositoryIndexOperationResult}
 */
export function findRepositoryIndexSymbol(workspace, input) {
    const stats = workspace.indexRegistry.status();
    if (!stats.available) {
        return success({
            success: true,
            available: false,
            symbol: input.symbol,
            output: '',
            matchCount: 0,
            totalMatches: 0,
            truncated: false,
            nextCursor: null,
            engine: 'fts5-index',
            stats,
        });
    }
    const window = normalizeSearchWindow({
        ...(input.maxResults === undefined ? {} : { maxResults: input.maxResults }),
        ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
    });
    const rows = workspace.indexRegistry.findSymbol(
        input.symbol,
        window.commandMaxCount != null ? { maxResults: window.commandMaxCount } : {},
    );
    const filtered = input.exactMatch ? rows.filter((row) => row.symbolName === input.symbol) : rows;
    const paged = paginateSearchItems(filtered, window);
    const output = formatIndexSymbolRows(paged.items);
    return success(
        {
            success: true,
            available: true,
            symbol: input.symbol,
            output,
            matchCount: paged.items.length,
            totalMatches: paged.totalItems,
            truncated: paged.truncated,
            nextCursor: paged.nextCursor,
            cursorOffset: paged.cursorOffset,
            engine: 'fts5-index',
            stats,
        },
        output,
    );
}

/**
 * @param {RepositoryIndexWorkspace} workspace
 * @param {{ source: string; maxResults?: number | undefined; cursor?: string | undefined; exactSource?: boolean | undefined }} input
 * @returns {RepositoryIndexOperationResult}
 */
export function findRepositoryImports(workspace, input) {
    const stats = workspace.indexRegistry.status();
    if (!stats.available) {
        return success({
            success: true,
            available: false,
            source: input.source,
            output: '',
            matchCount: 0,
            totalMatches: 0,
            truncated: false,
            nextCursor: null,
            engine: 'fts5-index',
            stats,
        });
    }
    const window = normalizeSearchWindow({
        ...(input.maxResults === undefined ? {} : { maxResults: input.maxResults }),
        ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
    });
    const rows = workspace.indexRegistry.findImports(input.source, {
        ...(window.commandMaxCount != null ? { maxResults: window.commandMaxCount } : {}),
        ...(input.exactSource ? { exactSource: true } : {}),
    });
    const paged = paginateSearchItems(rows, window);
    const output = formatIndexImportRows(paged.items);
    return success(
        {
            success: true,
            available: true,
            source: input.source,
            output,
            matchCount: paged.items.length,
            totalMatches: paged.totalItems,
            truncated: paged.truncated,
            nextCursor: paged.nextCursor,
            cursorOffset: paged.cursorOffset,
            engine: 'fts5-index',
            stats,
        },
        output,
    );
}

/** @param {RepositoryIndexWorkspace} workspace @param {string} path */
export async function invalidateRepositoryIndex(workspace, path) {
    const resolved = await workspace.resolveReadPath(path);
    if (!resolved.ok) return failure(resolved.reason, resolved);
    const invalidated = workspace.indexRegistry.invalidatePath(resolved.resolved);
    return success({
        success: true,
        path: resolved.relative,
        invalidated,
        stats: workspace.indexRegistry.status(),
    });
}
