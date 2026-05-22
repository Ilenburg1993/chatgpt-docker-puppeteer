// @ts-check
/**
 * Workspace read-only MCP tools.
 *
 * @module copilot/mcp/tools/repo-read
 */

import { parseFileForContext } from '#copilot/infra';
import { diffText, readText, readTextChunks, scanDirectory, searchText, searchWorkspaceSymbols } from '#copilot/infra/public/io';
import { WORKSPACE_ROOT } from '#copilot/tools';
import { z } from 'zod';
import { readOnlyAnnotations } from '../control-plane/annotations.js';
import { getMcpWorkspaceRoot, resolveReadPath } from '../control-plane/paths.js';
import { errorResult, okResult } from '../control-plane/result.js';
import { repoStatusHandler } from './repo-status.js';

const DEFAULT_REPO_READ_PATH = 'src/copilot';

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
                .describe('Workspace-relative directory path. Default: src/copilot. Empty string uses the default. Use "." for workspace root.'),
            recursive: z.boolean().optional().describe('Whether to recurse into children. Default: false.'),
            depth: z.number().int().min(1).max(8).optional().describe('Maximum recursion depth. Default: 2.'),
            maxEntries: z.number().int().min(1).max(2000).optional().describe('Maximum entries returned.'),
            showHidden: z.boolean().optional().describe('Include dotfiles. Default: false.'),
        },
        annotations: readOnlyAnnotations(),
        handler: async ({ path, recursive, depth, maxEntries, showHidden }) => {
            const resolved = await resolveReadPath(normalizeOptionalRepoPath(path, DEFAULT_REPO_READ_PATH));
            if (!resolved.ok) return errorResult(resolved.reason, resolved);
            const scan = await scanDirectory(resolved.resolved, {
                workspaceRoot: WORKSPACE_ROOT,
                recursive: recursive === true,
                depth: depth ?? 2,
                showHidden: showHidden === true,
            });
            const entries = scan.entries.slice(0, maxEntries ?? 2000);
            const structured = {
                success: true,
                workspaceRoot: getMcpWorkspaceRoot(),
                path: resolved.relative,
                count: entries.length,
                totalScanned: scan.scannedEntries,
                truncated: entries.length < scan.entries.length,
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
            const scan = await scanDirectory(resolved.resolved, {
                workspaceRoot: WORKSPACE_ROOT,
                recursive: recursive === true,
                depth: depth ?? 2,
                showHidden: showHidden === true,
            });
            const entries = scan.entries.slice(0, maxEntries ?? 2000);
            return okResult({
                success: true,
                workspaceRoot: getMcpWorkspaceRoot(),
                path: resolved.relative,
                count: entries.length,
                totalScanned: scan.scannedEntries,
                truncated: entries.length < scan.entries.length,
                entries,
            });
        },
    },
    {
        name: 'repo_read_file',
        title: 'Read repository file',
        description: 'Read a UTF-8 file inside the workspace, optionally using a line window. Returns SHA-256 hashes for safe follow-up writes.',
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
            return okResult(structured, snapshot.content);
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
                snapshot.totalLinesKnown && lastReturnedLine < snapshot.totalLines ? String(lastReturnedLine + 1) : null;
            const text = snapshot.chunks.map((chunk) => chunk.content).join('\n');
            return okResult(
                {
                    success: true,
                    path: resolved.relative,
                    chunks: snapshot.chunks,
                    chunkCount: snapshot.chunks.length,
                    chunkLines: chunkLines ?? 200,
                    startLine: effectiveStartLine,
                    endLine: endLine ?? null,
                    totalLines: snapshot.totalLines,
                    totalLinesKnown: snapshot.totalLinesKnown,
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
        },
        annotations: readOnlyAnnotations(),
        handler: async ({ pathA, pathB, contextLines }) => {
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
                    diff: diff.diff,
                    engine: diff.io.engine,
                    contextLines: contextLines ?? 3,
                },
                diff.diff,
            );
        },
    },
    {
        name: 'repo_search_text',
        title: 'Search repository text',
        description: 'Search text or regex inside the workspace and return matching lines.',
        inputSchema: {
            pattern: z.string().min(1).describe('Text or regex pattern to search.'),
            path: z.string().optional().describe('Workspace-relative search root. Default: src/copilot.'),
            isRegex: z.boolean().optional().describe('Treat pattern as regex. Default: false.'),
            caseSensitive: z.boolean().optional().describe('Case-sensitive search. Default: false.'),
            includePattern: z.string().optional().describe('Optional include glob, for example *.js.'),
            excludePattern: z.string().optional().describe('Optional exclude glob.'),
            contextLines: z.number().int().min(0).max(10).optional().describe('Lines of context around each match. Default: 0.'),
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
        }) => {
            const resolved = await resolveReadPath(normalizeOptionalRepoPath(path, DEFAULT_REPO_READ_PATH));
            if (!resolved.ok) return errorResult(resolved.reason, resolved);
            const result = await searchText(resolved.resolved, {
                workspaceRoot: WORKSPACE_ROOT,
                pattern,
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
                pattern,
                contextLines: contextLines ?? 0,
                cursor: cursor ?? null,
                output: result.output,
                matchCount: result.matchCount,
                totalMatches: result.totalMatches ?? result.matchCount,
                truncated: result.truncated,
                nextCursor: result.nextCursor ?? null,
                cursorOffset: result.cursorOffset ?? 0,
                engine: result.engine,
            };
            return okResult(structured, result.output);
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
