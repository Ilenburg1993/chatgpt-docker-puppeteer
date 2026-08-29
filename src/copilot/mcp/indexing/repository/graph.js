// @ts-check
/**
 * Repository module-graph application operations over the shared infra index.
 *
 * This owner performs no source parsing and no filesystem traversal. Nodes/import facts come from the existing index;
 * package/relative resolution and graph algorithms come from infra. MCP tool modules only frame these results.
 *
 * @module copilot/mcp/indexing/repository/graph
 */

import {
    buildIndexedModuleGraph,
    computeModuleChangeImpact,
    findModuleGraphCycles,
    findModuleGraphPath,
    graphRelativePath,
    summarizeModuleGraph,
    traverseModuleGraph,
} from '#copilot/infra/public/indexing/graph';
import { createLocalModuleResolver } from '#copilot/infra/public/indexing/module-resolution';
import { normalizeSearchWindow, paginateSearchItems } from '#copilot/infra/public/indexing/search';
import { evaluateWorkspacePathPolicy } from '#copilot/infra/public/policy';
import { createWorkspaceGitReadService } from '#copilot/mcp/public/workspace/git';
import { isAbsolute, relative, resolve as resolvePath } from 'node:path';
import { DEFAULT_REPOSITORY_INDEX_PATH, normalizeRepositoryIndexPath } from './runtime.js';

const MAX_CHANGE_IMPACT_GIT_SEEDS = 2000;

/** @typedef {import('#copilot/mcp/public/workspace').McpWorkspaceCapability} RepositoryIndexWorkspace */
/** @typedef {ReturnType<typeof buildIndexedModuleGraph>} IndexedModuleGraph */
/** @typedef {Extract<Awaited<ReturnType<RepositoryIndexWorkspace['resolveValidatedReadPath']>>, {ok:true}>} ValidatedGraphScope */
/** @typedef {ReturnType<RepositoryIndexWorkspace['indexRegistry']['status']>} RepositoryIndexStats */
/** @typedef {{ok:true;paths:readonly string[];source:Readonly<Record<string, unknown>>}|{ok:false;message:string;details:Record<string,unknown>}} ChangeImpactSeedResolution */
/** @typedef {{ok:true;absolute:string;relative:string}|{ok:false;message:string;details:Record<string,unknown>}} HistoricalGraphSeedResolution */
/**
 * @typedef {{ ok: true; structured: Record<string, unknown>; text?: string } |
 *           { ok: false; message: string; details: Record<string, unknown> }} RepositoryIndexOperationResult
 * @typedef {{ok:true;graph:IndexedModuleGraph;resolved:ValidatedGraphScope;stats:RepositoryIndexStats} |
 *           {ok:false;message:string;details:Record<string,unknown>}} RepositoryGraphSnapshot
 */

/** @param {Record<string, unknown>} structured @param {string} [text] @returns {RepositoryIndexOperationResult} */
function success(structured, text) {
    return text === undefined ? { ok: true, structured } : { ok: true, structured, text };
}

/** @param {string} message @param {Record<string, unknown>} [details] @returns {RepositoryIndexOperationResult} */
function failure(message, details = {}) {
    return { ok: false, message, details };
}

/** @param {string} root @param {string} candidate */
function isInside(root, candidate) {
    const rel = relative(root, candidate).replace(/\\/gu, '/');
    return rel === '' || (!rel.startsWith('../') && rel !== '..');
}

/**
 * @param {RepositoryIndexWorkspace} workspace
 * @param {string | undefined} path
 * @param {boolean | undefined} includeDynamic
 */
/**
 * @param {RepositoryIndexWorkspace} workspace
 * @param {string | undefined} path
 * @param {boolean | undefined} includeDynamic
 * @returns {Promise<RepositoryGraphSnapshot>}
 */
