// @ts-check
/**
 * Workspace read-only MCP tools.
 *
 * @module copilot/mcp/tools/repo-read
 */

import { runBoundedOperationBatch } from '#copilot/infra/public/concurrency/bulk';
import { truncateUtf8String } from '#copilot/infra/public/platform/buffer';

import { defineMcpRawTool } from '#copilot/mcp/public/protocol/catalog';
import {
    errorResult,
    estimateStructuredTextResultBytes,
    MCP_TOOL_EXECUTION_LIMITS,
    okResult,
    requireMcpToolGitConfig,
    requireMcpToolRepositoryReadCacheConfig,
    requireMcpToolWorkspace,
    withBoundedResultPage,
    withResultSizeHint,
} from '#copilot/mcp/public/protocol/tools';
import {
    auditRepositoryRootRedaction,
    diffRepositoryFiles,
    findRepositorySymbolUsages,
    readRepositoryFile,
    readRepositoryFileChunks,
    readRepositoryFileOutline,
    readRepositoryInventory,
    readRepositoryFileStats,
    readRepositoryTree,
    searchRepositorySymbols,
    searchRepositoryText,
} from '#copilot/mcp/public/workspace/repository/read';
import { execWorkspaceGit as execGit } from '#copilot/mcp/public/workspace/git';
import { z } from 'zod';
import { compactRepoReadBatchExecution, frameRepoReadBatchExecution } from './repo-read-batch.js';
import { repoStatusHandler, repoStatusOutputSchema } from './repo-status.js';

/** @typedef {import('#copilot/mcp/public/workspace').McpWorkspaceCapability} RepoReadWorkspaceCapability */

const {
    maxBatchRequests: MAX_REPO_BATCH_REQUESTS,
    defaultBatchConcurrency: DEFAULT_REPO_BATCH_CONCURRENCY,
    maxBatchConcurrency: MAX_REPO_BATCH_CONCURRENCY,
    maxBatchInputBytes: MAX_REPO_BATCH_INPUT_BYTES,
    defaultBatchResultBudgetBytes: DEFAULT_REPO_BATCH_RESULT_BUDGET_BYTES,
    minBatchResultBudgetBytes: MIN_REPO_BATCH_RESULT_BUDGET_BYTES,
    maxBatchResultBudgetBytes: MAX_REPO_BATCH_RESULT_BUDGET_BYTES,
    maxSearchContextLines: MAX_REPO_SEARCH_CONTEXT_LINES,
    defaultTreeMaxEntries: DEFAULT_REPO_TREE_MAX_ENTRIES,
    maxTreeMaxEntries: MAX_REPO_TREE_MAX_ENTRIES,
    defaultTreeContentBudgetBytes: DEFAULT_REPO_TREE_CONTENT_BUDGET_BYTES,
    minTreeContentBudgetBytes: MIN_REPO_TREE_CONTENT_BUDGET_BYTES,
    maxTreeContentBudgetBytes: MAX_REPO_TREE_CONTENT_BUDGET_BYTES,
    maxTreeToolResultBytes: MAX_REPO_TREE_TOOL_RESULT_BYTES,
    maxTreeEnumeratedEntries: MAX_REPO_TREE_ENUMERATED_ENTRIES,
    defaultChunkLines: DEFAULT_REPO_CHUNK_LINES,
    maxChunkLines: MAX_REPO_CHUNK_LINES,
    defaultChunkMaxChunks: DEFAULT_REPO_CHUNK_MAX_CHUNKS,
    maxChunkMaxChunks: MAX_REPO_CHUNK_MAX_CHUNKS,
    defaultChunkContentBudgetBytes: DEFAULT_REPO_CHUNK_CONTENT_BUDGET_BYTES,
    minChunkContentBudgetBytes: MIN_REPO_CHUNK_CONTENT_BUDGET_BYTES,
    maxChunkContentBudgetBytes: MAX_REPO_CHUNK_CONTENT_BUDGET_BYTES,
    maxChunkToolResultBytes: MAX_REPO_CHUNK_TOOL_RESULT_BYTES,
    defaultInventoryMaxResults: DEFAULT_REPO_INVENTORY_MAX_RESULTS,
    maxInventoryMaxResults: MAX_REPO_INVENTORY_MAX_RESULTS,
    defaultInventoryContentBudgetBytes: DEFAULT_REPO_INVENTORY_CONTENT_BUDGET_BYTES,
    minInventoryContentBudgetBytes: MIN_REPO_INVENTORY_CONTENT_BUDGET_BYTES,
    maxInventoryContentBudgetBytes: MAX_REPO_INVENTORY_CONTENT_BUDGET_BYTES,
    maxInventoryToolResultBytes: MAX_REPO_INVENTORY_TOOL_RESULT_BYTES,
    defaultOutlineMaxItems: DEFAULT_REPO_OUTLINE_MAX_ITEMS,
    maxOutlineMaxItems: MAX_REPO_OUTLINE_MAX_ITEMS,
    defaultOutlineContentBudgetBytes: DEFAULT_REPO_OUTLINE_CONTENT_BUDGET_BYTES,
    minOutlineContentBudgetBytes: MIN_REPO_OUTLINE_CONTENT_BUDGET_BYTES,
    maxOutlineContentBudgetBytes: MAX_REPO_OUTLINE_CONTENT_BUDGET_BYTES,
    maxOutlineToolResultBytes: MAX_REPO_OUTLINE_TOOL_RESULT_BYTES,
} = MCP_TOOL_EXECUTION_LIMITS.repoRead;

const REPO_READ_BATCH_LIMITS = Object.freeze({
    defaultResultBudgetBytes: DEFAULT_REPO_BATCH_RESULT_BUDGET_BYTES,
    minResultBudgetBytes: MIN_REPO_BATCH_RESULT_BUDGET_BYTES,
    maxResultBudgetBytes: MAX_REPO_BATCH_RESULT_BUDGET_BYTES,
    maxBatchItems: MAX_REPO_BATCH_REQUESTS,
});

const repoReadBatchItemSchema = z.object({
    path: z.string().min(1),
    startLine: z.number().int().min(1).optional(),
    endLine: z.number().int().min(1).optional(),
    hashMode: z.enum(['full', 'returned', 'none']).optional(),
});

const repoSearchBatchItemSchema = z.object({
    pattern: z.string().min(1).optional(),
    query: z.string().min(1).optional(),
    path: z.string().optional(),
    isRegex: z.boolean().optional(),
    caseSensitive: z.boolean().optional(),
    includePattern: z.string().optional(),
    excludePattern: z.string().optional(),
    contextLines: z.number().int().min(0).max(MAX_REPO_SEARCH_CONTEXT_LINES).optional(),
    maxResults: z.number().int().min(1).max(500).optional(),
    cursor: z.string().optional(),
});

