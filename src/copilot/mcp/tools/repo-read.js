// @ts-check
/**
 * Workspace read-only MCP tools.
 *
 * @module copilot/mcp/tools/repo-read
 */

import { DEFAULT_BLOCKED_PATH_SEGMENTS } from '#copilot/core';
import { parseFileForContext } from '#copilot/infra';
import {
    diffText,
    readBytes,
    readText,
    readTextChunks,
    scanDirectory,
    searchText,
    searchWorkspaceSymbols,
    statPath,
} from '#copilot/infra/public/io';
import { WORKSPACE_ROOT } from '#copilot/tools';
import { z } from 'zod';
import {
    errorResult,
    getMcpWorkspaceRoot,
    okResult,
    readOnlyAnnotations,
    resolveReadPath,
} from '#copilot/mcp/control-plane';
import { repoStatusHandler } from './repo-status.js';

const DEFAULT_REPO_READ_PATH = 'src/copilot';
const REPO_READ_FILE_CACHE_MAX_ENTRIES = 128;

/** @type {Map<string, { sizeBytes: number; mtimeMs: number; structured: Record<string, unknown>; text: string }>} */
const repoReadFileResultCache = new Map();

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
 * @param {{ resolved: string; relative: string }} resolved
 * @param {number | undefined} startLine
 * @param {number | undefined} endLine
 * @returns {Promise<{ structured: Record<string, unknown>; text: string }>}
 */
async function readRepoFileWithValidatedResultCache(resolved, startLine, endLine) {
    const key = buildRepoReadFileCacheKey(resolved.resolved, startLine, endLine);
    const cached = repoReadFileResultCache.get(key);
    if (cached) {
        const current = await statPath(resolved.resolved).catch(() => null);
        const stats = current?.stats;
        if (stats?.isFile() && stats.size === cached.sizeBytes && stats.mtimeMs === cached.mtimeMs) {
            repoReadFileResultCache.delete(key);
            repoReadFileResultCache.set(key, cached);
            return { structured: cloneStructuredReadFileResult(cached.structured), text: cached.text };
        }
        repoReadFileResultCache.delete(key);
    }

    const snapshot = await readText(resolved.resolved, {
        ...(startLine !== undefined ? { startLine } : {}),
        ...(endLine !== undefined ? { endLine } : {}),
    });
    const structured = {
        success: true,
        path: resolved.relative,
        content: snapshot.content,
        sha256: snapshot.contentHash,
        returnedSha256: snapshot.returnedContentHash,
        bytes: snapshot.bytesRead,
        totalLines: snapshot.totalLines,
        returnedLines: snapshot.returnedLines,
    };
    const sizeBytes = Number(snapshot.sizeBytes ?? snapshot.bytesRead);
    const mtimeMs = Number(snapshot.mtimeMs);
    if (Number.isFinite(sizeBytes) && Number.isFinite(mtimeMs)) {
        rememberRepoReadFileCacheEntry(key, {
            sizeBytes,
            mtimeMs,
            structured,
            text: snapshot.content,
        });
    }
    return { structured, text: snapshot.content };
}

/**
 * @param {string} absolutePath
 * @param {number | undefined} startLine
 * @param {number | undefined} endLine
 * @returns {string}
 */
function buildRepoReadFileCacheKey(absolutePath, startLine, endLine) {
    return `${absolutePath}\u0000${startLine ?? ''}\u0000${endLine ?? ''}`;
}

/**
 * @param {string} key
 * @param {{ sizeBytes: number; mtimeMs: number; structured: Record<string, unknown>; text: string }} entry
 * @returns {void}
 */
function rememberRepoReadFileCacheEntry(key, entry) {
    if (repoReadFileResultCache.has(key)) repoReadFileResultCache.delete(key);
    repoReadFileResultCache.set(key, entry);
    while (repoReadFileResultCache.size > REPO_READ_FILE_CACHE_MAX_ENTRIES) {
        const oldest = repoReadFileResultCache.keys().next().value;
        if (typeof oldest !== 'string') break;
        repoReadFileResultCache.delete(oldest);
    }
}