async function buildGraphSnapshot(workspace, path, includeDynamic) {
    const stats = workspace.indexRegistry.status();
    if (!stats.available) {
        return {
            ok: false,
            message: 'MCP IO index is unavailable; build the index before graph analysis.',
            details: {
                code: 'MCP_IO_INDEX_UNAVAILABLE',
                hint: 'Run repo_index_build for the desired scope first.',
            },
        };
    }
    const resolved = await workspace.resolveValidatedReadPath(
        normalizeRepositoryIndexPath(path, DEFAULT_REPOSITORY_INDEX_PATH),
    );
    if (!resolved.ok) return { ok: false, message: resolved.reason, details: resolved };
    const fileRows = workspace.indexRegistry.listFiles();
    const importRows = workspace.indexRegistry
        .findImportsByPath(resolved.resolved)
        .filter((row) => includeDynamic !== false || row.isDynamic !== 1);
    const moduleResolver = await createLocalModuleResolver({ workspaceRoot: workspace.workspaceRoot });
    const graph = buildIndexedModuleGraph({
        workspaceRoot: workspace.workspaceRoot,
        scopeRoot: resolved.resolved,
        fileRows,
        importRows,
        moduleResolver,
    });
    return { ok: true, graph, resolved, stats };
}

/** @param {IndexedModuleGraph} graph @param {{path:string;distance:number}[]} rows */
function projectTraversal(graph, rows) {
    return rows.map((row) => ({ path: graphRelativePath(graph, row.path), distance: row.distance }));
}

/**
 * @param {RepositoryIndexWorkspace} workspace
 * @param {{view?:'summary'|'dependencies'|'dependents'|'cycles'|'path'|'unresolved';path?:string;node?:string;from?:string;to?:string;includeDynamic?:boolean;maxDepth?:number;maxResults?:number;cursor?:string}} input
 * @returns {Promise<RepositoryIndexOperationResult>}
 */