const repoOutlineBatchItemSchema = z.object({
    path: z.string().min(1),
    includeImports: z.boolean().optional(),
    includeExports: z.boolean().optional(),
    includeOutline: z.boolean().optional(),
    includeTopComments: z.boolean().optional(),
    maxItems: z.number().int().min(1).max(MAX_REPO_OUTLINE_MAX_ITEMS).optional(),
    maxBytes: z
        .number()
        .int()
        .min(MIN_REPO_OUTLINE_CONTENT_BUDGET_BYTES)
        .max(MAX_REPO_OUTLINE_CONTENT_BUDGET_BYTES)
        .optional(),
    cursor: z.string().max(32 * 1024).optional(),
});

const repoStatBatchItemSchema = z.object({
    path: z.string().min(1),
    includeHash: z.boolean().optional(),
    maxHashBytes: z
        .number()
        .int()
        .min(1)
        .max(25 * 1024 * 1024)
        .optional(),
});

const repoBulkInspectItemSchema = z.object({
    op: z.enum(['read', 'search', 'stat']),
    args: z.record(z.string(), z.unknown()),
});

/** @param {unknown} value */
function estimateRepoBatchItemBytes(value) {
    try {
        return Buffer.byteLength(JSON.stringify(value), 'utf8') + 64;
    } catch {
        return MAX_REPO_BATCH_INPUT_BYTES + 1;
    }
}

/**
 * Convert one protocol-neutral repository operation into an MCP result.
 *
 * @param {Awaited<ReturnType<typeof readRepositoryFile>>} operation
 * @param {string} [sizeHintSource]
 * @param {'read-file' | 'search-text' | 'tree' | 'chunks' | 'inventory' | 'outline'} [heavySummaryKind]
 * @param {number | undefined} [boundedPageBudgetBytes]
 * @returns {import('#copilot/mcp/public/protocol/tools').StructuredCallToolResult}
 */
function frameRepositoryReadOperation(operation, sizeHintSource, heavySummaryKind, boundedPageBudgetBytes) {
    if (!operation.ok) return errorResult(operation.message, operation.details);
    const text = heavySummaryKind
        ? buildHeavyRepositoryResultSummary(heavySummaryKind, operation.structured)
        : operation.text;
    const result = okResult(operation.structured, text);
    if (boundedPageBudgetBytes !== undefined) {
        const cursor = operation.structured['cursor'];
        const nextCursor = operation.structured['nextCursor'];
        return withBoundedResultPage(result, {
            ...(cursor === undefined ? {} : { cursor: /** @type {string | number | null} */ (cursor) }),
            ...(nextCursor === undefined
                ? {}
                : { nextCursor: /** @type {string | number | null} */ (nextCursor) }),
            truncated: operation.structured['truncated'] === true,
            truncationReason:
                typeof operation.structured['truncationReason'] === 'string'
                    ? operation.structured['truncationReason']
                    : null,
            budgetBytes: boundedPageBudgetBytes,
            contentBytes: Number(operation.structured['returnedContentBytes'] ?? 0),
            contentBudgetBytes: Number(operation.structured['contentBudgetBytes'] ?? 0),
            source: sizeHintSource ?? 'bounded-repository-result',
        });
    }
    if (!sizeHintSource) return result;
    return withResultSizeHint(result, {
        bytes: estimateStructuredTextResultBytes(operation.structured, text ?? ''),
        strategy: 'conservative-estimate',
        source: sizeHintSource,
    });
}

const MAX_HEAVY_RESULT_SUMMARY_BYTES = 2048;

/**
 * Keep heavy repository payloads exactly once in structuredContent while retaining a small deterministic TextContent
 * compatibility surface. This is intentionally tool-local instead of changing okResult globally: only result shapes
 * with proven structuredContent visibility and measured duplication use compact framing.
 *
 * @param {'read-file' | 'search-text' | 'tree' | 'chunks' | 'inventory' | 'outline'} kind
 * @param {Record<string, unknown>} structured
 */
function buildHeavyRepositoryResultSummary(kind, structured) {
    const path = String(structured['path'] ?? '.');
    let text;
    if (kind === 'read-file') {
        const returned =
            structured['returnedLines'] && typeof structured['returnedLines'] === 'object'
                ? /** @type {Record<string, unknown>} */ (structured['returnedLines'])
                : {};
        text = `Read ${path}: bytes=${Number(structured['bytes'] ?? 0)}, lines=${Number(returned['start'] ?? 0)}-${Number(returned['end'] ?? 0)}/${Number(structured['totalLines'] ?? 0)}; full file text is in structuredContent.content.`;
    } else if (kind === 'search-text') {
        text = `Search ${JSON.stringify(String(structured['pattern'] ?? ''))} in ${path}: returnedMatches=${Number(structured['returnedMatchCount'] ?? structured['matchCount'] ?? 0)}/${Number(structured['totalMatchCount'] ?? structured['totalMatches'] ?? 0)}, returnedLines=${Number(structured['returnedLineCount'] ?? 0)}, truncated=${structured['truncated'] === true}, nextCursor=${String(structured['nextCursor'] ?? 'none')}; full matched output is in structuredContent.output.`;
    } else if (kind === 'tree') {
        text = `Tree ${path}: returned=${Number(structured['count'] ?? 0)}/${Number(structured['totalVisible'] ?? structured['totalScanned'] ?? 0)}, scanned=${Number(structured['totalScanned'] ?? 0)}, blocked=${Number(structured['blockedEntriesCount'] ?? 0)}, contentBytes=${Number(structured['returnedContentBytes'] ?? 0)}/${Number(structured['contentBudgetBytes'] ?? 0)}, truncated=${structured['truncated'] === true}, nextCursor=${String(structured['nextCursor'] ?? 'none')}; full tree entries are in structuredContent.entries.`;
    } else if (kind === 'inventory') {
        text = `Inventory ${path} via ${String(structured['source'] ?? 'unknown')}: returned=${Number(structured['returnedCount'] ?? 0)}/${Number(/** @type {Record<string, unknown>} */ (structured['aggregates'] ?? {})['visibleFiles'] ?? 0)}, contentBytes=${Number(structured['returnedContentBytes'] ?? 0)}/${Number(structured['contentBudgetBytes'] ?? 0)}, truncated=${structured['truncated'] === true}, nextCursor=${String(structured['nextCursor'] ?? 'none')}; paths are in structuredContent.paths.`;
    } else if (kind === 'outline') {
        const returned = /** @type {Record<string, unknown>} */ (structured['returnedCounts'] ?? {});
        const total = /** @type {Record<string, unknown>} */ (structured['totalCounts'] ?? {});
        text = `Outline ${path}: symbols=${Number(returned['symbols'] ?? 0)}/${Number(total['symbols'] ?? 0)}, imports=${Number(returned['imports'] ?? 0)}/${Number(total['imports'] ?? 0)}, exports=${Number(returned['exports'] ?? 0)}/${Number(total['exports'] ?? 0)}, contentBytes=${Number(structured['returnedContentBytes'] ?? 0)}/${Number(structured['contentBudgetBytes'] ?? 0)}, truncated=${structured['truncated'] === true}, nextCursor=${String(structured['nextCursor'] ?? 'none')}; structural collections are in structuredContent.`;
    } else {
        text = `Chunk page ${path}: chunks=${Number(structured['returnedChunkCount'] ?? structured['chunkCount'] ?? 0)}, lines=${Number(structured['returnedLineCount'] ?? 0)}, contentBytes=${Number(structured['returnedContentBytes'] ?? 0)}/${Number(structured['contentBudgetBytes'] ?? 0)}, truncated=${structured['truncated'] === true}, nextCursor=${String(structured['nextCursor'] ?? 'none')}; chunk content is in structuredContent.chunks.`;
    }
    return truncateUtf8String(text, MAX_HEAVY_RESULT_SUMMARY_BYTES).text;
}

