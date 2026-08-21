// @ts-check
/**
 * Workspace read-only MCP tools.
 *
 * @module copilot/mcp/tools/repo-read
 */

import { DEFAULT_BLOCKED_PATH_SEGMENTS } from '#copilot/core';
import { runBoundedOperationBatch } from '#copilot/infra/public/concurrency/bulk';
import { windowFileContext } from '#copilot/infra/public/indexing/file-context';
import { truncateUtf8String } from '#copilot/infra/public/platform/buffer';
import {
    MCP_TOOL_EXECUTION_LIMITS,
    errorResult,
    estimateStructuredTextResultBytes,
    getMcpWorkspaceIndexing,
    getMcpWorkspaceIo,
    getMcpWorkspaceRoot,
    okResult,
    readOnlyAnnotations,
    resolveValidatedReadPath,
    withResultExecutionHint,
    withResultSizeHint,
} from '#copilot/mcp/control-plane';
import { WORKSPACE_ROOT } from '#copilot/tools';
import { z } from 'zod';
import { readRepoFileChunksWithValidatedResultCache, readRepoFileWithValidatedResultCache } from './repo-read-cache.js';
import { repoStatusHandler } from './repo-status.js';

const { diffTextValidated, readBytesValidated, readTextValidated, statPathValidated } = getMcpWorkspaceIo();
const { parseFileForContext, scanDirectoryValidated, searchTextValidated, searchWorkspaceSymbolsValidated } =
    getMcpWorkspaceIndexing();

const DEFAULT_REPO_READ_PATH = 'src/copilot';
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
 * @param {import('#copilot/mcp/control-plane').StructuredCallToolResult} result
 */
