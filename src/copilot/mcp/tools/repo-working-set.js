// @ts-check
/**
 * Compact MCP working-set surface over the shared LLM-B/session-scope engine.
 *
 * One tool deliberately composes open/context/find/refresh/status/close so a reusable working set does not add seven
 * permanent MCP descriptors. IDs are server-generated and must be present in this MCP-local ownership registry before
 * they can reach the shared scope engine.
 *
 * @module copilot/mcp/tools/repo-working-set
 */

import {
    closeScope,
    declareScope,
    findSymbol,
    getScopeContext,
    getScopeStats,
    refreshScope,
} from '#copilot/infra/public/session';
import { errorResult, getMcpWorkspaceRoot, okResult, readOnlyAnnotations, resolveReadPath } from '#copilot/mcp/control-plane';
import { randomUUID } from 'node:crypto';
import { isAbsolute, relative } from 'node:path';
import { z } from 'zod';

const DEFAULT_PATH = 'src/copilot';
const DEFAULT_MAX_FILES = 80;
const DEFAULT_CONTEXT_FILES = 40;
const DEFAULT_CONTEXT_BYTES = 16 * 1024;
const DEFAULT_CONCURRENCY = 4;
const MAX_MCP_WORKING_SETS = 8;

/** @type {Map<string, { scopeId: string; createdAtMs: number; lastAccessAtMs: number }>} */
const mcpWorkingSets = new Map();

function pruneStaleOwnedWorkingSets() {
    for (const [workingSetId, entry] of mcpWorkingSets) {
        if (getScopeStats(entry.scopeId)) continue;
        mcpWorkingSets.delete(workingSetId);
    }
}

function evictOldestOwnedWorkingSetIfNeeded() {
    pruneStaleOwnedWorkingSets();
    if (mcpWorkingSets.size < MAX_MCP_WORKING_SETS) return;
    const oldest = [...mcpWorkingSets.entries()].sort((a, b) => a[1].lastAccessAtMs - b[1].lastAccessAtMs)[0];
    if (!oldest) return;
    closeScope(oldest[1].scopeId);
    mcpWorkingSets.delete(oldest[0]);
}

/** @param {string | undefined} workingSetId */
function getOwnedWorkingSet(workingSetId) {
    if (!workingSetId) return null;
    const entry = mcpWorkingSets.get(workingSetId);
    if (!entry) return null;
    if (!getScopeStats(entry.scopeId)) {
        mcpWorkingSets.delete(workingSetId);
        return null;
    }
    entry.lastAccessAtMs = Date.now();
    return entry;
}

/** @param {string} absolutePath */
function toRepoPath(absolutePath) {
    return relative(getMcpWorkspaceRoot(), absolutePath).replace(/\\/gu, '/');
}

/**
 * @type {import('../registry.js').McpToolDefinition}
 */