/** @param {RepoReadWorkspaceCapability} workspace @param {import('#copilot/mcp/public/workspace/repository/read-cache').McpRepoReadCacheConfig} cacheConfig @param {{ path?: string | undefined; startLine?: number | undefined; endLine?: number | undefined; hashMode?: 'full' | 'returned' | 'none' | undefined }} input */
async function runRepoReadFileCall(workspace, cacheConfig, input) {
    return frameRepositoryReadOperation(
        await readRepositoryFile(workspace, input, cacheConfig),
        'repo_read_file',
        'read-file',
    );
}

/** @param {RepoReadWorkspaceCapability} workspace @param {{ pattern?: string | undefined; query?: string | undefined; path?: string | undefined; isRegex?: boolean | undefined; caseSensitive?: boolean | undefined; includePattern?: string | undefined; excludePattern?: string | undefined; contextLines?: number | undefined; maxResults?: number | undefined; cursor?: string | undefined }} input */
async function runRepoSearchTextCall(workspace, input) {
    return frameRepositoryReadOperation(
        await searchRepositoryText(workspace, input),
        'repo_search_text',
        'search-text',
    );
}

/** @param {RepoReadWorkspaceCapability} workspace @param {{path:string;includeImports?:boolean;includeExports?:boolean;includeOutline?:boolean;includeTopComments?:boolean;maxItems?:number;maxBytes?:number;cursor?:string}} input */
async function runRepoFileOutlineCall(workspace, input) {
    return frameRepositoryReadOperation(
        await readRepositoryFileOutline(workspace, input),
        'repo_file_outline',
        'outline',
        MAX_REPO_OUTLINE_TOOL_RESULT_BYTES,
    );
}

/** @param {{pattern?: string | undefined; query?: string | undefined}} input */
function hasDivergentSearchAliases(input) {
    return input.pattern !== undefined && input.query !== undefined && input.pattern !== input.query;
}

/** @param {RepoReadWorkspaceCapability} workspace @param {{ path: string; includeHash?: boolean; maxHashBytes?: number }} input */
async function runRepoFileStatsCall(workspace, input) {
    return frameRepositoryReadOperation(await readRepositoryFileStats(workspace, input));
}

/**
 * @param {RepoReadWorkspaceCapability} workspace
 * @param {import('#copilot/mcp/public/protocol/tools').McpToolOperationContext | undefined} operationContext
 */
function createRepoInventoryGitPorts(workspace, operationContext) {
    const config = requireMcpToolGitConfig(operationContext);
    const signal = operationContext?.signal;
    return Object.freeze({
        ...(signal ? { signal } : {}),
        /** @param {string} scopePath */
        async gitListTrackedPaths(scopePath) {
            const args = ['--literal-pathspecs', 'ls-files', '-z', '--'];
            if (scopePath !== '.') args.push(scopePath);
            const result = await execGit(args, {
                cwd: workspace.workspaceRoot,
                config,
                timeoutMs: 30_000,
                maxBufferBytes: 8 * 1024 * 1024,
                ...(signal ? { signal } : {}),
            });
            if (!result.success) {
                return {
                    ok: /** @type {const} */ (false),
                    message: 'Git tracked-file inventory failed.',
                    details: {
                        code: 'ERR_REPO_INVENTORY_GIT',
                        failureClass: 'git-read',
                        retryability: 'inspect-before-retry',
                        recoveryRequired: false,
                        exitCode: result.exitCode,
                        timedOut: result.timedOut,
                        cancelled: result.cancelled,
                        outputLimitExceeded: result.outputLimitExceeded,
                        error: result.error ?? 'git ls-files failed',
                    },
                };
            }
            const paths = Object.freeze(result.stdout.split('\0').filter(Boolean));
            return {
                ok: /** @type {const} */ (true),
                paths,
                metadata: {
                    engine: 'git ls-files -z',
                    trackedOnly: true,
                    nulDelimited: true,
                    candidateCount: paths.length,
                },
            };
        },
    });
}

/**
 * Execute one heterogeneous inspect item through the same canonical schemas used by batch mode.
 * @param {RepoReadWorkspaceCapability} workspace
 * @param {import('#copilot/mcp/public/workspace/repository/read-cache').McpRepoReadCacheConfig} cacheConfig
 * @param {unknown} raw
 * @param {number} index
 */
async function runRepoBulkInspectItem(workspace, cacheConfig, raw, index) {
    const item = repoBulkInspectItemSchema.safeParse(raw);
    if (!item.success) {
        return errorResult(`Invalid repo_bulk_inspect item at index ${index}.`, {
            code: 'ERR_BULK_INSPECT_INVALID_ITEM',
            index,
        });
    }
    const { op, args } = item.data;
    if (op === 'read') {
        const parsed = repoReadBatchItemSchema.safeParse(args);
        return parsed.success
            ? runRepoReadFileCall(workspace, cacheConfig, parsed.data)
            : errorResult(`Invalid read args at repo_bulk_inspect index ${index}.`, {
                  code: 'ERR_BULK_INSPECT_INVALID_READ',
                  index,
              });
    }
    if (op === 'search') {
        const parsed = repoSearchBatchItemSchema.safeParse(args);
        return parsed.success && (parsed.data.pattern || parsed.data.query)
            ? runRepoSearchTextCall(workspace, parsed.data)
            : errorResult(`Invalid search args at repo_bulk_inspect index ${index}.`, {
                  code: 'ERR_BULK_INSPECT_INVALID_SEARCH',
                  index,
              });
    }
    const parsed = repoStatBatchItemSchema.safeParse(args);
    return parsed.success
        ? runRepoFileStatsCall(workspace, {
              path: parsed.data.path,
              ...(parsed.data.includeHash === undefined ? {} : { includeHash: parsed.data.includeHash }),
              ...(parsed.data.maxHashBytes === undefined ? {} : { maxHashBytes: parsed.data.maxHashBytes }),
          })
        : errorResult(`Invalid stat args at repo_bulk_inspect index ${index}.`, {
              code: 'ERR_BULK_INSPECT_INVALID_STAT',
              index,
          });
}

/**
 * @type {import('#copilot/mcp/public/protocol/catalog').McpRawToolDefinition[]}
 */