/**
 * @param {Record<string, unknown>} structured
 * @returns {Record<string, unknown>}
 */
function cloneStructuredReadFileResult(structured) {
    const returnedLines = structured['returnedLines'];
    return {
        ...structured,
        returnedLines:
            returnedLines && typeof returnedLines === 'object' && !Array.isArray(returnedLines)
                ? { .../** @type {Record<string, unknown>} */ (returnedLines) }
                : returnedLines,
    };
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
                .describe(
                    'Workspace-relative directory path. Default: src/copilot. Empty string uses the default. Use "." for workspace root.',
                ),
            recursive: z.boolean().optional().describe('Whether to recurse into children. Default: false.'),
            depth: z.number().int().min(1).max(8).optional().describe('Maximum recursion depth. Default: 2.'),
            maxEntries: z.number().int().min(1).max(2000).optional().describe('Maximum entries returned.'),
            showHidden: z.boolean().optional().describe('Include dotfiles. Default: false.'),
        },
        annotations: readOnlyAnnotations(),
        handler: async ({ path, recursive, depth, maxEntries, showHidden }) => {
            const resolved = await resolveReadPath(normalizeOptionalRepoPath(path, DEFAULT_REPO_READ_PATH));
            if (!resolved.ok) return errorResult(resolved.reason, resolved);
            const effectiveMaxEntries = maxEntries ?? 2000;
            const scan = await scanDirectory(resolved.resolved, {
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
            recursive: z.boolean().optional().describe('Whether to recurse into children. Default: false.'),
            depth: z.number().int().min(1).max(8).optional().describe('Maximum recursion depth. Default: 2.'),
            maxEntries: z.number().int().min(1).max(2000).optional().describe('Maximum entries returned.'),
            showHidden: z.boolean().optional().describe('Include dotfiles. Default: false.'),
        },
        annotations: readOnlyAnnotations(),
        handler: async ({ recursive, depth, maxEntries, showHidden }) => {
            const resolved = await resolveReadPath('.');
            if (!resolved.ok) return errorResult(resolved.reason, resolved);
            const effectiveMaxEntries = maxEntries ?? 2000;
            const scan = await scanDirectory(resolved.resolved, {
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
            const resolved = await resolveReadPath('.');
            if (!resolved.ok) return errorResult(resolved.reason, resolved);
            const visibleScan = await scanDirectory(resolved.resolved, {
                workspaceRoot: WORKSPACE_ROOT,
                recursive: false,
                depth: 1,
                showHidden: false,
            });
            const aggregateScan = await scanDirectory(resolved.resolved, {
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
            path: z.string().min(1).describe('Workspace-relative file path.'),
            startLine: z.number().int().min(1).optional().describe('Optional 1-based first line.'),
            endLine: z.number().int().min(1).optional().describe('Optional 1-based last line.'),
        },
        annotations: readOnlyAnnotations(),
        handler: async ({ path, startLine, endLine }) => {
            const resolved = await resolveReadPath(path);
            if (!resolved.ok) return errorResult(resolved.reason, resolved);
            if (startLine !== undefined && endLine !== undefined && endLine < startLine) {
                return errorResult('endLine must be greater than or equal to startLine.', {
                    code: 'ERR_INVALID_LINE_RANGE',
                    hint: 'Use endLine greater than or equal to startLine, or omit endLine.',
                });
            }
            const { structured, text } = await readRepoFileWithValidatedResultCache(resolved, startLine, endLine);
            return okResult(structured, text);
        },
    },
    {
        name: 'repo_file_stats',
        title: 'Repository file stats',
        description:
            'Return filesystem metadata for a workspace file or directory, with optional SHA-256 for safe follow-up reads/writes.',
        inputSchema: {
            path: z.string().min(1).describe('Workspace-relative file or directory path.'),
            includeHash: z
                .boolean()
                .optional()
                .describe('If true, compute SHA-256 for files within maxHashBytes. Default: false.'),
            maxHashBytes: z
                .number()
                .int()
                .min(1)
                .max(25 * 1024 * 1024)
                .optional()
                .describe('Maximum file size eligible for hashing. Default: 5 MiB.'),
        },
        annotations: readOnlyAnnotations(),
        handler: async ({ path, includeHash, maxHashBytes }) => {
            const resolved = await resolveReadPath(path);
            if (!resolved.ok) return errorResult(resolved.reason, resolved);
            const statSnapshot = await statPath(resolved.resolved);
            const stats = statSnapshot.stats;
            const isFile = stats.isFile();
            const effectiveMaxHashBytes = maxHashBytes ?? 5 * 1024 * 1024;
            const shouldHash = includeHash === true && isFile && stats.size <= effectiveMaxHashBytes;
            const bytes = shouldHash ? await readBytes(resolved.resolved) : null;
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
                    : includeHash === true && !isFile
                      ? 'not-a-file'
                      : includeHash === true && stats.size > effectiveMaxHashBytes
                        ? 'file-too-large'
                        : 'hash-not-requested',
                maxHashBytes: effectiveMaxHashBytes,
                engine: bytes?.io.engine ?? statSnapshot.io.engine,
            });
        },
    },
    {
        name: 'repo_read_file_chunks',
        title: 'Read repository file chunks',
        description:
            'Read a UTF-8 file in line chunks for large-file navigation. Returns chunk metadata and nextCursor.',
        inputSchema: {
            path: z.string().min(1).describe('Workspace-relative file path.'),
            startLine: z.number().int().min(1).optional().describe('Optional 1-based first line.'),
            endLine: z.number().int().min(1).optional().describe('Optional 1-based last line.'),
            chunkLines: z.number().int().min(1).max(1000).optional().describe('Lines per chunk. Default: 200.'),
            cursor: z.string().optional().describe('Next-line cursor returned by a previous call.'),
            highWaterMark: z
                .number()
                .int()
                .min(1024)
                .max(16 * 1024 * 1024)
                .optional()
                .describe('Optional stream highWaterMark in bytes.'),
        },
        annotations: readOnlyAnnotations(),
        handler: async ({ path, startLine, endLine, chunkLines, cursor, highWaterMark }) => {
            const resolved = await resolveReadPath(path);
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
            const snapshot = await readTextChunks(resolved.resolved, {
                startLine: effectiveStartLine,
                ...(endLine !== undefined ? { endLine } : {}),
                chunkLines: chunkLines ?? 200,
                ...(highWaterMark !== undefined ? { highWaterMark } : {}),
            });
            const lastChunk = snapshot.chunks[snapshot.chunks.length - 1];
            const lastReturnedLine = lastChunk?.endLine ?? effectiveStartLine - 1;
            const nextCursor =
                snapshot.totalLinesKnown && lastReturnedLine < snapshot.totalLines
                    ? String(lastReturnedLine + 1)
                    : null;
            const text = snapshot.chunks.map((chunk) => chunk.content).join('\n');
            return okResult(
                {
                    success: true,
                    path: resolved.relative,
                    chunks: snapshot.chunks,
                    chunkCount: snapshot.chunks.length,
                    returnedChunkCount: snapshot.returnedChunkCount ?? snapshot.chunks.length,
                    returnedLineCount: snapshot.returnedLineCount ?? 0,
                    chunkLines: chunkLines ?? 200,
                    startLine: effectiveStartLine,
                    endLine: endLine ?? null,
                    totalLines: snapshot.totalLines,
                    totalLinesKnown: snapshot.totalLinesKnown,
                    lastScannedLine: snapshot.lastScannedLine ?? snapshot.totalLines,
                    fileTotalLines: snapshot.fileTotalLines ?? (snapshot.totalLinesKnown ? snapshot.totalLines : null),
                    fileTotalLinesKnown: snapshot.fileTotalLinesKnown ?? snapshot.totalLinesKnown,
                    bytes: snapshot.bytesRead,
                    sizeBytes: snapshot.sizeBytes,
                    nextCursor,
                    cursor: cursor ?? null,
                    engine: snapshot.io.engine,
                },
                text,
            );
        },
    },
    {
        name: 'repo_diff_files',
        title: 'Diff repository files',
        description: 'Return a unified diff between two workspace files using the canonical IO diff engine.',
        inputSchema: {
            pathA: z.string().min(1).describe('Workspace-relative baseline file path.'),
            pathB: z.string().min(1).describe('Workspace-relative comparison file path.'),
            contextLines: z.number().int().min(0).max(20).optional().describe('Diff context lines. Default: 3.'),
            includeDiffPreview: z
                .boolean()
                .optional()
                .describe('Include textual diff in the tool result. Default: false.'),
        },
        annotations: readOnlyAnnotations(),
        handler: async ({ pathA, pathB, contextLines, includeDiffPreview }) => {
            const resolvedA = await resolveReadPath(pathA);
            if (!resolvedA.ok) return errorResult(`pathA: ${resolvedA.reason}`, { ...resolvedA, field: 'pathA' });
            const resolvedB = await resolveReadPath(pathB);
            if (!resolvedB.ok) return errorResult(`pathB: ${resolvedB.reason}`, { ...resolvedB, field: 'pathB' });
            const diff = await diffText(resolvedA.resolved, resolvedB.resolved, { contextLines: contextLines ?? 3 });
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
            pattern: z.string().min(1).optional().describe('Text or regex pattern to search.'),
            query: z
                .string()
                .min(1)
                .optional()
                .describe('Alias for pattern; useful for clients that call search inputs query.'),
            path: z.string().optional().describe('Workspace-relative search root. Default: src/copilot.'),
            isRegex: z.boolean().optional().describe('Treat pattern as regex. Default: false.'),
            caseSensitive: z.boolean().optional().describe('Case-sensitive search. Default: false.'),
            includePattern: z.string().optional().describe('Optional include glob, for example *.js.'),
            excludePattern: z.string().optional().describe('Optional exclude glob.'),
            contextLines: z
                .number()
                .int()
                .min(0)
                .max(10)
                .optional()
                .describe('Lines of context around each match. Default: 0.'),
            maxResults: z.number().int().min(1).max(500).optional().describe('Maximum matches returned.'),
            cursor: z.string().optional().describe('Cursor returned by a previous repo_search_text call.'),
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
        }) => {
            const effectivePattern = pattern ?? query;
            if (!effectivePattern) {
                return errorResult('Search pattern is required.', {
                    code: 'ERR_SEARCH_PATTERN_REQUIRED',
                    hint: 'Provide pattern or query.',
                });
            }
            const resolved = await resolveReadPath(normalizeOptionalRepoPath(path, DEFAULT_REPO_READ_PATH));
            if (!resolved.ok) return errorResult(resolved.reason, resolved);
            const result = await searchText(resolved.resolved, {
                workspaceRoot: WORKSPACE_ROOT,
                pattern: effectivePattern,
                isRegex: isRegex === true,
                caseSensitive: caseSensitive === true,
                includePattern,
                excludePattern,
                maxResults,
                contextLines: contextLines ?? 0,
                cursor,
            });
            const structured = {
                success: true,
                path: resolved.relative,
                pattern: effectivePattern,
                query: query ?? null,
                contextLines: contextLines ?? 0,
                cursor: cursor ?? null,
                output: result.output,
                matchCount: result.matchCount,
                returnedMatchCount: result.returnedMatchCount ?? result.matchCount,
                returnedLineCount: result.returnedLineCount ?? (result.output ? result.output.split('\n').length : 0),
                totalMatches: result.totalMatches ?? result.matchCount,
                totalMatchCount: result.totalMatchCount ?? result.totalMatches ?? result.matchCount,
                totalLineCount: result.totalLineCount ?? null,
                truncated: result.truncated,
                nextCursor: result.nextCursor ?? null,
                cursorOffset: result.cursorOffset ?? 0,
                engine: result.engine,
            };
            return okResult(structured, result.output);
        },
    },
    {
        name: 'repo_find_symbol_usages',
        title: 'Find repository symbol usages',
        description:
            'Find textual usages of a symbol in the workspace with whole-word defaults, matching the LLM-B find_symbol_usages workflow.',
        inputSchema: {
            symbol: z.string().min(1).describe('Symbol name to search for.'),
            path: z.string().optional().describe('Workspace-relative search root. Default: src/copilot.'),
            includePattern: z.string().optional().describe('Include glob. Default: *.{js,ts,mjs,cjs}.'),
            excludePattern: z.string().optional().describe('Exclude glob, for example node_modules or dist.'),
            wholeWord: z.boolean().optional().describe('Search only whole-word symbol occurrences. Default: true.'),
            caseSensitive: z.boolean().optional().describe('Case-sensitive search. Default: true for symbols.'),
            maxResults: z.number().int().min(1).max(500).optional().describe('Maximum matches returned.'),
            cursor: z.string().optional().describe('Cursor returned by a previous repo_find_symbol_usages call.'),
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
            const resolved = await resolveReadPath(normalizeOptionalRepoPath(path, DEFAULT_REPO_READ_PATH));
            if (!resolved.ok) return errorResult(resolved.reason, resolved);
            const escaped = escapeForRegex(symbol);
            const pattern = wholeWord !== false ? `\\b${escaped}\\b` : escaped;
            const result = await searchText(resolved.resolved, {
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
            name: z.string().min(1).describe('Symbol name, prefix or substring to search.'),
            kind: z
                .enum(['function', 'class', 'variable', 'export', 'type', 'all'])
                .optional()
                .describe('Symbol kind. Default: all.'),
            path: z.string().optional().describe('Workspace-relative search root. Default: src/copilot.'),
            includePattern: z.string().optional().describe('Optional include glob, for example *.js.'),
            caseSensitive: z.boolean().optional().describe('Case-sensitive search. Default: false.'),
            exactMatch: z.boolean().optional().describe('Require exact symbol name. Default: false.'),
            maxResults: z.number().int().min(1).max(500).optional().describe('Maximum matches returned.'),
            cursor: z.string().optional().describe('Cursor returned by a previous repo_symbol_search call.'),
        },
        annotations: readOnlyAnnotations(),
        handler: async ({ name, kind, path, includePattern, caseSensitive, exactMatch, maxResults, cursor }) => {
            const resolved = await resolveReadPath(normalizeOptionalRepoPath(path, DEFAULT_REPO_READ_PATH));
            if (!resolved.ok) return errorResult(resolved.reason, resolved);
            const result = await searchWorkspaceSymbols(resolved.resolved, {
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
            path: z.string().min(1).describe('Workspace-relative file path.'),
            includeImports: z.boolean().optional().describe('Include imports. Default: true.'),
            includeExports: z.boolean().optional().describe('Include exports. Default: true.'),
            includeOutline: z.boolean().optional().describe('Include textual outline. Default: true.'),
            includeTopComments: z.boolean().optional().describe('Include top comments. Default: false.'),
        },
        annotations: readOnlyAnnotations(),
        handler: async ({ path, includeImports, includeExports, includeOutline, includeTopComments }) => {
            const resolved = await resolveReadPath(path);
            if (!resolved.ok) return errorResult(resolved.reason, resolved);
            const snapshot = await readText(resolved.resolved);
            const parsed = await parseFileForContext(resolved.resolved, snapshot.content);
            const structured = {
                success: true,
                path: resolved.relative,
                sha256: snapshot.contentHash,
                symbols: parsed.symbols.symbols,
                parseError: parsed.symbols.parseError ?? null,
                ...(includeImports !== false ? { imports: parsed.symbols.imports } : {}),
                ...(includeExports !== false ? { exports: parsed.symbols.exports } : {}),
                ...(includeOutline !== false ? { outline: parsed.outline } : {}),
                ...(includeTopComments === true ? { topComments: parsed.topComments } : {}),
            };
            const text = Array.isArray(structured.outline) ? structured.outline.join('\n') : '';
            return okResult(structured, text);
        },
    },
];
