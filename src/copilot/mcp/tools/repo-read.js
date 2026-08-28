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
    requireMcpToolRepositoryReadCacheConfig,
    requireMcpToolWorkspace,
    withResultExecutionHint,
    withResultSizeHint,
} from '#copilot/mcp/public/protocol/tools';
import {
    auditRepositoryRootRedaction,
    diffRepositoryFiles,
    findRepositorySymbolUsages,
    readRepositoryFile,
    readRepositoryFileChunks,
    readRepositoryFileOutline,
    readRepositoryFileStats,
    readRepositoryTree,
    searchRepositorySymbols,
    searchRepositoryText,
} from '#copilot/mcp/public/workspace/repository/read';
import { z } from 'zod';
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
} = MCP_TOOL_EXECUTION_LIMITS.repoRead;

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

/**
 * Convert a normal MCP call result into one compact batch row. Heavy text remains only in structuredContent, so batch
 * mode does not duplicate each read/search payload in legacy content text.
 *
 * @param {number} index
 * @param {import('#copilot/mcp/public/protocol/tools').StructuredCallToolResult} result
 */
function compactBatchCallResult(index, result) {
    return {
        index,
        isError: result.isError === true,
        ...(result.structuredContent ?? {}),
    };
}

/** @param {Record<string, unknown>[]} results */
function inspectRepoBulkContinuation(results) {
    let availableOperations = 0;
    let transportRequiredOperations = 0;
    let recommendedOperations = 0;
    for (const row of results) {
        const nextCursor = typeof row['nextCursor'] === 'string' && row['nextCursor'].length > 0;
        const hasMore = row['hasMore'] === true;
        const transportRequired = row['payloadTruncated'] === true;
        const recommended = transportRequired || hasMore || row['truncated'] === true;
        const available = transportRequired || hasMore || nextCursor;
        if (available) availableOperations += 1;
        if (transportRequired) transportRequiredOperations += 1;
        if (recommended) recommendedOperations += 1;
    }
    return {
        availableOperations,
        transportRequiredOperations,
        recommendedOperations,
    };
}

/** @param {unknown} value */
function estimateRepoBatchItemBytes(value) {
    try {
        return Buffer.byteLength(JSON.stringify(value), 'utf8') + 64;
    } catch {
        return MAX_REPO_BATCH_INPUT_BYTES + 1;
    }
}

/**
 * @param {Awaited<
 *     ReturnType<
 *         typeof runBoundedOperationBatch<
 *             Record<string, unknown>,
 *             import('#copilot/mcp/public/protocol/tools').StructuredCallToolResult
 *         >
 *     >
 * >} execution
 */
function compactRepoBulkExecution(execution) {
    return execution.results.map((row) => {
        if (row.status === 'skipped') {
            return {
                index: row.index,
                status: row.status,
                isError: true,
                success: false,
                skipped: true,
                durationMs: row.durationMs,
                code: 'ERR_BATCH_SKIPPED',
                reason: row.reason,
            };
        }
        if (row.status === 'succeeded') {
            return {
                ...compactBatchCallResult(row.index, row.value),
                status: row.status,
                durationMs: row.durationMs,
            };
        }
        if ('value' in row && row.value) {
            return {
                ...compactBatchCallResult(row.index, row.value),
                status: row.status,
                durationMs: row.durationMs,
            };
        }
        return {
            index: row.index,
            status: 'failed',
            isError: true,
            success: false,
            durationMs: row.durationMs,
            code: row.code ?? 'ERR_BATCH_ITEM_EXECUTION',
            error: row.error ?? 'Batch item execution failed.',
        };
    });
}

/**
 * Keep a successful bulk execution below the registry result ceiling without dropping item-level status/metadata. Only
 * large textual payload fields are truncated; structural feedback remains available.
 *
 * @param {Record<string, unknown>[]} inputResults
 * @param {number} budgetBytes
 */