export const repoWorkingSetTool = {
    name: 'repo_working_set',
    title: 'Repository working set',
    description:
        'Open and reuse one bounded repository working set across context, symbol lookup and delta refresh without repeated scans/reads.',
    inputSchema: {
        action: z.enum(['open', 'context', 'find', 'refresh', 'status', 'close']),
        workingSetId: z.string().min(1).max(128).optional().describe('Opaque id returned by action=open.'),
        path: z.string().optional().describe('Repository directory for action=open. Default: src/copilot.'),
        maxFiles: z.number().int().min(1).max(500).optional().describe('Hard selected-file cap for open, or manifest cap for context. Open default: 80.'),
        maxBytes: z.number().int().min(1024).max(65536).optional().describe('Context manifest UTF-8 budget. Default: 16 KiB.'),
        concurrency: z.number().int().min(1).max(8).optional().describe('Bounded open/refresh concurrency. Default: 4.'),
        parseSymbols: z.boolean().optional().describe('Parse symbols/imports during open. Default: true.'),
        indexMode: z.enum(['auto', 'off']).optional().describe('auto refreshes only selected paths in the shared index. Default: auto.'),
        selectionMode: z
            .enum(['coverage', 'lexical'])
            .optional()
            .describe('Directory selection inside maxFiles. Default coverage; lexical preserves historical prefix ordering.'),
        seedPaths: z
            .array(z.string().min(1))
            .max(32)
            .optional()
            .describe('Preferred workspace-relative files for open. Eligible seeds count inside the same maxFiles cap.'),
        seedSymbols: z
            .array(z.string().min(1).max(256))
            .max(32)
            .optional()
            .describe('Exact symbols resolved from the local index into preferred files inside the same maxFiles cap.'),
        include: z.array(z.string().min(1)).max(32).optional(),
        exclude: z.array(z.string().min(1)).max(32).optional(),
        modifiedPaths: z.array(z.string().min(1)).max(128).optional().describe('Explicit changed paths for action=refresh; omitted means known invalidations only.'),
        symbol: z.string().min(1).max(256).optional().describe('Symbol query for action=find.'),
        exactMatch: z.boolean().optional(),
        maxResults: z.number().int().min(1).max(200).optional().describe('Maximum symbol matches for action=find. Default: 50.'),
    },
    annotations: { ...readOnlyAnnotations(), idempotentHint: false },
    handler: async ({
        action,
        workingSetId,
        path,
        maxFiles,
        maxBytes,
        concurrency,
        parseSymbols,
        indexMode,
        selectionMode,
        seedPaths,
        seedSymbols,
        include,
        exclude,
        modifiedPaths,
        symbol,
        exactMatch,
        maxResults,
    }) => {
        if (action === 'open') {
            const resolved = await resolveReadPath((path ?? '').trim() || DEFAULT_PATH);
            if (!resolved.ok) return errorResult(resolved.reason, resolved);
            /** @type {string[]} */
            const preferredPaths = [];
            for (const candidate of seedPaths ?? []) {
                const seed = await resolveReadPath(candidate);
                if (!seed.ok) return errorResult(seed.reason, seed);
                const fromRoot = relative(resolved.resolved, seed.resolved);
                if (fromRoot === '..' || fromRoot.startsWith('../') || fromRoot.startsWith('..\\') || isAbsolute(fromRoot)) {
                    return errorResult('Working-set seed path must stay inside the opened root.', {
                        code: 'ERR_WORKING_SET_SEED_OUTSIDE_ROOT',
                        seedPath: candidate,
                    });
                }
                preferredPaths.push(seed.resolved);
            }
            evictOldestOwnedWorkingSetIfNeeded();
            const id = `mcp-ws-${randomUUID()}`;
            const now = Date.now();
            const handle = declareScope({
                sessionId: id,
                directory: resolved.resolved,
                workspaceRoot: getMcpWorkspaceRoot(),
                maxFiles: maxFiles ?? DEFAULT_MAX_FILES,
                parseSymbols: parseSymbols ?? true,
                indexMode: indexMode ?? 'auto',
                selectionMode: selectionMode ?? 'coverage',
                preferredPaths,
                seedSymbols,
                concurrency: concurrency ?? DEFAULT_CONCURRENCY,
                include,
                exclude,
                recursive: true,
                silent: true,
            });
            mcpWorkingSets.set(id, { scopeId: id, createdAtMs: now, lastAccessAtMs: now });
            const stats = await handle.awaitReady();
            if (!getScopeStats(id)) {
                mcpWorkingSets.delete(id);
                return errorResult('Working set closed or evicted before becoming ready.', { code: 'ERR_WORKING_SET_EVICTED' });
            }
            const context = getScopeContext(id, {
                maxFiles: Math.min(maxFiles ?? DEFAULT_CONTEXT_FILES, 200),
                maxBytes: maxBytes ?? DEFAULT_CONTEXT_BYTES,
            });
            return okResult({
                workingSetId: id,
                path: toRepoPath(resolved.resolved),
                stats,
                context,
                activeOwnedWorkingSets: mcpWorkingSets.size,
                maxOwnedWorkingSets: MAX_MCP_WORKING_SETS,
            });
        }

        const owned = getOwnedWorkingSet(workingSetId);
        if (!owned) {
            return errorResult('Unknown or expired MCP workingSetId.', {
                code: 'ERR_WORKING_SET_NOT_FOUND',
                workingSetId: workingSetId ?? null,
            });
        }

        if (action === 'context') {
            return okResult({
                workingSetId,
                context: getScopeContext(owned.scopeId, {
                    maxFiles: Math.min(maxFiles ?? DEFAULT_CONTEXT_FILES, 200),
                    maxBytes: maxBytes ?? DEFAULT_CONTEXT_BYTES,
                }),
            });
        }

        if (action === 'status') {
            return okResult({ workingSetId, stats: getScopeStats(owned.scopeId) });
        }

        if (action === 'find') {
            if (!symbol) return errorResult('action=find requires symbol.', { code: 'ERR_WORKING_SET_SYMBOL_REQUIRED' });
            const limit = maxResults ?? 50;
            const matches = findSymbol(owned.scopeId, symbol, { exactMatch }).slice(0, limit).map((entry) => ({
                path: toRepoPath(entry.filePath),
                symbol: entry.symbol,
            }));
            return okResult({ workingSetId, symbol, exactMatch: exactMatch ?? false, matchCount: matches.length, matches });
        }

        if (action === 'refresh') {
            /** @type {string[] | undefined} */
            let resolvedPaths;
            if (modifiedPaths && modifiedPaths.length > 0) {
                resolvedPaths = [];
                for (const candidate of modifiedPaths) {
                    const resolved = await resolveReadPath(candidate);
                    if (!resolved.ok) return errorResult(resolved.reason, resolved);
                    resolvedPaths.push(resolved.resolved);
                }
            }
            const result = await refreshScope(owned.scopeId, resolvedPaths);
            return okResult({
                workingSetId,
                ...result,
                stats: getScopeStats(owned.scopeId),
                context: getScopeContext(owned.scopeId, {
                    maxFiles: Math.min(maxFiles ?? DEFAULT_CONTEXT_FILES, 200),
                    maxBytes: maxBytes ?? DEFAULT_CONTEXT_BYTES,
                }),
            });
        }

        const stats = closeScope(owned.scopeId);
        mcpWorkingSets.delete(workingSetId ?? '');
        return okResult({ workingSetId, closed: true, stats, activeOwnedWorkingSets: mcpWorkingSets.size });
    },
};

export function resetMcpWorkingSetsForTest() {
    for (const entry of mcpWorkingSets.values()) closeScope(entry.scopeId);
    mcpWorkingSets.clear();
}
