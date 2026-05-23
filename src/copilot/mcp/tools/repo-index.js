// @ts-check
/**
 * Workspace index MCP tools.
 *
 * These tools mirror the LLM-B `workspace_index_*` capabilities while keeping the MCP surface independent from the
 * in-repo LLM tool registry. Both surfaces share the canonical IO/index engine.
 *
 * @module copilot/mcp/tools/repo-index
 */

import {
    buildIoIndexForDirectory,
    filterIndexRowsByGlob,
    findIoIndexImports,
    findIoIndexSymbol,
    formatIndexImportRows,
    formatIndexSearchRows,
    formatIndexSymbolRows,
    getIoIndexStats,
    invalidateIoIndexPath,
    normalizeSearchWindow,
    paginateSearchItems,
    searchIoIndex,
} from '#copilot/infra/public/indexing';
import { WORKSPACE_ROOT } from '#copilot/tools';
import { z } from 'zod';
import { boundedWriteAnnotations, readOnlyAnnotations } from '../control-plane/annotations.js';
import { readMcpIndexAutoBuildState } from '../control-plane/index-auto-build.js';
import { getMcpWorkspaceRoot, resolveReadPath } from '../control-plane/paths.js';
import { errorResult, okResult } from '../control-plane/result.js';

const DEFAULT_INDEX_PATH = 'src/copilot';

/**
 * @param {unknown} value
 * @param {string} fallback
 * @returns {string}
 */
function normalizeOptionalRepoPath(value, fallback) {
    if (value === undefined || value === null) return fallback;
    const text = String(value).trim();
    return text === '' ? fallback : text;
}

/**
 * @type {import('../registry.js').McpToolDefinition[]}
 */