export async function readRepositoryModuleGraph(workspace, input) {
    const view = input.view ?? 'summary';
    const snapshot = await buildGraphSnapshot(workspace, input.path, input.includeDynamic);
    if (!snapshot.ok) return snapshot;
    const { graph, resolved, stats } = snapshot;
    const base = {
        success: true,
        available: true,
        view,
        path: resolved.relative,
        engine: 'indexed-module-graph-v1',
        packageImportsHash: graph.packageImportsHash,
        stats,
    };

    if (view === 'summary') {
        const raw = summarizeModuleGraph(graph);
        const summary = {
            ...raw,
            topDependencies: raw.topDependencies.map((row) => ({
                ...row,
                path: graphRelativePath(graph, row.path),
            })),
            topDependents: raw.topDependents.map((row) => ({
                ...row,
                path: graphRelativePath(graph, row.path),
            })),
        };
        return success({ ...base, summary }, `Module graph ${resolved.relative}: ${summary.nodeCount} nodes, ${summary.edgeCount} local edges, ${summary.cycleComponentCount} cycle components.`);
    }

    if (view === 'path') {
        if (!input.from || !input.to) {
            return failure('repo_graph view=path requires from and to.', { code: 'ERR_GRAPH_PATH_ENDPOINTS_REQUIRED' });
        }
        const from = await workspace.resolveValidatedReadPath(input.from);
        if (!from.ok) return failure(from.reason, from);
        const to = await workspace.resolveValidatedReadPath(input.to);
        if (!to.ok) return failure(to.reason, to);
        if (!isInside(resolved.resolved, from.resolved) || !isInside(resolved.resolved, to.resolved)) {
            return failure('Graph path endpoints must be inside the selected graph scope.', {
                code: 'ERR_GRAPH_ENDPOINT_OUTSIDE_SCOPE',
                scope: resolved.relative,
            });
        }
        const found = findModuleGraphPath(graph, from.resolved, to.resolved, { maxDepth: input.maxDepth ?? 50 });
        const projected = found?.map((item) => graphRelativePath(graph, item)) ?? null;
        return success({
            ...base,
            from: from.relative,
            to: to.relative,
            found: projected !== null,
            pathNodes: projected,
            pathLength: projected ? Math.max(0, projected.length - 1) : null,
        });
    }

    const window = normalizeSearchWindow({
        ...(input.maxResults === undefined ? {} : { maxResults: input.maxResults }),
        ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
    });

    if (view === 'cycles') {
        const cycles = findModuleGraphCycles(graph).map((component) =>
            component.map((item) => graphRelativePath(graph, item)),
        );
        const paged = paginateSearchItems(cycles, window);
        return success({
            ...base,
            cycles: paged.items,
            returnedCount: paged.items.length,
            totalCount: paged.totalItems,
            truncated: paged.truncated,
            nextCursor: paged.nextCursor,
            cursorOffset: paged.cursorOffset,
        });
    }

    if (view === 'unresolved') {
        const rows = graph.unresolvedLocal.map((row) => ({
            source: graphRelativePath(graph, row.source),
            sourceSpecifier: row.sourceSpecifier,
            line: row.line,
            dynamic: row.dynamic,
            strategy: row.strategy,
            candidateCount: row.candidates.length,
            candidatePreview: row.candidates
                .filter((candidate) => isInside(workspace.workspaceRoot, candidate))
                .slice(0, 5)
                .map((candidate) => relative(workspace.workspaceRoot, candidate).replace(/\\/gu, '/')),
        }));
        const paged = paginateSearchItems(rows, window);
        return success({
            ...base,
            unresolved: paged.items,
            returnedCount: paged.items.length,
            totalCount: paged.totalItems,
            truncated: paged.truncated,
            nextCursor: paged.nextCursor,
            cursorOffset: paged.cursorOffset,
        });
    }

    if (!input.node) {
        return failure(`repo_graph view=${view} requires node.`, { code: 'ERR_GRAPH_NODE_REQUIRED' });
    }
    const node = await workspace.resolveValidatedReadPath(input.node);
    if (!node.ok) return failure(node.reason, node);
    if (!isInside(resolved.resolved, node.resolved)) {
        return failure('Graph node must be inside the selected graph scope.', {
            code: 'ERR_GRAPH_NODE_OUTSIDE_SCOPE',
            scope: resolved.relative,
            node: node.relative,
        });
    }
    if (!graph.nodeSet.has(resolvePath(node.resolved))) {
        return failure('Graph node is not present in the current index snapshot.', {
            code: 'ERR_GRAPH_NODE_NOT_INDEXED',
            node: node.relative,
            hint: 'Refresh the repository index before retrying.',
        });
    }
    const direction = view === 'dependencies' ? 'dependencies' : 'dependents';
    const rows = projectTraversal(
        graph,
        traverseModuleGraph(graph, node.resolved, direction, { maxDepth: input.maxDepth ?? 1 }),
    );
    const paged = paginateSearchItems(rows, window);
    return success({
        ...base,
        node: node.relative,
        direction,
        maxDepth: input.maxDepth ?? 1,
        nodes: paged.items,
        returnedCount: paged.items.length,
        totalCount: paged.totalItems,
        truncated: paged.truncated,
        nextCursor: paged.nextCursor,
        cursorOffset: paged.cursorOffset,
    });
}

/** @param {string} message @param {Record<string, unknown>} details @returns {Extract<ChangeImpactSeedResolution,{ok:false}>} */
function seedFailure(message, details) {
    return { ok: false, message, details };
}

/**
 * Resolve one explicit seed mode: caller paths or a Git base/head range. Git-derived paths are NUL-safe because the
 * shared Git read service owns --name-status -z parsing. Uncertain parser state fails closed rather than understating
 * impact.
 *
 * @param {RepositoryIndexWorkspace} workspace
 * @param {ValidatedGraphScope} resolvedScope
 * @param {{paths?:string[];gitBase?:string;gitHead?:string}} input
 * @param {{gitConfig?:Parameters<typeof createWorkspaceGitReadService>[0]['config'];signal?:AbortSignal}} ports
 * @returns {Promise<ChangeImpactSeedResolution>}
 */