function boundRepoBulkResultPayload(inputResults, budgetBytes) {
    const effectiveBudget = Math.max(
        MIN_REPO_BATCH_RESULT_BUDGET_BYTES,
        Math.min(MAX_REPO_BATCH_RESULT_BUDGET_BYTES, Math.floor(budgetBytes)),
    );
    const originalResultBytes = Buffer.byteLength(JSON.stringify(inputResults), 'utf8');
    if (originalResultBytes <= effectiveBudget) {
        return {
            results: inputResults,
            resultBudgetBytes: effectiveBudget,
            originalResultBytes,
            resultBytes: originalResultBytes,
            payloadTruncatedCount: 0,
        };
    }

    const results = inputResults.map((row) => ({ ...row }));
    /** @type {{
    row: Record<string, unknown>;
    key: 'content' | 'output';
    original: string;
    originalBytes: number;
}[]} */
    const heavy = [];
    for (const row of results) {
        for (const key of /** @type {const} */ (['content', 'output'])) {
            const value = row[key];
            if (typeof value !== 'string' || value.length === 0) continue;
            heavy.push({ row, key, original: value, originalBytes: Buffer.byteLength(value, 'utf8') });
            row[key] = '';
        }
    }

    const skeletonBytes = Buffer.byteLength(JSON.stringify(results), 'utf8');
    let remaining = Math.max(0, effectiveBudget - skeletonBytes - 4096);
    let remainingFields = heavy.length;
    let payloadTruncatedCount = 0;
    for (const field of heavy) {
        const share = remainingFields > 0 ? Math.max(0, Math.floor(remaining / remainingFields)) : 0;
        const bounded = truncateUtf8String(field.original, share);
        field.row[field.key] = bounded.text;
        if (bounded.truncated) {
            field.row['payloadTruncated'] = true;
            field.row['originalPayloadBytes'] = field.originalBytes;
            payloadTruncatedCount += 1;
        }
        remaining = Math.max(0, remaining - Buffer.byteLength(bounded.text, 'utf8'));
        remainingFields -= 1;
    }

    let resultBytes = Buffer.byteLength(JSON.stringify(results), 'utf8');
    if (resultBytes > effectiveBudget) {
        payloadTruncatedCount = 0;
        for (const field of heavy) {
            field.row[field.key] = '';
            field.row['payloadTruncated'] = true;
            field.row['payloadOmittedForBatchBudget'] = true;
            field.row['originalPayloadBytes'] = field.originalBytes;
            payloadTruncatedCount += 1;
        }
        resultBytes = Buffer.byteLength(JSON.stringify(results), 'utf8');
    }
    return {
        results,
        resultBudgetBytes: effectiveBudget,
        originalResultBytes,
        resultBytes,
        payloadTruncatedCount,
    };
}

/**
 * Convert one protocol-neutral repository operation into an MCP result.
 *
 * @param {Awaited<ReturnType<typeof readRepositoryFile>>} operation
 * @param {string} [sizeHintSource]
 * @param {'read-file' | 'search-text' | 'tree'} [heavySummaryKind]
 * @returns {import('#copilot/mcp/public/protocol/tools').StructuredCallToolResult}
 */