function compactBatchCallResult(index, result) {
    return {
        index,
        isError: result.isError === true,
        ...(result.structuredContent ?? {}),
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
 *             import('#copilot/mcp/control-plane').StructuredCallToolResult
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
 * @param {string} value
 * @returns {string}
 */
function escapeForRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * @param {string} output
 * @param {string} defaultFile
 * @returns {{ matches: { file: string; line: number; text: string }[]; fileCount: number }}
 */
function parseUsageOutput(output, defaultFile) {
    /** @type {{ file: string; line: number; text: string }[]} */
    const matches = [];
    const files = new Set();
    const root = WORKSPACE_ROOT.endsWith('/') ? WORKSPACE_ROOT : `${WORKSPACE_ROOT}/`;
    for (const rawLine of output.split('\n')) {
        if (!rawLine.trim() || rawLine === '--') continue;
        const matchedWithFile = rawLine.match(/^(.+?):(\d+):(.*)$/u);
        const matchedWithoutFile = matchedWithFile ? null : rawLine.match(/^(\d+):(.*)$/u);
        if (!matchedWithFile && !matchedWithoutFile) continue;
        const filePath = matchedWithFile?.[1] ?? defaultFile;
        const lineText = matchedWithFile?.[2] ?? matchedWithoutFile?.[1];
        const text = matchedWithFile?.[3] ?? matchedWithoutFile?.[2] ?? '';
        if (!filePath || !lineText) continue;
        const file = filePath.startsWith(root) ? filePath.slice(root.length) : filePath;
        files.add(file);
        matches.push({ file, line: Number(lineText), text: text.trimEnd() });
    }
    return { matches, fileCount: files.size };
}

/**
 * @param {{ file: string; line: number; text: string }[]} matches
 * @returns {string}
 */
function formatUsageMatches(matches) {
    return matches.map((match) => `${match.file}:${match.line}: ${match.text}`.trimEnd()).join('\n');
}

/**
 * @param {{ type: string }[]} entries
 * @returns {{ files: number; directories: number; symlinks: number; other: number }}
 */
function countEntryTypes(entries) {
    const counts = { files: 0, directories: 0, symlinks: 0, other: 0 };
    for (const entry of entries) {
        if (entry.type === 'file') counts.files += 1;
        else if (entry.type === 'directory') counts.directories += 1;
        else if (entry.type === 'symlink') counts.symlinks += 1;
        else counts.other += 1;
    }
    return counts;
}

/**
 * @param {{ io?: { advisoryLimits?: Record<string, unknown> } }} scan
 * @returns {boolean}
 */
function scanHardLimitReached(scan) {
    return scan.io?.advisoryLimits?.['hardLimitReached'] === true;
}

/**
 * @param {Record<string, unknown>} structured
 * @param {'full' | 'returned' | 'none'} hashMode
 * @returns {Record<string, unknown>}
 */
export function applyRepoReadHashMode(structured, hashMode) {
    if (hashMode === 'full') return structured;
    const output = { ...structured, hashMode };
    Reflect.deleteProperty(output, 'sha256');
    if (hashMode === 'none') Reflect.deleteProperty(output, 'returnedSha256');
    return output;
}

/**
 * @param {{
 *     path?: string | undefined;
 *     startLine?: number | undefined;
 *     endLine?: number | undefined;
 *     hashMode?: 'full' | 'returned' | 'none' | undefined;
 * }} input
 */
async function runRepoReadFileCall(input) {
    const resolved = await resolveValidatedReadPath(input.path ?? '');
    if (!resolved.ok) return errorResult(resolved.reason, resolved);
    if (input.startLine !== undefined && input.endLine !== undefined && input.endLine < input.startLine) {
        return errorResult('endLine must be greater than or equal to startLine.', {
            code: 'ERR_INVALID_LINE_RANGE',
            hint: 'Use endLine greater than or equal to startLine, or omit endLine.',
        });
    }
    const effectiveHashMode = input.hashMode ?? 'full';
    const { structured, text } = await readRepoFileWithValidatedResultCache(
        resolved,
        input.startLine,
        input.endLine,
        effectiveHashMode,
    );
    const outputStructured = applyRepoReadHashMode(structured, effectiveHashMode);
    return withResultSizeHint(okResult(outputStructured, text), {
        bytes: estimateStructuredTextResultBytes(outputStructured, text),
        strategy: 'conservative-estimate',
        source: 'repo_read_file',
    });
}

/**
 * @param {{
 *     pattern?: string | undefined;
 *     query?: string | undefined;
 *     path?: string | undefined;
 *     isRegex?: boolean | undefined;
 *     caseSensitive?: boolean | undefined;
 *     includePattern?: string | undefined;
 *     excludePattern?: string | undefined;
 *     contextLines?: number | undefined;
 *     maxResults?: number | undefined;
 *     cursor?: string | undefined;
 * }} input
 */
async function runRepoSearchTextCall(input) {
    const effectivePattern = input.pattern ?? input.query;
    if (!effectivePattern) {
        return errorResult('Search pattern is required.', {
            code: 'ERR_SEARCH_PATTERN_REQUIRED',
            hint: 'Provide pattern or query.',
        });
    }
    const resolved = await resolveValidatedReadPath(normalizeOptionalRepoPath(input.path, DEFAULT_REPO_READ_PATH));
    if (!resolved.ok) return errorResult(resolved.reason, resolved);
    const result = await searchTextValidated(resolved.validatedReadPath, {
        workspaceRoot: WORKSPACE_ROOT,
        pattern: effectivePattern,
        isRegex: input.isRegex === true,
        caseSensitive: input.caseSensitive === true,
        ...(input.includePattern === undefined ? {} : { includePattern: input.includePattern }),
        ...(input.excludePattern === undefined ? {} : { excludePattern: input.excludePattern }),
        ...(input.maxResults === undefined ? {} : { maxResults: input.maxResults }),
        contextLines: input.contextLines ?? 0,
        ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
    });
    const targetStat = await statPathValidated(resolved.validatedReadPath);
    const targetStats = targetStat.stats;
    const targetIsFile = targetStats.isFile();
    const targetHashBytes =
        targetIsFile && targetStats.size <= 5 * 1024 * 1024
            ? await readBytesValidated(resolved.validatedReadPath)
            : null;
    const structured = {
        success: true,
        path: resolved.relative,
        searchTargetMetadata: targetIsFile
            ? {
                  type: 'file',
                  sizeBytes: targetStats.size,
                  sha256: targetHashBytes?.contentHash ?? null,
                  hashComputed: Boolean(targetHashBytes),
              }
            : { type: targetStats.isDirectory() ? 'directory' : 'other' },
        pattern: effectivePattern,
        query: input.query ?? null,
        contextLines: input.contextLines ?? 0,
        cursor: input.cursor ?? null,
        output: result.output,
        matchCount: result.matchCount,
        returnedMatchCount: result.returnedMatchCount ?? result.matchCount,
        returnedLineCount: result.returnedLineCount ?? (result.output ? result.output.split('\n').length : 0),
        totalMatches: result.totalMatches ?? result.matchCount,
        totalMatchCount: result.totalMatchCount ?? result.totalMatches ?? result.matchCount,
        totalLineCount: result.totalLineCount ?? null,
        countsPostSanitization: result.countsPostSanitization,
        truncated: result.truncated,
        nextCursor: result.nextCursor ?? null,
        cursorOffset: result.cursorOffset ?? 0,
        engine: result.engine,
    };
    return withResultSizeHint(okResult(structured, result.output), {
        bytes: estimateStructuredTextResultBytes(structured, result.output),
        strategy: 'conservative-estimate',
        source: 'repo_search_text',
    });
}

/** @param {{ path: string; includeHash?: boolean; maxHashBytes?: number }} input */
async function runRepoFileStatsCall(input) {
    const resolved = await resolveValidatedReadPath(input.path);
    if (!resolved.ok) return errorResult(resolved.reason, resolved);
    const statSnapshot = await statPathValidated(resolved.validatedReadPath);
    const stats = statSnapshot.stats;
    const isFile = stats.isFile();
    const effectiveMaxHashBytes = input.maxHashBytes ?? 5 * 1024 * 1024;
    const shouldHash = input.includeHash === true && isFile && stats.size <= effectiveMaxHashBytes;
    const bytes = shouldHash ? await readBytesValidated(resolved.validatedReadPath) : null;
    return okResult({
        success: true,
        path: resolved.relative,
        absolutePath: resolved.resolved,
        type: stats.isDirectory() ? 'directory' : isFile ? 'file' : 'other',
        sizeBytes: stats.size,
        mtimeMs: stats.mtimeMs,
        ctimeMs: stats.ctimeMs,
        birthtimeMs: stats.birthtimeMs,
        mtimeIso: stats.mtime.toISOString(),
        ctimeIso: stats.ctime.toISOString(),
        birthtimeIso: stats.birthtime.toISOString(),
        sha256: bytes?.contentHash ?? null,
        hashComputed: Boolean(bytes),
        hashSkippedReason: shouldHash
            ? null
            : input.includeHash === true && !isFile
              ? 'not-a-file'
              : input.includeHash === true && stats.size > effectiveMaxHashBytes
                ? 'file-too-large'
                : 'hash-not-requested',
        maxHashBytes: effectiveMaxHashBytes,
        engine: bytes?.io.engine ?? statSnapshot.io.engine,
    });
}

/**
 * @type {import('../registry.js').McpToolDefinition[]}
 */
export const repoReadTools = [
    {
        name: 'repo_status',
        title: 'Repository status',
        description: 'Return workspace root, current branch, HEAD and short Git status.',
        inputSchema: {},
        annotations: readOnlyAnnotations(),
        handler: repoStatusHandler,
    },
    {
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
        annotations: readOnlyAnnotations(),
        handler: async ({ path, recursive, depth, maxEntries, showHidden }) => {
            const resolved = await resolveValidatedReadPath(normalizeOptionalRepoPath(path, DEFAULT_REPO_READ_PATH));
            if (!resolved.ok) return errorResult(resolved.reason, resolved);
            const effectiveMaxEntries = maxEntries ?? 2000;
            const scan = await scanDirectoryValidated(resolved.validatedReadPath, {
                workspaceRoot: WORKSPACE_ROOT,
                recursive: recursive === true,
                depth: depth ?? 2,
                showHidden: showHidden === true,
                maxEntries: effectiveMaxEntries,
                fingerprint: false,
                respectGitignore: recursive === true,
            });
            const entries = scan.entries.slice(0, effectiveMaxEntries);
            const structured = {
                success: true,
                workspaceRoot: getMcpWorkspaceRoot(),
                path: resolved.relative,
                count: entries.length,
                totalScanned: scan.scannedEntries,
                blockedEntriesCount: scan.blockedEntries,
                truncated: entries.length < scan.entries.length || scanHardLimitReached(scan),
                securityPolicy: {
                    readProtectedPaths: 'blocked',
                    listProtectedPaths: 'redacted',
                    writeProtectedPaths: 'blocked',
                },
                entries,
            };
            return okResult(structured);
        },
    },
    {
        name: 'repo_root_tree',
        title: 'Repository root tree',
        description: 'List files and directories at the real workspace root. Equivalent to repo_tree with path=".".',
        inputSchema: {
            recursive: z.boolean().optional()['describe']('Whether to recurse into children. Default: false.'),
            depth: z.number().int().min(1).max(8).optional()['describe']('Maximum recursion depth. Default: 2.'),
            maxEntries: z.number().int().min(1).max(2000).optional()['describe']('Maximum entries returned.'),
            showHidden: z.boolean().optional()['describe']('Include dotfiles. Default: false.'),
        },
        annotations: readOnlyAnnotations(),
        handler: async ({ recursive, depth, maxEntries, showHidden }) => {
            const resolved = await resolveValidatedReadPath('.');
            if (!resolved.ok) return errorResult(resolved.reason, resolved);
            const effectiveMaxEntries = maxEntries ?? 2000;
            const scan = await scanDirectoryValidated(resolved.validatedReadPath, {
                workspaceRoot: WORKSPACE_ROOT,
                recursive: recursive === true,
                depth: depth ?? 2,
                showHidden: showHidden === true,
                maxEntries: effectiveMaxEntries,
                fingerprint: false,
                respectGitignore: recursive === true,
            });
            const entries = scan.entries.slice(0, effectiveMaxEntries);
            return okResult({
                success: true,
                workspaceRoot: getMcpWorkspaceRoot(),
                path: resolved.relative,
                count: entries.length,
                totalScanned: scan.scannedEntries,
                blockedEntriesCount: scan.blockedEntries,
                truncated: entries.length < scan.entries.length || scanHardLimitReached(scan),
                securityPolicy: {
                    readProtectedPaths: 'blocked',
                    listProtectedPaths: 'redacted',
                    writeProtectedPaths: 'blocked',
                },
                entries,
            });
        },
    },
    {
        name: 'repo_root_redaction_status',
        title: 'Repository root redaction status',
        description:
            'Return root listing redaction and hidden/protected-path aggregate counts without exposing hidden or protected entry names.',
        inputSchema: {},
        annotations: readOnlyAnnotations(),
        handler: async () => {
            const resolved = await resolveValidatedReadPath('.');
            if (!resolved.ok) return errorResult(resolved.reason, resolved);
            const visibleScan = await scanDirectoryValidated(resolved.validatedReadPath, {
                workspaceRoot: WORKSPACE_ROOT,
                recursive: false,
                depth: 1,
                showHidden: false,
            });
            const aggregateScan = await scanDirectoryValidated(resolved.validatedReadPath, {
                workspaceRoot: WORKSPACE_ROOT,
                recursive: false,
                depth: 1,
                showHidden: true,
                respectDenylist: false,
                redactProtectedPaths: true,
                fingerprint: false,
            });
            const hiddenInspectableCount = aggregateScan.entries.filter((entry) => entry.name.startsWith('.')).length;
            return okResult({
                success: true,
                workspaceRoot: getMcpWorkspaceRoot(),
                path: resolved.relative,
                policy: {
                    hiddenNamesReturned: false,
                    protectedNamesReturned: false,
                    rootTreeDefaultShowHidden: false,
                    listProtectedPaths: 'redacted',
                    readProtectedPaths: 'blocked',
                    writeProtectedPaths: 'blocked',
                    protectedSegmentCount: DEFAULT_BLOCKED_PATH_SEGMENTS.length,
                },
                visibleTopLevelCount: visibleScan.entries.length,
                visibleTypeCounts: countEntryTypes(visibleScan.entries),
                hiddenInspectableTopLevelCount: hiddenInspectableCount,
                protectedOrRedactedTopLevelCount: aggregateScan.blockedEntries,
                aggregateInspectableTopLevelCount: aggregateScan.entries.length,
                aggregateTypeCounts: countEntryTypes(aggregateScan.entries),
                totalScannedVisible: visibleScan.scannedEntries,
                totalScannedAggregate: aggregateScan.scannedEntries,
                hint: 'Use repo_root_tree without showHidden for names. Use this status tool for hidden/protected aggregate auditing.',
            });
        },
    },
    {
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
        annotations: readOnlyAnnotations(),
        handler: async ({
            path,
            startLine,
            endLine,
            hashMode,
            batch,
            batchFailureMode,
            batchConcurrency,
            batchResultBudgetBytes,
        }) => {
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
                        return runRepoReadFileCall(parsed.data);
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
                return withResultExecutionHint(result, {
                    logicalOperations: execution.requestCount,
                    failedOperations: execution.failedCount,
                    skippedOperations: execution.skippedCount,
                    mode: `read-batch:${execution.failureMode}`,
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
            return runRepoReadFileCall({ path, startLine, endLine, hashMode });
        },
    },
    {
        name: 'repo_file_stats',
        title: 'Repository file stats',
        description:
            'Return filesystem metadata for a workspace file or directory, with optional SHA-256 for safe follow-up reads/writes.',
        inputSchema: {
            path: z.string().min(1)['describe']('Workspace-relative file or directory path.'),
            includeHash: z
                .boolean()
                .optional()
                ['describe']('If true, compute SHA-256 for files within maxHashBytes. Default: false.'),
            maxHashBytes: z
                .number()
                .int()
                .min(1)
                .max(25 * 1024 * 1024)
                .optional()
                ['describe']('Maximum file size eligible for hashing. Default: 5 MiB.'),
        },
        annotations: readOnlyAnnotations(),
        handler: async ({ path, includeHash, maxHashBytes }) =>
            runRepoFileStatsCall({ path, includeHash, maxHashBytes }),
    },
    {
        name: 'repo_bulk_inspect',
        title: 'Bulk repository inspect',
        description:
            'Mix up to 64 read, search and stat operations in one bounded read-only call with per-item failure isolation.',
        inputSchema: {
            operations: z
                .array(repoBulkInspectItemSchema)
                .min(1)
                .max(MAX_REPO_BATCH_REQUESTS)
                ['describe']('Ordered heterogeneous operations using {op: read|search|stat, args: {...}}.'),
            failureMode: z.enum(['best-effort', 'fail-fast']).optional()['describe']('Default: best-effort.'),
            concurrency: z
                .number()
                .int()
                .min(1)
                .max(MAX_REPO_BATCH_CONCURRENCY)
                .optional()
                ['describe']('Maximum independent operations in flight. Default: 6, hard max: 8.'),
            resultBudgetBytes: z
                .number()
                .int()
                .min(MIN_REPO_BATCH_RESULT_BUDGET_BYTES)
                .max(MAX_REPO_BATCH_RESULT_BUDGET_BYTES)
                .optional()
                ['describe']('Aggregate structured result budget. Default 2 MiB; hard max 3 MiB.'),
        },
        annotations: readOnlyAnnotations(),
        handler: async ({ operations, failureMode, concurrency, resultBudgetBytes }) => {
            const execution = await runBoundedOperationBatch(
                /** @type {Record<string, unknown>[]} */ (operations),
                async (raw, index) => {
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
                            ? runRepoReadFileCall(parsed.data)
                            : errorResult(`Invalid read args at repo_bulk_inspect index ${index}.`, {
                                  code: 'ERR_BULK_INSPECT_INVALID_READ',
                                  index,
                              });
                    }
                    if (op === 'search') {
                        const parsed = repoSearchBatchItemSchema.safeParse(args);
                        return parsed.success && (parsed.data.pattern || parsed.data.query)
                            ? runRepoSearchTextCall(parsed.data)
                            : errorResult(`Invalid search args at repo_bulk_inspect index ${index}.`, {
                                  code: 'ERR_BULK_INSPECT_INVALID_SEARCH',
                                  index,
                              });
                    }
                    const parsed = repoStatBatchItemSchema.safeParse(args);
                    return parsed.success
                        ? runRepoFileStatsCall({
                              path: parsed.data.path,
                              ...(parsed.data.includeHash === undefined
                                  ? {}
                                  : { includeHash: parsed.data.includeHash }),
                              ...(parsed.data.maxHashBytes === undefined
                                  ? {}
                                  : { maxHashBytes: parsed.data.maxHashBytes }),
                          })
                        : errorResult(`Invalid stat args at repo_bulk_inspect index ${index}.`, {
                              code: 'ERR_BULK_INSPECT_INVALID_STAT',
                              index,
                          });
                },
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
            return withResultExecutionHint(result, {
                logicalOperations: execution.requestCount,
                failedOperations: execution.failedCount,
                skippedOperations: execution.skippedCount,
                mode: `bulk-inspect:${execution.failureMode}`,
            });
        },
    },
    {
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
        annotations: readOnlyAnnotations(),
        handler: async ({ path, startLine, endLine, chunkLines, cursor, highWaterMark }) => {
            const resolved = await resolveValidatedReadPath(path);
            if (!resolved.ok) return errorResult(resolved.reason, resolved);
            const parsedCursorLine = cursor !== undefined ? Number.parseInt(cursor, 10) : null;
            if (parsedCursorLine !== null && (!Number.isFinite(parsedCursorLine) || parsedCursorLine < 1)) {
                return errorResult('cursor must be a positive line number string.', {
                    code: 'ERR_INVALID_CURSOR',
                    hint: 'Pass the nextCursor returned by repo_read_file_chunks, or omit cursor.',
                });
            }
            const effectiveStartLine = parsedCursorLine ?? startLine ?? 1;
            if (endLine !== undefined && endLine < effectiveStartLine) {
                return errorResult('endLine must be greater than or equal to the effective start line.', {
                    code: 'ERR_INVALID_LINE_RANGE',
                    hint: 'Use endLine greater than or equal to cursor/startLine, or omit endLine.',
                });
            }
            const { structured, text } = await readRepoFileChunksWithValidatedResultCache(
                resolved,
                effectiveStartLine,
                endLine,
                chunkLines ?? 200,
                highWaterMark,
                cursor,
            );
            return withResultSizeHint(okResult(structured, text), {
                bytes: estimateStructuredTextResultBytes(structured, text),
                strategy: 'conservative-estimate',
                source: 'repo_read_file_chunks',
            });
        },
    },
    {
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
        annotations: readOnlyAnnotations(),
        handler: async ({ pathA, pathB, contextLines, includeDiffPreview }) => {
            const resolvedA = await resolveValidatedReadPath(pathA);
            if (!resolvedA.ok) return errorResult(`pathA: ${resolvedA.reason}`, { ...resolvedA, field: 'pathA' });
            const resolvedB = await resolveValidatedReadPath(pathB);
            if (!resolvedB.ok) return errorResult(`pathB: ${resolvedB.reason}`, { ...resolvedB, field: 'pathB' });
            const diff = await diffTextValidated(resolvedA.validatedReadPath, resolvedB.validatedReadPath, {
                contextLines: contextLines ?? 3,
            });
            return okResult(
                {
                    success: true,
                    pathA: resolvedA.relative,
                    pathB: resolvedB.relative,
                    identical: diff.identical,
                    diffPreviewSuppressed: includeDiffPreview !== true,
                    diffPreviewAvailable: !diff.identical,
                    ...(includeDiffPreview === true ? { diff: diff.diff } : {}),
                    engine: diff.io.engine,
                    contextLines: contextLines ?? 3,
                },
                includeDiffPreview === true ? diff.diff : 'Diff computed; textual diff suppressed.',
            );
        },
    },
    {
        name: 'repo_search_text',
        title: 'Search repository text',
        description: 'Search text or regex inside the workspace and return matching lines.',
        inputSchema: {
            pattern: z.string().min(1).optional()['describe']('Text or regex pattern to search.'),
            query: z
                .string()
                .min(1)
                .optional()
                ['describe']('Alias for pattern; useful for clients that call search inputs query.'),
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
        annotations: readOnlyAnnotations(),
        handler: async ({
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
        }) => {
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
                        return runRepoSearchTextCall(parsed.data);
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
                return withResultExecutionHint(result, {
                    logicalOperations: execution.requestCount,
                    failedOperations: execution.failedCount,
                    skippedOperations: execution.skippedCount,
                    mode: `search-batch:${execution.failureMode}`,
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
            return runRepoSearchTextCall({
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
    },
    {
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
        annotations: readOnlyAnnotations(),
        handler: async ({
            symbol,
            path,
            includePattern,
            excludePattern,
            wholeWord,
            caseSensitive,
            maxResults,
            cursor,
        }) => {
            const resolved = await resolveValidatedReadPath(normalizeOptionalRepoPath(path, DEFAULT_REPO_READ_PATH));
            if (!resolved.ok) return errorResult(resolved.reason, resolved);
            const escaped = escapeForRegex(symbol);
            const pattern = wholeWord !== false ? `\\b${escaped}\\b` : escaped;
            const result = await searchTextValidated(resolved.validatedReadPath, {
                workspaceRoot: WORKSPACE_ROOT,
                pattern,
                isRegex: true,
                caseSensitive: caseSensitive !== false,
                includePattern: includePattern ?? '*.{js,ts,mjs,cjs}',
                excludePattern,
                contextLines: 0,
                maxResults,
                cursor,
            });
            const parsed = parseUsageOutput(result.output, resolved.relative);
            const output = formatUsageMatches(parsed.matches);
            return okResult(
                {
                    success: true,
                    symbol,
                    path: resolved.relative,
                    output,
                    matchCount: parsed.matches.length,
                    fileCount: parsed.fileCount,
                    matches: parsed.matches,
                    totalMatches: result.totalMatches ?? result.matchCount,
                    totalMatchCount: result.totalMatchCount ?? result.totalMatches ?? result.matchCount,
                    countsPostSanitization: result.countsPostSanitization,
                    truncated: Boolean(result.truncated),
                    nextCursor: result.nextCursor ?? null,
                    cursorOffset: result.cursorOffset ?? 0,
                    engine: result.engine,
                },
                output,
            );
        },
    },
    {
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
        annotations: readOnlyAnnotations(),
        handler: async ({ name, kind, path, includePattern, caseSensitive, exactMatch, maxResults, cursor }) => {
            const resolved = await resolveValidatedReadPath(normalizeOptionalRepoPath(path, DEFAULT_REPO_READ_PATH));
            if (!resolved.ok) return errorResult(resolved.reason, resolved);
            const result = await searchWorkspaceSymbolsValidated(resolved.validatedReadPath, {
                symbolName: name,
                kind: kind ?? 'all',
                includePattern,
                caseSensitive: caseSensitive === true,
                exactMatch: exactMatch === true,
                maxResults,
                cursor,
            });
            return okResult(
                {
                    success: true,
                    path: resolved.relative,
                    symbol: name,
                    kind: kind ?? 'all',
                    output: result.output,
                    matchCount: result.matchCount,
                    totalMatches: result.totalMatches ?? result.matchCount,
                    countsPostSanitization: result.countsPostSanitization,
                    truncated: Boolean(result.truncated),
                    nextCursor: result.nextCursor ?? null,
                    cursorOffset: result.cursorOffset ?? 0,
                    engine: result.engine,
                },
                result.output,
            );
        },
    },
    {
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
        annotations: readOnlyAnnotations(),
        handler: async ({
            path,
            includeImports,
            includeExports,
            includeOutline,
            includeTopComments,
            maxItems,
            maxBytes,
        }) => {
            const resolved = await resolveValidatedReadPath(path);
            if (!resolved.ok) return errorResult(resolved.reason, resolved);
            const snapshot = await readTextValidated(resolved.validatedReadPath);
            const parsed = await parseFileForContext(resolved.resolved, snapshot.content, {
                ...(typeof snapshot.contentHash === 'string' ? { contentHash: snapshot.contentHash } : {}),
            });
            const windowed = windowFileContext(parsed, {
                maxItems,
                maxBytes,
                includeImports: includeImports !== false,
                includeExports: includeExports !== false,
                includeOutline: includeOutline !== false,
                includeTopComments: includeTopComments === true,
            });
            const structured = {
                success: true,
                path: resolved.relative,
                sha256: snapshot.contentHash,
                symbols: windowed.symbols,
                parseError: parsed.symbols.parseError ?? null,
                truncated: windowed.truncated,
                maxItems: windowed.maxItems,
                maxBytes: windowed.maxBytes,
                returnedContentBytes: windowed.returnedContentBytes,
                totalCounts: windowed.totalCounts,
                returnedCounts: windowed.returnedCounts,
                ...(includeImports !== false ? { imports: windowed.imports } : {}),
                ...(includeExports !== false ? { exports: windowed.exports } : {}),
                ...(includeOutline !== false ? { outline: windowed.outline } : {}),
                ...(includeTopComments === true ? { topComments: windowed.topComments } : {}),
            };
            const text = Array.isArray(structured.outline) ? structured.outline.join('\n') : '';
            return okResult(structured, text);
        },
    },
];
