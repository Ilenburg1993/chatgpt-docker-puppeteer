// @ts-check
/**
 * MCP wire adapters for repository-index operations.
 *
 * Index and module-graph authority belongs to the indexing/repository owner. This module owns schemas, annotations and
 * CallToolResult framing only.
 *
 * @module copilot/mcp/tools/repo-index
 */

import {
    auditRepositoryOrphanImports,
    buildRepositoryIndex,
    findRepositoryImports,
    readRepositoryChangeImpact,
    readRepositoryIndexStatus,
    readRepositoryModuleGraph,
    searchRepositoryIndex,
} from '#copilot/mcp/public/indexing/repository';
import { defineMcpRawTool } from '#copilot/mcp/public/protocol/catalog';
import {
    errorResult,
    okResult,
    requireMcpToolGitConfig,
    requireMcpToolIndexAutoBuildConfig,
    requireMcpToolWorkspace,
} from '#copilot/mcp/public/protocol/tools';
import { z } from 'zod';

/**
 * @param {{ ok: true; structured: Record<string, unknown>; text?: string } | { ok: false; message: string; details: Record<string, unknown> }} operation
 * @returns {import('#copilot/mcp/public/protocol/tools').StructuredCallToolResult}
 */
function frameRepositoryIndexOperation(operation) {
    return operation.ok
        ? okResult(operation.structured, operation.text)
        : errorResult(operation.message, operation.details);
}