function frameRepositoryReadOperation(operation, sizeHintSource, heavySummaryKind) {
    if (!operation.ok) return errorResult(operation.message, operation.details);
    const text = heavySummaryKind
        ? buildHeavyRepositoryResultSummary(heavySummaryKind, operation.structured)
        : operation.text;
    const result = okResult(operation.structured, text);
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
 * @param {'read-file' | 'search-text' | 'tree'} kind
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
    } else {
        text = `Tree ${path}: entries=${Number(structured['count'] ?? 0)}, scanned=${Number(structured['totalScanned'] ?? 0)}, blocked=${Number(structured['blockedEntriesCount'] ?? 0)}, truncated=${structured['truncated'] === true}; full tree entries are in structuredContent.entries.`;
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

/** @param {{pattern?: string | undefined; query?: string | undefined}} input */
function hasDivergentSearchAliases(input) {
    return input.pattern !== undefined && input.query !== undefined && input.pattern !== input.query;
}

/** @param {RepoReadWorkspaceCapability} workspace @param {{ path: string; includeHash?: boolean; maxHashBytes?: number }} input */
async function runRepoFileStatsCall(workspace, input) {
    return frameRepositoryReadOperation(await readRepositoryFileStats(workspace, input));
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
        description: 'List files and directories inside the workspace with depth and entry limits.',
        inputSchema: {
            path: z
                .string()
                .optional()
                ['describe'](
                    'Workspace-relative directory path. Default: src/copilot. Empty string uses the default. Use "." for workspace root.',
                ),
            recursive: z.boolean().optional()['describe']('Whether to recurse into children. Default: false.'),
            depth: z.number().int().min(1).max(8).optional()['describe']('Maximum recursion depth. Default: 2.'),
            maxEntries: z.number().int().min(1).max(2000).optional()['describe']('Maximum entries returned.'),
            showHidden: z.boolean().optional()['describe']('Include dotfiles. Default: false.'),
        },

        handler: async ({ path, recursive, depth, maxEntries, showHidden }, operationContext) =>
            frameRepositoryReadOperation(
                await readRepositoryTree(requireMcpToolWorkspace(operationContext), {
                    ...(path === undefined ? {} : { path }),
                    ...(recursive === undefined ? {} : { recursive }),
                    ...(depth === undefined ? {} : { depth }),
                    ...(maxEntries === undefined ? {} : { maxEntries }),
                    ...(showHidden === undefined ? {} : { showHidden }),
                }),
                undefined,
                'tree',
            ),
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
                const bounded = boundRepoBulkResultPayload(
                    compactRepoBulkExecution(execution),
                    batchResultBudgetBytes ?? DEFAULT_REPO_BATCH_RESULT_BUDGET_BYTES,
                );
                const structured = {
                    success: execution.failedCount === 0 && execution.skippedCount === 0,
                    batch: true,
                    executionId: execution.executionId,
                    failureMode: execution.failureMode,
                    requestCount: execution.requestCount,
                    attemptedCount: execution.attemptedCount,
                    succeededCount: execution.succeededCount,
                    failedCount: execution.failedCount,
                    skippedCount: execution.skippedCount,
                    concurrency: execution.concurrency,
                    maxInFlight: execution.maxInFlight,
                    inputBytes: execution.inputBytes,
                    durationMs: execution.durationMs,
                    resultBudgetBytes: bounded.resultBudgetBytes,
                    originalResultBytes: bounded.originalResultBytes,
                    resultBytes: bounded.resultBytes,
                    payloadTruncatedCount: bounded.payloadTruncatedCount,
                    results: bounded.results,
                };
                const text = `Read batch completed: ${execution.succeededCount}/${execution.requestCount} succeeded, ${execution.failedCount} failed, ${execution.skippedCount} skipped; payloads are in structuredContent.results.`;
                const result = withResultSizeHint(okResult(structured, text), {
                    bytes: estimateStructuredTextResultBytes(structured, text),
                    strategy: 'conservative-estimate',
                    source: 'repo_read_file.batch',
                });
                const continuation = inspectRepoBulkContinuation(bounded.results);
                return withResultExecutionHint(result, {
                    logicalOperations: execution.requestCount,
                    failedOperations: execution.failedCount,
                    skippedOperations: execution.skippedCount,
                    mode: `read-batch:${execution.failureMode}`,
                    batchSize: execution.requestCount,
                    batchCapacity: MAX_REPO_BATCH_REQUESTS,
                    resultBudgetBytes: bounded.resultBudgetBytes,
                    truncatedOperations: bounded.payloadTruncatedCount,
                    continuationAvailable: continuation.availableOperations > 0,
                    continuationAvailableOperations: continuation.availableOperations,
                    continuationTransportRequired: continuation.transportRequiredOperations > 0,
                    continuationTransportRequiredOperations: continuation.transportRequiredOperations,
                    continuationRecommended: continuation.recommendedOperations > 0,
                    continuationRecommendedOperations: continuation.recommendedOperations,
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
            const bounded = boundRepoBulkResultPayload(
                compactRepoBulkExecution(execution).map((row, index) => ({
                    ...row,
                    op:
                        operations[index] && typeof operations[index] === 'object' && 'op' in operations[index]
                            ? operations[index].op
                            : null,
                })),
                resultBudgetBytes ?? DEFAULT_REPO_BATCH_RESULT_BUDGET_BYTES,
            );
            const structured = {
                success: execution.failedCount === 0 && execution.skippedCount === 0,
                bulkInspect: true,
                executionId: execution.executionId,
                failureMode: execution.failureMode,
                requestCount: execution.requestCount,
                attemptedCount: execution.attemptedCount,
                succeededCount: execution.succeededCount,
                failedCount: execution.failedCount,
                skippedCount: execution.skippedCount,
                concurrency: execution.concurrency,
                maxInFlight: execution.maxInFlight,
                inputBytes: execution.inputBytes,
                durationMs: execution.durationMs,
                resultBudgetBytes: bounded.resultBudgetBytes,
                originalResultBytes: bounded.originalResultBytes,
                resultBytes: bounded.resultBytes,
                payloadTruncatedCount: bounded.payloadTruncatedCount,
                results: bounded.results,
            };
            const text = `Bulk inspect completed: ${execution.succeededCount}/${execution.requestCount} succeeded, ${execution.failedCount} failed, ${execution.skippedCount} skipped.`;
            const result = withResultSizeHint(okResult(structured, text), {
                bytes: estimateStructuredTextResultBytes(structured, text),
                strategy: 'conservative-estimate',
                source: 'repo_bulk_inspect',
            });
            const continuation = inspectRepoBulkContinuation(bounded.results);
            return withResultExecutionHint(result, {
                logicalOperations: execution.requestCount,
                failedOperations: execution.failedCount,
                skippedOperations: execution.skippedCount,
                mode: `bulk-inspect:${execution.failureMode}`,
                batchSize: execution.requestCount,
                batchCapacity: MAX_REPO_BATCH_REQUESTS,
                resultBudgetBytes: bounded.resultBudgetBytes,
                truncatedOperations: bounded.payloadTruncatedCount,
                continuationAvailable: continuation.availableOperations > 0,
                continuationAvailableOperations: continuation.availableOperations,
                continuationTransportRequired: continuation.transportRequiredOperations > 0,
                continuationTransportRequiredOperations: continuation.transportRequiredOperations,
                continuationRecommended: continuation.recommendedOperations > 0,
                continuationRecommendedOperations: continuation.recommendedOperations,
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
            chunkLines: z.number().int().min(1).max(1000).optional()['describe']('Lines per chunk. Default: 200.'),
            cursor: z.string().optional()['describe']('Next-line cursor returned by a previous call.'),
            highWaterMark: z
                .number()
                .int()
                .min(1024)
                .max(16 * 1024 * 1024)
                .optional()
                ['describe']('Optional stream highWaterMark in bytes.'),
        },

        handler: async ({ path, startLine, endLine, chunkLines, cursor, highWaterMark }, operationContext) =>
            frameRepositoryReadOperation(
                await readRepositoryFileChunks(
                    requireMcpToolWorkspace(operationContext),
                    {
                        path,
                        ...(startLine === undefined ? {} : { startLine }),
                        ...(endLine === undefined ? {} : { endLine }),
                        ...(chunkLines === undefined ? {} : { chunkLines }),
                        ...(cursor === undefined ? {} : { cursor }),
                        ...(highWaterMark === undefined ? {} : { highWaterMark }),
                    },
                    requireMcpToolRepositoryReadCacheConfig(operationContext),
                ),
                'repo_read_file_chunks',
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
                const bounded = boundRepoBulkResultPayload(
                    compactRepoBulkExecution(execution),
                    batchResultBudgetBytes ?? DEFAULT_REPO_BATCH_RESULT_BUDGET_BYTES,
                );
                const structured = {
                    success: execution.failedCount === 0 && execution.skippedCount === 0,
                    batch: true,
                    executionId: execution.executionId,
                    failureMode: execution.failureMode,
                    requestCount: execution.requestCount,
                    attemptedCount: execution.attemptedCount,
                    succeededCount: execution.succeededCount,
                    failedCount: execution.failedCount,
                    skippedCount: execution.skippedCount,
                    concurrency: execution.concurrency,
                    maxInFlight: execution.maxInFlight,
                    inputBytes: execution.inputBytes,
                    durationMs: execution.durationMs,
                    resultBudgetBytes: bounded.resultBudgetBytes,
                    originalResultBytes: bounded.originalResultBytes,
                    resultBytes: bounded.resultBytes,
                    payloadTruncatedCount: bounded.payloadTruncatedCount,
                    results: bounded.results,
                };
                const text = `Search batch completed: ${execution.succeededCount}/${execution.requestCount} succeeded, ${execution.failedCount} failed, ${execution.skippedCount} skipped; outputs are in structuredContent.results.`;
                const result = withResultSizeHint(okResult(structured, text), {
                    bytes: estimateStructuredTextResultBytes(structured, text),
                    strategy: 'conservative-estimate',
                    source: 'repo_search_text.batch',
                });
                const continuation = inspectRepoBulkContinuation(bounded.results);
                return withResultExecutionHint(result, {
                    logicalOperations: execution.requestCount,
                    failedOperations: execution.failedCount,
                    skippedOperations: execution.skippedCount,
                    mode: `search-batch:${execution.failureMode}`,
                    batchSize: execution.requestCount,
                    batchCapacity: MAX_REPO_BATCH_REQUESTS,
                    resultBudgetBytes: bounded.resultBudgetBytes,
                    truncatedOperations: bounded.payloadTruncatedCount,
                    continuationAvailable: continuation.availableOperations > 0,
                    continuationAvailableOperations: continuation.availableOperations,
                    continuationTransportRequired: continuation.transportRequiredOperations > 0,
                    continuationTransportRequiredOperations: continuation.transportRequiredOperations,
                    continuationRecommended: continuation.recommendedOperations > 0,
                    continuationRecommendedOperations: continuation.recommendedOperations,
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
            'Parse a workspace file and return symbols, imports, exports, outline and optional top comments for navigation.',
        inputSchema: {
            path: z.string().min(1)['describe']('Workspace-relative file path.'),
            includeImports: z.boolean().optional()['describe']('Include imports. Default: true.'),
            includeExports: z.boolean().optional()['describe']('Include exports. Default: true.'),
            includeOutline: z.boolean().optional()['describe']('Include textual outline. Default: true.'),
            includeTopComments: z.boolean().optional()['describe']('Include top comments. Default: false.'),
            maxItems: z
                .number()
                .int()
                .min(1)
                .max(5_000)
                .optional()
                ['describe']('Maximum items returned per collection.'),
            maxBytes: z
                .number()
                .int()
                .min(1)
                .max(4 * 1024 * 1024)
                .optional()
                ['describe']('Total UTF-8 budget for returned collections. Default: 524288.'),
        },

        handler: async (
            { path, includeImports, includeExports, includeOutline, includeTopComments, maxItems, maxBytes },
            operationContext,
        ) =>
            frameRepositoryReadOperation(
                await readRepositoryFileOutline(requireMcpToolWorkspace(operationContext), {
                    path,
                    ...(includeImports === undefined ? {} : { includeImports }),
                    ...(includeExports === undefined ? {} : { includeExports }),
                    ...(includeOutline === undefined ? {} : { includeOutline }),
                    ...(includeTopComments === undefined ? {} : { includeTopComments }),
                    ...(maxItems === undefined ? {} : { maxItems }),
                    ...(maxBytes === undefined ? {} : { maxBytes }),
                }),
            ),
    }),
];