export const repoReadTools = [
    defineMcpRawTool({
        name: 'repo_status',
        title: 'Repository status',
        description: 'Return workspace root, current branch, HEAD and short Git status.',
        inputSchema: {},
        outputSchema: repoStatusOutputSchema,

        handler: repoStatusHandler,
    }),
    defineMcpRawTool({
        name: 'repo_tree',
        title: 'Repository tree',
        description:
            'List deterministic flat tree entries with bounded depth, keyset continuation, glob filters and byte budget. Paths are workspace-relative; absolutePath is never returned.',
        inputSchema: {
            path: z
                .string()
                .optional()
                ['describe'](
                    'Workspace-relative directory path. Default: src/copilot. Empty string uses the default. Use "." for workspace root.',
                ),
            recursive: z.boolean().optional()['describe']('Whether to recurse into descendants. Default: false.'),
            depth: z
                .number()
                .int()
                .min(1)
                .max(8)
                .optional()
                ['describe']('Maximum relative depth when recursive=true. Default: 2; ignored for non-recursive calls.'),
            maxEntries: z
                .number()
                .int()
                .min(1)
                .max(MAX_REPO_TREE_MAX_ENTRIES)
                .optional()
                ['describe'](`Maximum entries returned in one page. Default: ${String(DEFAULT_REPO_TREE_MAX_ENTRIES)}.`),
            showHidden: z.boolean().optional()['describe']('Include allowed dotfiles/directories. Protected names remain redacted. Default: false.'),
            includePattern: z
                .string()
                .min(1)
                .max(4096)
                .optional()
                ['describe']('Optional native glob matched against paths relative to the tree scope (or basename for slashless patterns).'),
            excludePattern: z
                .string()
                .min(1)
                .max(4096)
                .optional()
                ['describe']('Optional native glob excluded after security filtering and before pagination.'),
            maxOutputBytes: z
                .number()
                .int()
                .min(MIN_REPO_TREE_CONTENT_BUDGET_BYTES)
                .max(MAX_REPO_TREE_CONTENT_BUDGET_BYTES)
                .optional()
                ['describe'](
                    `UTF-8 budget for structured tree entries. Default: ${String(DEFAULT_REPO_TREE_CONTENT_BUDGET_BYTES)}; complete result ceiling: ${String(MAX_REPO_TREE_TOOL_RESULT_BYTES)} bytes.`,
                ),
            cursor: z
                .string()
                .max(32 * 1024)
                .optional()
                ['describe']('Path-keyset nextCursor returned by the same repo_tree scope/filter configuration.'),
        },
        maxResultBytes: MAX_REPO_TREE_TOOL_RESULT_BYTES,

        handler: async (
            { path, recursive, depth, maxEntries, showHidden, includePattern, excludePattern, maxOutputBytes, cursor },
            operationContext,
        ) =>
            frameRepositoryReadOperation(
                await readRepositoryTree(requireMcpToolWorkspace(operationContext), {
                    ...(path === undefined ? {} : { path }),
                    ...(recursive === undefined ? {} : { recursive }),
                    ...(depth === undefined ? {} : { depth }),
                    maxEntries: maxEntries ?? DEFAULT_REPO_TREE_MAX_ENTRIES,
                    ...(showHidden === undefined ? {} : { showHidden }),
                    ...(includePattern === undefined ? {} : { includePattern }),
                    ...(excludePattern === undefined ? {} : { excludePattern }),
                    maxOutputBytes: maxOutputBytes ?? DEFAULT_REPO_TREE_CONTENT_BUDGET_BYTES,
                    ...(cursor === undefined ? {} : { cursor }),
                    hardMaxEntries: MAX_REPO_TREE_ENUMERATED_ENTRIES,
                    ...(operationContext?.signal ? { signal: operationContext.signal } : {}),
                }),
                'repo_tree',
                'tree',
                MAX_REPO_TREE_TOOL_RESULT_BYTES,
            ),
    }),
    defineMcpRawTool({
        name: 'repo_inventory',
        title: 'Repository inventory',
        description:
            'Return a flat deterministic workspace-relative file inventory from Git, filesystem or the persistent index with keyset continuation and aggregate counts.',
        inputSchema: {
            source: z
                .enum(['git', 'filesystem', 'index'])
                .optional()
                ['describe']('Inventory source. Default: git (tracked files only).'),
            path: z
                .string()
                .optional()
                ['describe'](
                    'Workspace-relative file or directory scope. Default: src/copilot. Empty string uses the default; use "." for workspace root.',
                ),
            maxResults: z
                .number()
                .int()
                .min(1)
                .max(MAX_REPO_INVENTORY_MAX_RESULTS)
                .optional()
                ['describe'](`Maximum paths returned in one page. Default: ${String(DEFAULT_REPO_INVENTORY_MAX_RESULTS)}.`),
            maxOutputBytes: z
                .number()
                .int()
                .min(MIN_REPO_INVENTORY_CONTENT_BUDGET_BYTES)
                .max(MAX_REPO_INVENTORY_CONTENT_BUDGET_BYTES)
                .optional()
                ['describe'](
                    `UTF-8 budget for returned paths. Default: ${String(DEFAULT_REPO_INVENTORY_CONTENT_BUDGET_BYTES)}; complete tool result ceiling: ${String(MAX_REPO_INVENTORY_TOOL_RESULT_BYTES)} bytes.`,
                ),
            cursor: z
                .string()
                .max(32 * 1024)
                .optional()
                ['describe']('Path-keyset nextCursor returned by the same repo_inventory path/source scope.'),
        },
        maxResultBytes: MAX_REPO_INVENTORY_TOOL_RESULT_BYTES,

        handler: async ({ source, path, maxResults, maxOutputBytes, cursor }, operationContext) => {
            const workspace = requireMcpToolWorkspace(operationContext);
            const effectiveSource = source ?? 'git';
            const ports =
                effectiveSource === 'git'
                    ? createRepoInventoryGitPorts(workspace, operationContext)
                    : operationContext?.signal
                      ? { signal: operationContext.signal }
                      : {};
            return frameRepositoryReadOperation(
                await readRepositoryInventory(
                    workspace,
                    {
                        source: effectiveSource,
                        ...(path === undefined ? {} : { path }),
                        maxResults: maxResults ?? DEFAULT_REPO_INVENTORY_MAX_RESULTS,
                        maxOutputBytes: maxOutputBytes ?? DEFAULT_REPO_INVENTORY_CONTENT_BUDGET_BYTES,
                        ...(cursor === undefined ? {} : { cursor }),
                    },
                    ports,
                ),
                'repo_inventory',
                'inventory',
                MAX_REPO_INVENTORY_TOOL_RESULT_BYTES,
            );
        },
    }),
    defineMcpRawTool({
        name: 'repo_root_redaction_status',
        title: 'Repository root redaction status',
        description:
            'Return root listing redaction and hidden/protected-path aggregate counts without exposing hidden or protected entry names.',
        inputSchema: {},

        handler: async (_input, operationContext) =>
            frameRepositoryReadOperation(await auditRepositoryRootRedaction(requireMcpToolWorkspace(operationContext))),
    }),
    defineMcpRawTool({
        name: 'repo_read_file',
        title: 'Read repository file',
        description:
            'Read a UTF-8 file inside the workspace, optionally using a line window. Returns SHA-256 hashes for safe follow-up writes.',
        inputSchema: {
            path: z
                .string()
                .min(1)
                .optional()
                ['describe']('Workspace-relative file path. Required outside batch mode.'),
            startLine: z.number().int().min(1).optional()['describe']('Optional 1-based first line.'),
            endLine: z.number().int().min(1).optional()['describe']('Optional 1-based last line.'),
            hashMode: z
                .enum(['full', 'returned', 'none'])
                .optional()
                ['describe']('Hash fields to return. Default full.'),
            batch: z
                .array(z.record(z.string(), z.unknown()))
                .min(1)
                .max(MAX_REPO_BATCH_REQUESTS)
                .optional()
                ['describe'](
                    'Batch up to 64 read requests using path/startLine/endLine/hashMode; do not mix with single mode.',
                ),
            batchFailureMode: z
                .enum(['best-effort', 'fail-fast'])
                .optional()
                ['describe']('Batch failure policy. Default: best-effort.'),
            batchConcurrency: z
                .number()
                .int()
                .min(1)
                .max(MAX_REPO_BATCH_CONCURRENCY)
                .optional()
                ['describe']('Maximum parallel read operations. Default: 6, hard max: 8.'),
            batchResultBudgetBytes: z
                .number()
                .int()
                .min(MIN_REPO_BATCH_RESULT_BUDGET_BYTES)
                .max(MAX_REPO_BATCH_RESULT_BUDGET_BYTES)
                .optional()
                ['describe']('Aggregate structured result budget. Default 2 MiB; hard max 3 MiB.'),
        },

        handler: async (
            { path, startLine, endLine, hashMode, batch, batchFailureMode, batchConcurrency, batchResultBudgetBytes },
            operationContext,
        ) => {
            const workspace = requireMcpToolWorkspace(operationContext);
            const repositoryReadCacheConfig = requireMcpToolRepositoryReadCacheConfig(operationContext);
            if (batch !== undefined) {
                if (path !== undefined || startLine !== undefined || endLine !== undefined || hashMode !== undefined) {
                    return errorResult('Do not mix repo_read_file batch and single-request fields.', {
                        code: 'ERR_BATCH_CONFLICTING_MODE',
                    });
                }
                const execution = await runBoundedOperationBatch(
                    /** @type {Record<string, unknown>[]} */ (batch),
                    async (item, index) => {
                        const parsed = repoReadBatchItemSchema.safeParse(item);
                        if (!parsed.success) {
                            return errorResult(`Invalid repo_read_file batch item at index ${index}.`, {
                                code: 'ERR_BATCH_INVALID_ITEM',
                                index,
                            });
                        }
                        return runRepoReadFileCall(workspace, repositoryReadCacheConfig, parsed.data);
                    },
                    {
                        concurrency: batchConcurrency ?? DEFAULT_REPO_BATCH_CONCURRENCY,
                        failureMode: batchFailureMode ?? 'best-effort',
                        maxItems: MAX_REPO_BATCH_REQUESTS,
                        maxInputBytes: MAX_REPO_BATCH_INPUT_BYTES,
                        estimateItemBytes: estimateRepoBatchItemBytes,
                        isFailure: (result) => result.isError === true,
                    },
                );
                return frameRepoReadBatchExecution(execution, {
                    budgetBytes: batchResultBudgetBytes,
                    limits: REPO_READ_BATCH_LIMITS,
                    marker: 'batch',
                    modePrefix: 'read-batch',
                    sizeHintSource: 'repo_read_file.batch',
                    summaryNoun: 'Read',
                });
            }
            if (
                batchFailureMode !== undefined ||
                batchConcurrency !== undefined ||
                batchResultBudgetBytes !== undefined
            ) {
                return errorResult('batchFailureMode/batchConcurrency/batchResultBudgetBytes require batch mode.', {
                    code: 'ERR_BATCH_OPTIONS_WITHOUT_BATCH',
                });
            }
            return runRepoReadFileCall(workspace, repositoryReadCacheConfig, { path, startLine, endLine, hashMode });
        },
    }),
    defineMcpRawTool({
        name: 'repo_bulk_inspect',
        title: 'Bulk repository inspect',
        description:
            'Mix up to 64 read, search and stat operations in one bounded read-only call with per-item failure isolation.',
        inputSchema: {
            single: repoBulkInspectItemSchema
                .optional()
                ['describe']('One read/search/stat operation using the same canonical item schema as batch mode.'),
            operations: z
                .array(repoBulkInspectItemSchema)
                .min(1)
                .max(MAX_REPO_BATCH_REQUESTS)
                .optional()
                ['describe']('Batch of ordered heterogeneous operations using {op: read|search|stat, args: {...}}.'),
            failureMode: z
                .enum(['best-effort', 'fail-fast'])
                .optional()
                ['describe']('Batch-only. Default: best-effort.'),
            concurrency: z
                .number()
                .int()
                .min(1)
                .max(MAX_REPO_BATCH_CONCURRENCY)
                .optional()
                ['describe']('Batch-only maximum independent operations in flight. Default: 6, hard max: 8.'),
            resultBudgetBytes: z
                .number()
                .int()
                .min(MIN_REPO_BATCH_RESULT_BUDGET_BYTES)
                .max(MAX_REPO_BATCH_RESULT_BUDGET_BYTES)
                .optional()
                ['describe']('Batch-only aggregate structured result budget. Default 2 MiB; hard max 3 MiB.'),
        },

        handler: async ({ single, operations, failureMode, concurrency, resultBudgetBytes }, operationContext) => {
            const workspace = requireMcpToolWorkspace(operationContext);
            const repositoryReadCacheConfig = requireMcpToolRepositoryReadCacheConfig(operationContext);
            if (single !== undefined) {
                if (operations !== undefined) {
                    return errorResult('Do not mix repo_bulk_inspect single and operations modes.', {
                        code: 'ERR_BULK_INSPECT_CONFLICTING_MODE',
                    });
                }
                if (failureMode !== undefined || concurrency !== undefined || resultBudgetBytes !== undefined) {
                    return errorResult('failureMode/concurrency/resultBudgetBytes require operations batch mode.', {
                        code: 'ERR_BULK_INSPECT_BATCH_OPTIONS_WITH_SINGLE',
                    });
                }
                return runRepoBulkInspectItem(workspace, repositoryReadCacheConfig, single, 0);
            }
            if (operations === undefined) {
                return errorResult('repo_bulk_inspect requires either single or operations.', {
                    code: 'ERR_BULK_INSPECT_MODE_REQUIRED',
                });
            }
            const execution = await runBoundedOperationBatch(
                /** @type {Record<string, unknown>[]} */ (operations),
                (raw, index) => runRepoBulkInspectItem(workspace, repositoryReadCacheConfig, raw, index),
                {
                    concurrency: concurrency ?? DEFAULT_REPO_BATCH_CONCURRENCY,
                    failureMode: failureMode ?? 'best-effort',
                    maxItems: MAX_REPO_BATCH_REQUESTS,
                    maxInputBytes: MAX_REPO_BATCH_INPUT_BYTES,
                    estimateItemBytes: estimateRepoBatchItemBytes,
                    isFailure: (result) => result.isError === true,
                },
            );
            const rows = compactRepoReadBatchExecution(execution).map((row, index) => ({
                ...row,
                op:
                    operations[index] && typeof operations[index] === 'object' && 'op' in operations[index]
                        ? operations[index].op
                        : null,
            }));
            return frameRepoReadBatchExecution(execution, {
                rows,
                budgetBytes: resultBudgetBytes,
                limits: REPO_READ_BATCH_LIMITS,
                marker: 'bulkInspect',
                modePrefix: 'bulk-inspect',
                sizeHintSource: 'repo_bulk_inspect',
                summaryNoun: 'Bulk inspect',
            });
        },
    }),
    defineMcpRawTool({
        name: 'repo_read_file_chunks',
        title: 'Read repository file chunks',
        description:
            'Read a UTF-8 file in line chunks for large-file navigation. Returns chunk metadata and nextCursor.',
        inputSchema: {
            path: z.string().min(1)['describe']('Workspace-relative file path.'),
            startLine: z.number().int().min(1).optional()['describe']('Optional 1-based first line.'),
            endLine: z.number().int().min(1).optional()['describe']('Optional 1-based last line.'),
            chunkLines: z
                .number()
                .int()
                .min(1)
                .max(MAX_REPO_CHUNK_LINES)
                .optional()
                ['describe'](`Lines per chunk. Default: ${String(DEFAULT_REPO_CHUNK_LINES)}.`),
            maxChunks: z
                .number()
                .int()
                .min(1)
                .max(MAX_REPO_CHUNK_MAX_CHUNKS)
                .optional()
                ['describe'](`Maximum chunks in one page. Default: ${String(DEFAULT_REPO_CHUNK_MAX_CHUNKS)}.`),
            maxOutputBytes: z
                .number()
                .int()
                .min(MIN_REPO_CHUNK_CONTENT_BUDGET_BYTES)
                .max(MAX_REPO_CHUNK_CONTENT_BUDGET_BYTES)
                .optional()
                ['describe'](
                    `UTF-8 budget for chunk content only. Default: ${String(DEFAULT_REPO_CHUNK_CONTENT_BUDGET_BYTES)}; the complete MCP result has a separate ${String(MAX_REPO_CHUNK_TOOL_RESULT_BYTES)}-byte ceiling.`,
                ),
            cursor: z.string().optional()['describe']('Next-line cursor returned by a previous call.'),
            highWaterMark: z
                .number()
                .int()
                .min(1024)
                .max(16 * 1024 * 1024)
                .optional()
                ['describe']('Optional stream highWaterMark in bytes.'),
        },
        maxResultBytes: MAX_REPO_CHUNK_TOOL_RESULT_BYTES,

        handler: async ({ path, startLine, endLine, chunkLines, maxChunks, maxOutputBytes, cursor, highWaterMark }, operationContext) =>
            frameRepositoryReadOperation(
                await readRepositoryFileChunks(
                    requireMcpToolWorkspace(operationContext),
                    {
                        path,
                        ...(startLine === undefined ? {} : { startLine }),
                        ...(endLine === undefined ? {} : { endLine }),
                        chunkLines: chunkLines ?? DEFAULT_REPO_CHUNK_LINES,
                        maxChunks: maxChunks ?? DEFAULT_REPO_CHUNK_MAX_CHUNKS,
                        maxOutputBytes: maxOutputBytes ?? DEFAULT_REPO_CHUNK_CONTENT_BUDGET_BYTES,
                        ...(cursor === undefined ? {} : { cursor }),
                        ...(highWaterMark === undefined ? {} : { highWaterMark }),
                    },
                    requireMcpToolRepositoryReadCacheConfig(operationContext),
                ),
                'repo_read_file_chunks',
                'chunks',
                MAX_REPO_CHUNK_TOOL_RESULT_BYTES,
            ),
    }),
    defineMcpRawTool({
        name: 'repo_diff_files',
        title: 'Diff repository files',
        description: 'Return a unified diff between two workspace files using the canonical IO diff engine.',
        inputSchema: {
            pathA: z.string().min(1)['describe']('Workspace-relative baseline file path.'),
            pathB: z.string().min(1)['describe']('Workspace-relative comparison file path.'),
            contextLines: z.number().int().min(0).max(20).optional()['describe']('Diff context lines. Default: 3.'),
            includeDiffPreview: z
                .boolean()
                .optional()
                ['describe']('Include textual diff in the tool result. Default: false.'),
        },

        handler: async ({ pathA, pathB, contextLines, includeDiffPreview }, operationContext) =>
            frameRepositoryReadOperation(
                await diffRepositoryFiles(requireMcpToolWorkspace(operationContext), {
                    pathA,
                    pathB,
                    ...(contextLines === undefined ? {} : { contextLines }),
                    ...(includeDiffPreview === undefined ? {} : { includeDiffPreview }),
                }),
            ),
    }),
    defineMcpRawTool({
        name: 'repo_search_text',
        title: 'Search repository text',
        description: 'Search text or regex inside the workspace and return matching lines.',
        inputSchema: {
            pattern: z.string().min(1).optional()['describe']('Text or regex pattern to search.'),
            query: z
                .string()
                .min(1)
                .optional()
                ['describe']('Alias for pattern; if both pattern and query are supplied they must be identical.'),
            path: z.string().optional()['describe']('Workspace-relative search root. Default: src/copilot.'),
            isRegex: z.boolean().optional()['describe']('Treat pattern as regex. Default: false.'),
            caseSensitive: z.boolean().optional()['describe']('Case-sensitive search. Default: false.'),
            includePattern: z.string().optional()['describe']('Optional include glob, for example *.js.'),
            excludePattern: z.string().optional()['describe']('Optional exclude glob.'),
            contextLines: z
                .number()
                .int()
                .min(0)
                .max(MAX_REPO_SEARCH_CONTEXT_LINES)
                .optional()
                ['describe'](
                    'Lines of context around each match. Default: 0; hard max: 48 to reduce search→read round trips.',
                ),
            maxResults: z.number().int().min(1).max(500).optional()['describe']('Maximum matches returned.'),
            cursor: z.string().optional()['describe']('Cursor returned by a previous repo_search_text call.'),
            batch: z
                .array(z.record(z.string(), z.unknown()))
                .min(1)
                .max(MAX_REPO_BATCH_REQUESTS)
                .optional()
                ['describe']('Batch up to 64 search requests using the normal fields; do not mix with single mode.'),
            batchFailureMode: z
                .enum(['best-effort', 'fail-fast'])
                .optional()
                ['describe']('Batch failure policy. Default: best-effort.'),
            batchConcurrency: z
                .number()
                .int()
                .min(1)
                .max(MAX_REPO_BATCH_CONCURRENCY)
                .optional()
                ['describe']('Maximum parallel search operations. Default: 6, hard max: 8.'),
            batchResultBudgetBytes: z
                .number()
                .int()
                .min(MIN_REPO_BATCH_RESULT_BUDGET_BYTES)
                .max(MAX_REPO_BATCH_RESULT_BUDGET_BYTES)
                .optional()
                ['describe']('Aggregate structured result budget. Default 2 MiB; hard max 3 MiB.'),
        },

        handler: async (
            {
                pattern,
                path,
                isRegex,
                caseSensitive,
                includePattern,
                excludePattern,
                contextLines,
                maxResults,
                cursor,
                query,
                batch,
                batchFailureMode,
                batchConcurrency,
                batchResultBudgetBytes,
            },
            operationContext,
        ) => {
            if (batch !== undefined) {
                if (
                    pattern !== undefined ||
                    query !== undefined ||
                    path !== undefined ||
                    isRegex !== undefined ||
                    caseSensitive !== undefined ||
                    includePattern !== undefined ||
                    excludePattern !== undefined ||
                    contextLines !== undefined ||
                    maxResults !== undefined ||
                    cursor !== undefined
                ) {
                    return errorResult('Do not mix repo_search_text batch and single-request fields.', {
                        code: 'ERR_BATCH_CONFLICTING_MODE',
                    });
                }
                const workspace = requireMcpToolWorkspace(operationContext);
                const execution = await runBoundedOperationBatch(
                    /** @type {Record<string, unknown>[]} */ (batch),
                    async (item, index) => {
                        const parsed = repoSearchBatchItemSchema.safeParse(item);
                        if (!parsed.success || (!parsed.data.pattern && !parsed.data.query)) {
                            return errorResult(`Invalid repo_search_text batch item at index ${index}.`, {
                                code: 'ERR_BATCH_INVALID_ITEM',
                                index,
                            });
                        }
                        if (hasDivergentSearchAliases(parsed.data)) {
                            return errorResult(
                                `repo_search_text batch item ${index} has conflicting pattern/query aliases.`,
                                {
                                    code: 'ERR_SEARCH_ALIAS_CONFLICT',
                                    index,
                                    hint: 'Provide pattern or query, or provide the same value in both aliases.',
                                },
                            );
                        }
                        return runRepoSearchTextCall(workspace, parsed.data);
                    },
                    {
                        concurrency: batchConcurrency ?? DEFAULT_REPO_BATCH_CONCURRENCY,
                        failureMode: batchFailureMode ?? 'best-effort',
                        maxItems: MAX_REPO_BATCH_REQUESTS,
                        maxInputBytes: MAX_REPO_BATCH_INPUT_BYTES,
                        estimateItemBytes: estimateRepoBatchItemBytes,
                        isFailure: (result) => result.isError === true,
                    },
                );
                return frameRepoReadBatchExecution(execution, {
                    budgetBytes: batchResultBudgetBytes,
                    limits: REPO_READ_BATCH_LIMITS,
                    marker: 'batch',
                    modePrefix: 'search-batch',
                    sizeHintSource: 'repo_search_text.batch',
                    summaryNoun: 'Search',
                });
            }
            if (
                batchFailureMode !== undefined ||
                batchConcurrency !== undefined ||
                batchResultBudgetBytes !== undefined
            ) {
                return errorResult('batchFailureMode/batchConcurrency/batchResultBudgetBytes require batch mode.', {
                    code: 'ERR_BATCH_OPTIONS_WITHOUT_BATCH',
                });
            }
            if (hasDivergentSearchAliases({ pattern, query })) {
                return errorResult('pattern and query aliases conflict.', {
                    code: 'ERR_SEARCH_ALIAS_CONFLICT',
                    hint: 'Provide pattern or query, or provide the same value in both aliases.',
                });
            }
            const workspace = requireMcpToolWorkspace(operationContext);
            return runRepoSearchTextCall(workspace, {
                pattern,
                query,
                path,
                isRegex,
                caseSensitive,
                includePattern,
                excludePattern,
                contextLines,
                maxResults,
                cursor,
            });
        },
    }),
    defineMcpRawTool({
        name: 'repo_find_symbol_usages',
        title: 'Find repository symbol usages',
        description:
            'Find textual usages of a symbol in the workspace with whole-word defaults, matching the LLM-B find_symbol_usages workflow.',
        inputSchema: {
            symbol: z.string().min(1)['describe']('Symbol name to search for.'),
            path: z.string().optional()['describe']('Workspace-relative search root. Default: src/copilot.'),
            includePattern: z.string().optional()['describe']('Include glob. Default: *.{js,ts,mjs,cjs}.'),
            excludePattern: z.string().optional()['describe']('Exclude glob, for example node_modules or dist.'),
            wholeWord: z.boolean().optional()['describe']('Search only whole-word symbol occurrences. Default: true.'),
            caseSensitive: z.boolean().optional()['describe']('Case-sensitive search. Default: true for symbols.'),
            maxResults: z.number().int().min(1).max(500).optional()['describe']('Maximum matches returned.'),
            cursor: z.string().optional()['describe']('Cursor returned by a previous repo_find_symbol_usages call.'),
        },

        handler: async (
            { symbol, path, includePattern, excludePattern, wholeWord, caseSensitive, maxResults, cursor },
            operationContext,
        ) =>
            frameRepositoryReadOperation(
                await findRepositorySymbolUsages(requireMcpToolWorkspace(operationContext), {
                    symbol,
                    ...(path === undefined ? {} : { path }),
                    ...(includePattern === undefined ? {} : { includePattern }),
                    ...(excludePattern === undefined ? {} : { excludePattern }),
                    ...(wholeWord === undefined ? {} : { wholeWord }),
                    ...(caseSensitive === undefined ? {} : { caseSensitive }),
                    ...(maxResults === undefined ? {} : { maxResults }),
                    ...(cursor === undefined ? {} : { cursor }),
                }),
            ),
    }),
    defineMcpRawTool({
        name: 'repo_symbol_search',
        title: 'Search repository symbols',
        description:
            'Search functions, classes, exports, variables and types in the workspace using the canonical IO symbol search.',
        inputSchema: {
            name: z.string().min(1)['describe']('Symbol name, prefix or substring to search.'),
            kind: z
                .enum(['function', 'class', 'variable', 'export', 'type', 'all'])
                .optional()
                ['describe']('Symbol kind. Default: all.'),
            path: z.string().optional()['describe']('Workspace-relative search root. Default: src/copilot.'),
            includePattern: z.string().optional()['describe']('Optional include glob, for example *.js.'),
            caseSensitive: z.boolean().optional()['describe']('Case-sensitive search. Default: false.'),
            exactMatch: z.boolean().optional()['describe']('Require exact symbol name. Default: false.'),
            maxResults: z.number().int().min(1).max(500).optional()['describe']('Maximum matches returned.'),
            cursor: z.string().optional()['describe']('Cursor returned by a previous repo_symbol_search call.'),
        },

        handler: async (
            { name, kind, path, includePattern, caseSensitive, exactMatch, maxResults, cursor },
            operationContext,
        ) =>
            frameRepositoryReadOperation(
                await searchRepositorySymbols(requireMcpToolWorkspace(operationContext), {
                    name,
                    ...(kind === undefined ? {} : { kind }),
                    ...(path === undefined ? {} : { path }),
                    ...(includePattern === undefined ? {} : { includePattern }),
                    ...(caseSensitive === undefined ? {} : { caseSensitive }),
                    ...(exactMatch === undefined ? {} : { exactMatch }),
                    ...(maxResults === undefined ? {} : { maxResults }),
                    ...(cursor === undefined ? {} : { cursor }),
                }),
            ),
    }),
    defineMcpRawTool({
        name: 'repo_file_outline',
        title: 'Repository file outline',
        description:
            'Parse one file or a bounded batch and return paginated symbols/imports/exports/outline/top comments with revision-bound continuation.',
        inputSchema: {
            path: z.string().min(1).optional()['describe']('Single-mode workspace-relative file path.'),
            includeImports: z.boolean().optional()['describe']('Single-mode: include imports. Default: true.'),
            includeExports: z.boolean().optional()['describe']('Single-mode: include exports. Default: true.'),
            includeOutline: z.boolean().optional()['describe']('Single-mode: include textual outline. Default: true.'),
            includeTopComments: z.boolean().optional()['describe']('Single-mode: include top comments. Default: false.'),
            maxItems: z
                .number()
                .int()
                .min(1)
                .max(MAX_REPO_OUTLINE_MAX_ITEMS)
                .optional()
                ['describe'](`Single-mode maximum items returned per collection. Default: ${String(DEFAULT_REPO_OUTLINE_MAX_ITEMS)}.`),
            maxBytes: z
                .number()
                .int()
                .min(MIN_REPO_OUTLINE_CONTENT_BUDGET_BYTES)
                .max(MAX_REPO_OUTLINE_CONTENT_BUDGET_BYTES)
                .optional()
                ['describe'](
                    `Single-mode UTF-8 budget for structural collections. Default: ${String(DEFAULT_REPO_OUTLINE_CONTENT_BUDGET_BYTES)}; complete result ceiling: ${String(MAX_REPO_OUTLINE_TOOL_RESULT_BYTES)} bytes.`,
                ),
            cursor: z
                .string()
                .max(32 * 1024)
                .optional()
                ['describe']('Single-mode revision/profile-bound nextCursor returned by a previous repo_file_outline page.'),
            batch: z
                .array(z.record(z.string(), z.unknown()))
                .min(1)
                .max(MAX_REPO_BATCH_REQUESTS)
                .optional()
                ['describe']('Batch up to 64 file-outline requests using the single-mode fields; do not mix with single mode.'),
            batchFailureMode: z
                .enum(['best-effort', 'fail-fast'])
                .optional()
                ['describe']('Batch failure policy. Default: best-effort.'),
            batchConcurrency: z
                .number()
                .int()
                .min(1)
                .max(MAX_REPO_BATCH_CONCURRENCY)
                .optional()
                ['describe']('Maximum parallel outline operations. Default: 6, hard max: 8.'),
            batchResultBudgetBytes: z
                .number()
                .int()
                .min(MIN_REPO_BATCH_RESULT_BUDGET_BYTES)
                .max(MAX_REPO_BATCH_RESULT_BUDGET_BYTES)
                .optional()
                ['describe']('Aggregate structured batch-result budget. Default 2 MiB; hard max 3 MiB.'),
        },
        maxResultBytes: MAX_REPO_OUTLINE_TOOL_RESULT_BYTES,

        handler: async (
            {
                path,
                includeImports,
                includeExports,
                includeOutline,
                includeTopComments,
                maxItems,
                maxBytes,
                cursor,
                batch,
                batchFailureMode,
                batchConcurrency,
                batchResultBudgetBytes,
            },
            operationContext,
        ) => {
            const workspace = requireMcpToolWorkspace(operationContext);
            if (batch !== undefined) {
                if (
                    path !== undefined ||
                    includeImports !== undefined ||
                    includeExports !== undefined ||
                    includeOutline !== undefined ||
                    includeTopComments !== undefined ||
                    maxItems !== undefined ||
                    maxBytes !== undefined ||
                    cursor !== undefined
                ) {
                    return errorResult('Do not mix repo_file_outline batch and single-request fields.', {
                        code: 'ERR_BATCH_CONFLICTING_MODE',
                    });
                }
                const execution = await runBoundedOperationBatch(
                    /** @type {Record<string, unknown>[]} */ (batch),
                    async (item, index) => {
                        const parsed = repoOutlineBatchItemSchema.safeParse(item);
                        if (!parsed.success) {
                            return errorResult(`Invalid repo_file_outline batch item at index ${index}.`, {
                                code: 'ERR_BATCH_INVALID_ITEM',
                                index,
                            });
                        }
                        return runRepoFileOutlineCall(workspace, {
                            path: parsed.data.path,
                            ...(parsed.data.includeImports === undefined ? {} : { includeImports: parsed.data.includeImports }),
                            ...(parsed.data.includeExports === undefined ? {} : { includeExports: parsed.data.includeExports }),
                            ...(parsed.data.includeOutline === undefined ? {} : { includeOutline: parsed.data.includeOutline }),
                            ...(parsed.data.includeTopComments === undefined
                                ? {}
                                : { includeTopComments: parsed.data.includeTopComments }),
                            maxItems: parsed.data.maxItems ?? DEFAULT_REPO_OUTLINE_MAX_ITEMS,
                            maxBytes: parsed.data.maxBytes ?? DEFAULT_REPO_OUTLINE_CONTENT_BUDGET_BYTES,
                            ...(parsed.data.cursor === undefined ? {} : { cursor: parsed.data.cursor }),
                        });
                    },
                    {
                        concurrency: batchConcurrency ?? DEFAULT_REPO_BATCH_CONCURRENCY,
                        failureMode: batchFailureMode ?? 'best-effort',
                        maxItems: MAX_REPO_BATCH_REQUESTS,
                        maxInputBytes: MAX_REPO_BATCH_INPUT_BYTES,
                        estimateItemBytes: estimateRepoBatchItemBytes,
                        isFailure: (result) => result.isError === true,
                    },
                );
                return frameRepoReadBatchExecution(execution, {
                    budgetBytes: batchResultBudgetBytes,
                    limits: REPO_READ_BATCH_LIMITS,
                    marker: 'batch',
                    modePrefix: 'outline-batch',
                    sizeHintSource: 'repo_file_outline.batch',
                    summaryNoun: 'Outline',
                });
            }
            if (
                batchFailureMode !== undefined ||
                batchConcurrency !== undefined ||
                batchResultBudgetBytes !== undefined
            ) {
                return errorResult('batchFailureMode/batchConcurrency/batchResultBudgetBytes require batch mode.', {
                    code: 'ERR_BATCH_OPTIONS_WITHOUT_BATCH',
                });
            }
            if (!path) {
                return errorResult('repo_file_outline requires path in single mode.', {
                    code: 'ERR_OUTLINE_PATH_REQUIRED',
                    hint: 'Provide path or use batch.',
                });
            }
            return runRepoFileOutlineCall(workspace, {
                path,
                ...(includeImports === undefined ? {} : { includeImports }),
                ...(includeExports === undefined ? {} : { includeExports }),
                ...(includeOutline === undefined ? {} : { includeOutline }),
                ...(includeTopComments === undefined ? {} : { includeTopComments }),
                maxItems: maxItems ?? DEFAULT_REPO_OUTLINE_MAX_ITEMS,
                maxBytes: maxBytes ?? DEFAULT_REPO_OUTLINE_CONTENT_BUDGET_BYTES,
                ...(cursor === undefined ? {} : { cursor }),
            });
        },
    }),
];
