// @ts-check
/**
 * Workspace read-only MCP tools.
 *
 * @module copilot/mcp/tools/repo-read
 */

import { readText, scanDirectory, searchText } from '#copilot/infra/public/io';
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
            if (!resolved.ok) return errorResult(resolved.reason);
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
            if (!resolved.ok) return errorResult(resolved.reason);
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
            if (!resolved.ok) return errorResult(resolved.reason);
            if (startLine !== undefined && endLine !== undefined && endLine < startLine) {
                return errorResult('endLine must be greater than or equal to startLine.');
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
            if (!resolved.ok) return errorResult(resolved.reason);
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
];