export const repoIndexTools = [
    {
        name: 'repo_index_status',
        title: 'Repository index status',
        description: 'Return availability and freshness metadata for the shared local IO/FTS/symbol index.',
        inputSchema: {},
        annotations: readOnlyAnnotations(),
        handler: async () =>
            okResult({
                success: true,
                workspaceRoot: getMcpWorkspaceRoot(),
                defaultPath: DEFAULT_INDEX_PATH,
                stats: getIoIndexStats(),
                autoBuild: readMcpIndexAutoBuildState(),
            }),
    },
    {
        name: 'repo_index_build',
        title: 'Build repository index',
        description:
            'Build or refresh the shared local IO index for a workspace path. This updates only the local Copilot SQLite index.',
        inputSchema: {
            path: z
                .string()
                .optional()
                .describe('Workspace-relative directory path. Default: src/copilot. Empty string uses the default.'),
            recursive: z.boolean().optional().describe('Index recursively. Default: true.'),
            depth: z.number().int().positive().max(50).optional().describe('Advisory scan depth. Default: 20.'),
            respectGitignore: z.boolean().optional().describe('Respect .gitignore. Default: true.'),
            include: z.array(z.string().min(1)).optional().describe('Include glob filters for scan candidates.'),
            exclude: z.array(z.string().min(1)).optional().describe('Exclude glob filters for scan candidates.'),
            extensions: z.array(z.string().min(1)).optional().describe('Textual file extensions to index.'),
            concurrency: z.number().int().positive().max(32).optional().describe('Advisory indexing concurrency.'),
            maxFiles: z.number().int().positive().max(25_000).optional().describe('Maximum candidate files to index.'),
            pruneMissing: z
                .boolean()
                .optional()
                .describe('Remove missing files from the indexed slice. Default: safe auto-prune.'),
        },
        annotations: boundedWriteAnnotations(),
        handler: async ({
            path,
            recursive,
            depth,
            respectGitignore,
            include,
            exclude,
            extensions,
            concurrency,
            maxFiles,
            pruneMissing,
        }) => {
            const resolved = await resolveReadPath(normalizeOptionalRepoPath(path, DEFAULT_INDEX_PATH));
            if (!resolved.ok) return errorResult(resolved.reason, resolved);
            const result = await buildIoIndexForDirectory(resolved.resolved, {
                workspaceRoot: WORKSPACE_ROOT,
                recursive: recursive ?? true,
                depth: depth ?? 20,
                respectGitignore: respectGitignore ?? true,
                ...(include !== undefined ? { include } : {}),
                ...(exclude !== undefined ? { exclude } : {}),
                ...(extensions !== undefined ? { extensions } : {}),
                ...(concurrency !== undefined ? { concurrency } : {}),
                ...(maxFiles !== undefined ? { maxFiles } : {}),
                ...(pruneMissing !== undefined ? { pruneMissing } : {}),
            });
            return okResult({
                success: result.available !== false,
                path: resolved.relative,
                workspaceRoot: getMcpWorkspaceRoot(),
                result,
                stats: getIoIndexStats(),
            });
        },
    },
    {
        name: 'repo_index_search',
        title: 'Search repository index',
        description:
            'Search the shared FTS5 index when available, with cursor pagination and include/exclude glob filters.',
        inputSchema: {
            query: z.string().min(1).describe('Text query for the FTS5 index.'),
            path: z
                .string()
                .optional()
                .describe('Workspace-relative file or directory prefix. Default: entire indexed workspace.'),
            maxResults: z.number().int().positive().max(500).optional().describe('Maximum returned rows. Default: 50.'),
            cursor: z.string().optional().describe('Cursor returned by a previous repo_index_search call.'),
            includePattern: z.string().optional().describe('Include glob filter, for example *.ts.'),
            excludePattern: z.string().optional().describe('Exclude glob filter, for example node_modules.'),
        },
        annotations: readOnlyAnnotations(),
        handler: async ({ query, path, maxResults, cursor, includePattern, excludePattern }) => {
            const stats = getIoIndexStats();
            if (!stats.available) {
                return okResult({
                    success: true,
                    available: false,
                    query,
                    output: '',
                    matchCount: 0,
                    totalMatches: 0,
                    truncated: false,
                    nextCursor: null,
                    engine: 'fts5-index',
                    stats,
                });
            }
            const window = normalizeSearchWindow({ maxResults, cursor });
            let pathPrefix;
            let relativePath = null;
            if (path !== undefined) {
                const resolved = await resolveReadPath(normalizeOptionalRepoPath(path, '.'));
                if (!resolved.ok) return errorResult(resolved.reason, resolved);
                pathPrefix = resolved.resolved;
                relativePath = resolved.relative;
            }
            const rows = searchIoIndex(query, {
                ...(window.commandMaxCount != null ? { maxResults: window.commandMaxCount } : {}),
                ...(pathPrefix !== undefined ? { pathPrefix } : {}),
            });
            const filtered = filterIndexRowsByGlob(rows, includePattern, excludePattern);
            const paged = paginateSearchItems(filtered, window);
            const output = formatIndexSearchRows(paged.items);
            return okResult(
                {
                    success: true,
                    available: true,
                    query,
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
        },
    },
    {
        name: 'repo_index_find_symbol',
        title: 'Find repository symbol in index',
        description:
            'Search persisted symbols in the shared local index. Use after repo_index_build for fast navigation.',
        inputSchema: {
            symbol: z.string().min(1).describe('Symbol name or substring.'),
            maxResults: z.number().int().positive().max(500).optional().describe('Maximum returned rows. Default: 50.'),
            cursor: z.string().optional().describe('Cursor returned by a previous repo_index_find_symbol call.'),
            exactMatch: z.boolean().optional().describe('Require exact symbol name. Default: false.'),
        },
        annotations: readOnlyAnnotations(),
        handler: async ({ symbol, maxResults, cursor, exactMatch }) => {
            const stats = getIoIndexStats();
            if (!stats.available) {
                return okResult({
                    success: true,
                    available: false,
                    symbol,
                    output: '',
                    matchCount: 0,
                    totalMatches: 0,
                    truncated: false,
                    nextCursor: null,
                    engine: 'fts5-index',
                    stats,
                });
            }
            const window = normalizeSearchWindow({ maxResults, cursor });
            const rows = findIoIndexSymbol(
                symbol,
                window.commandMaxCount != null ? { maxResults: window.commandMaxCount } : {},
            );
            const filtered = exactMatch ? rows.filter((row) => row.symbolName === symbol) : rows;
            const paged = paginateSearchItems(filtered, window);
            const output = formatIndexSymbolRows(paged.items);
            return okResult(
                {
                    success: true,
                    available: true,
                    symbol,
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
        },
    },
    {
        name: 'repo_find_imports',
        title: 'Find repository imports',
        description: 'Find imports or dynamic imports by module source in the shared local index.',
        inputSchema: {
            source: z.string().min(1).describe('Imported module/source substring, for example react, zod, or ./utils.'),
            maxResults: z.number().int().positive().max(500).optional().describe('Maximum returned rows. Default: 50.'),
            cursor: z.string().optional().describe('Cursor returned by a previous repo_find_imports call.'),
            exactSource: z.boolean().optional().describe('Require exact import source. Default: false.'),
        },
        annotations: readOnlyAnnotations(),
        handler: async ({ source, maxResults, cursor, exactSource }) => {
            const stats = getIoIndexStats();
            if (!stats.available) {
                return okResult({
                    success: true,
                    available: false,
                    source,
                    output: '',
                    matchCount: 0,
                    totalMatches: 0,
                    truncated: false,
                    nextCursor: null,
                    engine: 'fts5-index',
                    stats,
                });
            }
            const window = normalizeSearchWindow({ maxResults, cursor });
            const rows = findIoIndexImports(source, {
                ...(window.commandMaxCount != null ? { maxResults: window.commandMaxCount } : {}),
                ...(exactSource ? { exactSource: true } : {}),
            });
            const paged = paginateSearchItems(rows, window);
            const output = formatIndexImportRows(paged.items);
            return okResult(
                {
                    success: true,
                    available: true,
                    source,
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
        },
    },
    {
        name: 'repo_index_invalidate',
        title: 'Invalidate repository index path',
        description: 'Invalidate a workspace file or directory in the shared local IO index after edits.',
        inputSchema: {
            path: z.string().min(1).describe('Workspace-relative file or directory path to invalidate.'),
        },
        annotations: boundedWriteAnnotations(),
        handler: async ({ path }) => {
            const resolved = await resolveReadPath(path);
            if (!resolved.ok) return errorResult(resolved.reason, resolved);
            const invalidated = invalidateIoIndexPath(resolved.resolved);
            return okResult({
                success: true,
                path: resolved.relative,
                invalidated,
                stats: getIoIndexStats(),
            });
        },
    },
];