/** @type {import('#copilot/mcp/public/protocol/catalog').McpRawToolDefinition[]} */
export const repoIndexTools = [
    defineMcpRawTool({
        name: 'repo_index_status',
        title: 'Repository index status',
        description: 'Return availability and freshness metadata for the shared local IO/FTS/symbol index.',
        inputSchema: {},

        handler: async (_input, operationContext) =>
            frameRepositoryIndexOperation(
                readRepositoryIndexStatus(
                    requireMcpToolWorkspace(operationContext),
                    requireMcpToolIndexAutoBuildConfig(operationContext),
                ),
            ),
    }),
    defineMcpRawTool({
        name: 'repo_index_build',
        title: 'Build repository index',
        description:
            'Build or refresh the shared local IO index for a workspace path. This updates only the local Copilot SQLite index.',
        inputSchema: {
            path: z
                .string()
                .optional()
                ['describe']('Workspace-relative directory path. Default: src/copilot. Empty string uses the default.'),
            recursive: z.boolean().optional()['describe']('Index recursively. Default: true.'),
            depth: z.number().int().positive().max(50).optional()['describe']('Advisory scan depth. Default: 20.'),
            respectGitignore: z.boolean().optional()['describe']('Respect .gitignore. Default: true.'),
            include: z.array(z.string().min(1)).optional()['describe']('Include glob filters for scan candidates.'),
            exclude: z.array(z.string().min(1)).optional()['describe']('Exclude glob filters for scan candidates.'),
            extensions: z.array(z.string().min(1)).optional()['describe']('Textual file extensions to index.'),
            concurrency: z.number().int().positive().max(32).optional()['describe']('Advisory indexing concurrency.'),
            maxFiles: z
                .number()
                .int()
                .positive()
                .max(25_000)
                .optional()
                ['describe']('Maximum candidate files to index.'),
            pruneMissing: z
                .boolean()
                .optional()
                ['describe']('Remove missing files from the indexed slice. Default: safe auto-prune.'),
            dryRun: z
                .boolean()
                .optional()
                ['describe']('Validate path/options and return the planned index refresh without mutating the index.'),
        },

        handler: async (
            {
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
                dryRun,
            },
            operationContext,
        ) => {
            const workspace = requireMcpToolWorkspace(operationContext);
            if (dryRun === true) {
                const resolved = await workspace.resolveReadPath(
                    typeof path === 'string' && path.trim() ? path : 'src/copilot',
                );
                if (!resolved.ok) return errorResult(resolved.reason, resolved);
                return okResult({
                    success: true,
                    dryRun: true,
                    plannedTool: 'repo_index_build',
                    path: resolved.relative,
                    workspaceRoot: workspace.workspaceRoot,
                    currentStats: workspace.indexRegistry.status(),
                    plannedOptions: {
                        workspaceRoot: workspace.workspaceRoot,
                        recursive: recursive ?? true,
                        depth: depth ?? 20,
                        respectGitignore: respectGitignore ?? true,
                        include: include ?? [],
                        exclude: exclude ?? [],
                        extensions: extensions ?? [],
                        concurrency: concurrency ?? 8,
                        maxFiles: maxFiles ?? 25_000,
                        pruneMissing: pruneMissing ?? true,
                    },
                });
            }
            return frameRepositoryIndexOperation(
                await buildRepositoryIndex(workspace, {
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
                    ...(operationContext?.signal ? { signal: operationContext.signal } : {}),
                }),
            );
        },
    }),
    defineMcpRawTool({
        name: 'repo_index_search',
        title: 'Search repository index',
        description:
            'Search the shared FTS5 index when available, with cursor pagination and include/exclude glob filters.',
        inputSchema: {
            query: z.string().min(1)['describe']('Text query for the FTS5 index.'),
            path: z
                .string()
                .optional()
                ['describe']('Workspace-relative file or directory prefix. Default: entire indexed workspace.'),
            maxResults: z
                .number()
                .int()
                .positive()
                .max(500)
                .optional()
                ['describe']('Maximum returned rows. Default: 50.'),
            cursor: z.string().optional()['describe']('Cursor returned by a previous repo_index_search call.'),
            includePattern: z.string().optional()['describe']('Include glob filter, for example *.ts.'),
            excludePattern: z.string().optional()['describe']('Exclude glob filter, for example node_modules.'),
        },

        handler: async ({ query, path, maxResults, cursor, includePattern, excludePattern }, operationContext) =>
            frameRepositoryIndexOperation(
                await searchRepositoryIndex(requireMcpToolWorkspace(operationContext), {
                    query,
                    path,
                    maxResults,
                    cursor,
                    includePattern,
                    excludePattern,
                }),
            ),
    }),
    defineMcpRawTool({
        name: 'repo_find_imports',
        title: 'Find repository imports',
        description: 'Find imports or dynamic imports by module source in the shared local index.',
        inputSchema: {
            source: z
                .string()
                .min(1)
                ['describe']('Imported module/source substring, for example react, zod, or ./utils.'),
            maxResults: z
                .number()
                .int()
                .positive()
                .max(500)
                .optional()
                ['describe']('Maximum returned rows. Default: 50.'),
            cursor: z.string().optional()['describe']('Cursor returned by a previous repo_find_imports call.'),
            exactSource: z.boolean().optional()['describe']('Require exact import source. Default: false.'),
        },

        handler: async ({ source, maxResults, cursor, exactSource }, operationContext) =>
            frameRepositoryIndexOperation(
                findRepositoryImports(requireMcpToolWorkspace(operationContext), {
                    source,
                    maxResults,
                    cursor,
                    exactSource,
                }),
            ),
    }),
    defineMcpRawTool({
        name: 'repo_graph',
        title: 'Inspect repository module graph',
        description:
            'Inspect the indexed repository module graph without reparsing source. Supports summary, dependencies, dependents, cycles, shortest dependency path and unresolved local imports.',
        inputSchema: {
            view: z
                .enum(['summary', 'dependencies', 'dependents', 'cycles', 'path', 'unresolved'])
                .optional()
                ['describe']('Graph projection. Default: summary.'),
            path: z
                .string()
                .optional()
                ['describe']('Workspace-relative graph scope. Default: src/copilot.'),
            node: z
                .string()
                .optional()
                ['describe']('Node for dependencies/dependents views; must be inside graph scope.'),
            from: z.string().optional()['describe']('Start node for view=path.'),
            to: z.string().optional()['describe']('Destination node for view=path.'),
            includeDynamic: z.boolean().optional()['describe']('Include dynamic import() edges. Default: true.'),
            maxDepth: z
                .number()
                .int()
                .min(1)
                .max(1000)
                .optional()
                ['describe']('Traversal/path depth bound. Dependencies/dependents default 1; path default 50.'),
            maxResults: z
                .number()
                .int()
                .min(1)
                .max(500)
                .optional()
                ['describe']('Maximum rows/components returned for pageable views. Default: 50.'),
            cursor: z.string().optional()['describe']('Cursor returned by a previous pageable repo_graph call.'),
        },

        handler: async ({ view, path, node, from, to, includeDynamic, maxDepth, maxResults, cursor }, operationContext) =>
            frameRepositoryIndexOperation(
                await readRepositoryModuleGraph(requireMcpToolWorkspace(operationContext), {
                    ...(view === undefined ? {} : { view }),
                    ...(path === undefined ? {} : { path }),
                    ...(node === undefined ? {} : { node }),
                    ...(from === undefined ? {} : { from }),
                    ...(to === undefined ? {} : { to }),
                    ...(includeDynamic === undefined ? {} : { includeDynamic }),
                    ...(maxDepth === undefined ? {} : { maxDepth }),
                    ...(maxResults === undefined ? {} : { maxResults }),
                    ...(cursor === undefined ? {} : { cursor }),
                }),
            ),
    }),
    defineMcpRawTool({
        name: 'repo_change_impact',
        title: 'Compute repository change impact',
        description:
            'Compute reverse dependency impact from explicit changed paths or a validated Git base/head range using the indexed module graph; no source reparse or shell graph reconstruction.',
        inputSchema: {
            paths: z
                .array(z.string().min(1))
                .min(1)
                .max(64)
                .optional()
                ['describe']('Explicit changed workspace-relative files. Mutually exclusive with gitBase/gitHead; hard max 64.'),
            gitBase: z.string().min(1).max(256).optional()['describe']('Validated Git range base; must be paired with gitHead and cannot be combined with paths.'),
            gitHead: z.string().min(1).max(256).optional()['describe']('Validated Git range head; must be paired with gitBase and cannot be combined with paths.'),
            path: z
                .string()
                .optional()
                ['describe']('Workspace-relative graph scope. Default: src/copilot.'),
            includeDynamic: z.boolean().optional()['describe']('Include dynamic import() edges. Default: true.'),
            maxDepth: z
                .number()
                .int()
                .min(1)
                .max(1000)
                .optional()
                ['describe']('Maximum reverse dependency depth. Default: 1000.'),
            includeSeeds: z.boolean().optional()['describe']('Include changed seed paths in returned impact rows. Default: false.'),
            maxResults: z
                .number()
                .int()
                .min(1)
                .max(500)
                .optional()
                ['describe']('Maximum impacted rows returned. Default: 50.'),
            cursor: z.string().optional()['describe']('Cursor returned by a previous repo_change_impact call.'),
        },

        handler: async ({ paths, gitBase, gitHead, path, includeDynamic, maxDepth, includeSeeds, maxResults, cursor }, operationContext) =>
            frameRepositoryIndexOperation(
                await readRepositoryChangeImpact(
                    requireMcpToolWorkspace(operationContext),
                    {
                        ...(paths === undefined ? {} : { paths }),
                        ...(gitBase === undefined ? {} : { gitBase }),
                        ...(gitHead === undefined ? {} : { gitHead }),
                        ...(path === undefined ? {} : { path }),
                        ...(includeDynamic === undefined ? {} : { includeDynamic }),
                        ...(maxDepth === undefined ? {} : { maxDepth }),
                        ...(includeSeeds === undefined ? {} : { includeSeeds }),
                        ...(maxResults === undefined ? {} : { maxResults }),
                        ...(cursor === undefined ? {} : { cursor }),
                    },
                    {
                        gitConfig: requireMcpToolGitConfig(operationContext),
                        ...(operationContext?.signal ? { signal: operationContext.signal } : {}),
                    },
                ),
            ),
    }),
    defineMcpRawTool({
        name: 'repo_find_orphan_imports',
        title: 'Find orphan repository imports',
        description:
            'Parse a workspace file or directory and report local relative or #copilot imports whose target file cannot be found.',
        inputSchema: {
            path: z
                .string()
                .optional()
                ['describe'](
                    'Workspace-relative file or directory path. Default: src/copilot. Empty string uses default.',
                ),
            recursive: z.boolean().optional()['describe']('Scan directories recursively. Default: true.'),
            depth: z.number().int().positive().max(50).optional()['describe']('Directory scan depth. Default: 20.'),
            respectGitignore: z
                .boolean()
                .optional()
                ['describe']('Reserved for compatibility; directory scans use the current indexed rows.'),
            includeDynamic: z
                .boolean()
                .optional()
                ['describe']('Also validate dynamic import() sources. Default: true.'),
            maxFiles: z
                .number()
                .int()
                .positive()
                .max(5000)
                .optional()
                ['describe']('Maximum files to parse. Default: 500.'),
            maxResults: z
                .number()
                .int()
                .positive()
                .max(500)
                .optional()
                ['describe']('Maximum returned rows. Default: 50.'),
            cursor: z.string().optional()['describe']('Cursor returned by a previous repo_find_orphan_imports call.'),
        },

        handler: async ({ path, recursive, depth, includeDynamic, maxFiles, maxResults, cursor }, operationContext) =>
            frameRepositoryIndexOperation(
                await auditRepositoryOrphanImports(requireMcpToolWorkspace(operationContext), {
                    path,
                    recursive,
                    depth,
                    includeDynamic,
                    maxFiles,
                    maxResults,
                    cursor,
                }),
            ),
    }),
];