async function resolveChangeImpactSeeds(workspace, resolvedScope, input, ports) {
    const explicitPaths = input.paths?.filter(Boolean) ?? [];
    const hasExplicit = explicitPaths.length > 0;
    const hasGitBase = input.gitBase !== undefined;
    const hasGitHead = input.gitHead !== undefined;
    const hasAnyGit = hasGitBase || hasGitHead;
    if (hasExplicit && hasAnyGit) {
        return seedFailure('repo_change_impact accepts either paths or gitBase/gitHead, never both.', {
            code: 'ERR_CHANGE_IMPACT_SEED_MODE',
            failureClass: 'invalid-input',
        });
    }
    if (!hasExplicit && !hasAnyGit) {
        return seedFailure('repo_change_impact requires paths or a gitBase/gitHead pair.', {
            code: 'ERR_CHANGE_IMPACT_SEEDS_REQUIRED',
            failureClass: 'invalid-input',
        });
    }
    if (hasGitBase !== hasGitHead) {
        return seedFailure('gitBase and gitHead must be supplied together.', {
            code: 'ERR_CHANGE_IMPACT_GIT_RANGE',
            failureClass: 'invalid-input',
        });
    }
    if (hasExplicit) {
        return {
            ok: true,
            paths: Object.freeze([...new Set(explicitPaths)]),
            source: Object.freeze({ mode: 'paths', requestedPathCount: explicitPaths.length }),
        };
    }
    if (!ports.gitConfig) {
        return seedFailure('Git range impact requires the governed Git process capability.', {
            code: 'ERR_CHANGE_IMPACT_GIT_CAPABILITY',
            failureClass: 'configuration',
        });
    }
    const git = createWorkspaceGitReadService({
        workspace,
        config: ports.gitConfig,
        ...(ports.signal ? { signal: ports.signal } : {}),
    });
    const changed = await git.changedFiles({
        base: input.gitBase,
        head: input.gitHead,
        ...(resolvedScope.relative === '.' ? {} : { paths: [resolvedScope.relative] }),
    });
    if (!changed.ok) {
        return seedFailure('Unable to derive change-impact seeds from the requested Git range.', {
            ...changed,
            code: 'ERR_CHANGE_IMPACT_GIT_READ',
        });
    }
    if (changed.uncertain) {
        return seedFailure('Git changed-files parsing was uncertain; impact analysis refused to risk an incomplete seed set.', {
            code: 'ERR_CHANGE_IMPACT_GIT_PARSE_UNCERTAIN',
            gitBase: changed.base,
            gitHead: changed.head,
        });
    }
    const seedPaths = [];
    const seen = new Set();
    for (const change of changed.changes) {
        for (const candidate of change.oldPath ? [change.oldPath, change.path] : [change.path]) {
            if (!seen.has(candidate)) {
                seen.add(candidate);
                seedPaths.push(candidate);
            }
        }
    }
    if (seedPaths.length > MAX_CHANGE_IMPACT_GIT_SEEDS) {
        return seedFailure(`Git range expands to ${String(seedPaths.length)} seed paths; bounded maximum is ${String(MAX_CHANGE_IMPACT_GIT_SEEDS)}.`, {
            code: 'ERR_CHANGE_IMPACT_GIT_SEED_LIMIT',
            gitBase: changed.base,
            gitHead: changed.head,
            seedPathCount: seedPaths.length,
            maxSeedPaths: MAX_CHANGE_IMPACT_GIT_SEEDS,
        });
    }
    return {
        ok: true,
        paths: Object.freeze(seedPaths),
        source: Object.freeze({
            mode: 'git-range',
            gitBase: changed.base,
            gitHead: changed.head,
            changeCount: changed.changes.length,
            seedPathCount: seedPaths.length,
            scope: resolvedScope.relative,
        }),
    };
}

/**
 * Validate a potentially historical Git path against workspace containment/read policy without requiring that the path
 * still exist in the primary working tree.
 *
 * @param {string} workspaceRoot
 * @param {string} rawPath
 * @returns {HistoricalGraphSeedResolution}
 */
function normalizeHistoricalGraphSeed(workspaceRoot, rawPath) {
    if (typeof rawPath !== 'string') {
        return { ok: false, message: 'Changed paths must be strings.', details: { code: 'ERR_CHANGE_IMPACT_PATH' } };
    }
    const candidate = rawPath.trim().replaceAll('\\', '/').replace(/^\.\//u, '').replace(/\/+$/u, '');
    if (
        !candidate ||
        candidate === '.' ||
        candidate === '..' ||
        candidate.startsWith('../') ||
        isAbsolute(candidate) ||
        candidate.includes('\u0000')
    ) {
        return {
            ok: false,
            message: `Invalid workspace-relative changed path '${rawPath}'.`,
            details: { code: 'ERR_CHANGE_IMPACT_PATH', path: rawPath },
        };
    }
    const policy = evaluateWorkspacePathPolicy(candidate, { workspaceRoot, mode: 'read' });
    if (!policy.ok) {
        return {
            ok: false,
            message: `Changed path '${rawPath}' is denied by workspace read policy.`,
            details: { code: 'ERR_CHANGE_IMPACT_PATH_DENIED', path: rawPath },
        };
    }
    const absolute = resolvePath(workspaceRoot, candidate);
    if (!isInside(workspaceRoot, absolute)) {
        return {
            ok: false,
            message: `Changed path '${rawPath}' resolves outside the workspace.`,
            details: { code: 'ERR_CHANGE_IMPACT_PATH_OUTSIDE_WORKSPACE', path: rawPath },
        };
    }
    return { ok: true, absolute, relative: candidate };
}

/**
 * @param {RepositoryIndexWorkspace} workspace
 * @param {{paths?:string[];gitBase?:string;gitHead?:string;path?:string;includeDynamic?:boolean;maxDepth?:number;includeSeeds?:boolean;maxResults?:number;cursor?:string}} input
 * @param {{gitConfig?:Parameters<typeof createWorkspaceGitReadService>[0]['config'];signal?:AbortSignal}} [ports]
 * @returns {Promise<RepositoryIndexOperationResult>}
 */
export async function readRepositoryChangeImpact(workspace, input, ports = {}) {
    const snapshot = await buildGraphSnapshot(workspace, input.path, input.includeDynamic);
    if (!snapshot.ok) return snapshot;
    const { graph, resolved, stats } = snapshot;
    const source = await resolveChangeImpactSeeds(workspace, resolved, input, ports);
    if (!source.ok) return source;
    /** @type {string[]} */
    const seeds = [];
    /** @type {string[]} */
    const unindexed = [];
    for (const candidate of source.paths) {
        const normalized = normalizeHistoricalGraphSeed(workspace.workspaceRoot, candidate);
        if (!normalized.ok) return failure(normalized.message, normalized.details);
        if (!isInside(resolved.resolved, normalized.absolute)) {
            return failure('Every changed path must be inside the selected graph scope.', {
                code: 'ERR_CHANGE_IMPACT_PATH_OUTSIDE_SCOPE',
                scope: resolved.relative,
                path: normalized.relative,
            });
        }
        if (graph.nodeSet.has(normalized.absolute)) seeds.push(normalized.absolute);
        else unindexed.push(normalized.relative);
    }
    const impact = computeModuleChangeImpact(graph, seeds, {
        maxDepth: input.maxDepth ?? 1000,
        includeSeeds: input.includeSeeds === true,
    }).map((row) => ({
        path: graphRelativePath(graph, row.path),
        distance: row.distance,
        seed: row.seed,
    }));
    const window = normalizeSearchWindow({
        ...(input.maxResults === undefined ? {} : { maxResults: input.maxResults }),
        ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
    });
    const paged = paginateSearchItems(impact, window);
    return success({
        success: true,
        available: true,
        path: resolved.relative,
        engine: 'indexed-module-impact-v1',
        packageImportsHash: graph.packageImportsHash,
        seedSource: source.source,
        requestedSeedCount: source.paths.length,
        seedCount: seeds.length,
        unindexedSeeds: unindexed,
        maxDepth: input.maxDepth ?? 1000,
        includeSeeds: input.includeSeeds === true,
        impacted: paged.items,
        returnedCount: paged.items.length,
        totalCount: paged.totalItems,
        truncated: paged.truncated,
        nextCursor: paged.nextCursor,
        cursorOffset: paged.cursorOffset,
        stats,
    });
}
