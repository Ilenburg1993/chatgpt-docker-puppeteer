// @ts-check
/**
 * Exhaustive bounded repository inventory semantics shared by Git, filesystem and persistent-index sources.
 *
 * The projection is intentionally flat and workspace-relative. Continuation is keyset-based on the last returned path,
 * so insertions/removals before the cursor do not shift an offset window. Heavy content hashes remain lazy and belong to
 * targeted stat/read composition after inventory narrows the candidate set.
 *
 * @module copilot/mcp/workspace/repository/read/inventory
 */

import { evaluateWorkspacePathPolicy } from '#copilot/infra/public/policy';
import { extname, isAbsolute, relative } from 'node:path';

const DEFAULT_REPOSITORY_INVENTORY_PATH = 'src/copilot';
const MAX_AGGREGATE_ROWS = 32;

/** @typedef {import('#copilot/mcp/public/workspace').McpWorkspaceCapability} RepositoryInventoryWorkspace */
/**
 * @typedef {{
 *   ok: true;
 *   paths: readonly string[];
 *   metadata?: Record<string, unknown>;
 * } | {
 *   ok: false;
 *   message: string;
 *   details?: Record<string, unknown>;
 * }} GitInventoryResult
 *
 * @typedef {{
 *   gitListTrackedPaths?: (scopePath:string) => Promise<GitInventoryResult>;
 *   signal?: AbortSignal;
 * }} RepositoryInventoryPorts
 *
 * @typedef {{ ok: true; structured: Record<string, unknown>; text?: string } |
 *           { ok: false; message: string; details: Record<string, unknown> }} RepositoryInventoryOperationResult
 */

/** @param {Record<string, unknown>} structured @returns {RepositoryInventoryOperationResult} */
function success(structured) {
    return { ok: true, structured };
}

/** @param {string} message @param {Record<string, unknown>} [details] @returns {RepositoryInventoryOperationResult} */
function failure(message, details = {}) {
    return { ok: false, message, details };
}

/**
 * @param {RepositoryInventoryWorkspace} workspace
 * @param {{
 *   source:'git'|'filesystem'|'index';
 *   path?:string;
 *   maxResults:number;
 *   maxOutputBytes:number;
 *   cursor?:string;
 * }} input
 * @param {RepositoryInventoryPorts} [ports]
 * @returns {Promise<RepositoryInventoryOperationResult>}
 */
export async function readRepositoryInventory(workspace, input, ports = {}) {
    ports.signal?.throwIfAborted();
    const requestedPath = normalizeOptionalRepositoryPath(input.path, DEFAULT_REPOSITORY_INVENTORY_PATH);
    const resolved = await workspace.resolveValidatedReadPath(requestedPath);
    if (!resolved.ok) return failure(resolved.reason, resolved);
    const scopePath = normalizeWorkspaceRelativePath(workspace.workspaceRoot, resolved.relative);
    if (!scopePath) {
        return failure('Inventory scope could not be normalized.', {
            code: 'ERR_REPO_INVENTORY_SCOPE',
            failureClass: 'invalid-input',
            retryability: 'fix-input',
            recoveryRequired: false,
        });
    }

    const targetStat = await workspace.io.statPathValidated(resolved.validatedReadPath);
    const sourceResult = await collectInventorySource(workspace, input.source, scopePath, targetStat.stats.isFile(), ports);
    if (!sourceResult.ok) return failure(sourceResult.message, sourceResult.details ?? {});

    const normalizedCursor = normalizeInventoryCursor(workspace.workspaceRoot, scopePath, input.cursor);
    if (!normalizedCursor.ok) return failure(normalizedCursor.message, normalizedCursor.details);

    ports.signal?.throwIfAborted();
    const visible = normalizeVisibleInventoryPaths(
        workspace.workspaceRoot,
        scopePath,
        sourceResult.paths,
        ports.signal,
    );
    const cursor = normalizedCursor.cursor;
    const afterCursor = cursor
        ? visible.paths.filter((candidate) => compareInventoryPaths(candidate, cursor) > 0)
        : visible.paths;
    const page = pageInventoryPaths(afterCursor, input.maxResults, input.maxOutputBytes);
    if (!page.ok) return failure(page.message, page.details);

    const aggregates = buildInventoryAggregates(visible.paths, scopePath);
    return success({
        success: true,
        source: input.source,
        path: scopePath,
        cursorKind: 'path-keyset-v1',
        cursor: normalizedCursor.cursor,
        nextCursor: page.nextCursor,
        truncated: page.truncated,
        truncationReason: page.truncationReason,
        returnedCount: page.paths.length,
        returnedContentBytes: page.contentBytes,
        contentBudgetBytes: input.maxOutputBytes,
        maxResults: input.maxResults,
        paths: page.paths,
        aggregates,
        sourceMetadata: sourceResult.metadata ?? {},
        redactedCandidateCount: visible.redactedCandidateCount,
        duplicateCandidateCount: visible.duplicateCandidateCount,
        hashPolicy: {
            mode: 'lazy',
            includedInInventory: false,
            followUpOwner: 'repo_bulk_inspect',
            hint: 'Request stat includeHash only for selected inventory paths that actually need a digest.',
        },
        securityPolicy: {
            projection: 'workspace-relative-only',
            protectedPaths: 'redacted-before-pagination',
            symlinkTraversal: 'disabled-for-filesystem-source',
        },
    });
}

/**
 * @param {RepositoryInventoryWorkspace} workspace
 * @param {'git'|'filesystem'|'index'} source
 * @param {string} scopePath
 * @param {boolean} scopeIsFile
 * @param {RepositoryInventoryPorts} ports
 * @returns {Promise<GitInventoryResult>}
 */
async function collectInventorySource(workspace, source, scopePath, scopeIsFile, ports) {
    if (source === 'git') {
        if (!ports.gitListTrackedPaths) {
            return {
                ok: false,
                message: 'Git inventory capability is unavailable.',
                details: {
                    code: 'ERR_REPO_INVENTORY_GIT_UNAVAILABLE',
                    failureClass: 'dependency-unavailable',
                    retryability: 'inspect-before-retry',
                    recoveryRequired: false,
                },
            };
        }
        return ports.gitListTrackedPaths(scopePath);
    }
    if (source === 'filesystem') {
        if (scopeIsFile) {
            return {
                ok: true,
                paths: Object.freeze([scopePath]),
                metadata: { engine: 'direct-file', enumeratedEntries: 1, protectedBranchesPruned: 0, symlinksPruned: 0 },
            };
        }
        const resolved = await workspace.resolveValidatedReadPath(scopePath);
        if (!resolved.ok) return { ok: false, message: resolved.reason, details: resolved };
        const inventory = await workspace.io.listRegularFilesFreshValidated(resolved.validatedReadPath, {
            workspaceRoot: workspace.workspaceRoot,
            ...(ports.signal ? { signal: ports.signal } : {}),
        });
        return {
            ok: true,
            paths: inventory.files,
            metadata: {
                engine: inventory.engine,
                enumeratedEntries: inventory.enumeratedEntries,
                protectedBranchesPruned: inventory.protectedBranchesPruned,
                symlinksPruned: inventory.symlinksPruned,
            },
        };
    }

    const indexStatus = workspace.indexRegistry.status();
    if (indexStatus.available !== true) {
        return {
            ok: false,
            message: 'Persistent repository index is unavailable for inventory.',
            details: {
                code: 'ERR_REPO_INVENTORY_INDEX_UNAVAILABLE',
                failureClass: 'dependency-unavailable',
                retryability: 'after-state-change',
                recoveryRequired: false,
                reason: indexStatus.reason ?? 'index-unavailable',
                hint: 'Build or recover the repository index, or use source=git/filesystem.',
            },
        };
    }
    const rows = workspace.indexRegistry.listFiles();
    return {
        ok: true,
        paths: rows.map((row) => row.filePath),
        metadata: {
            engine: 'persistent-io-index',
            freshness: indexStatus.freshness ?? null,
            indexedFiles: rows.length,
        },
    };
}

/**
 * @param {string} workspaceRoot
 * @param {string} scopePath
 * @param {readonly string[]} candidates
 * @param {AbortSignal | undefined} signal
 */
function normalizeVisibleInventoryPaths(workspaceRoot, scopePath, candidates, signal) {
    const unique = new Set();
    let redactedCandidateCount = 0;
    let duplicateCandidateCount = 0;
    for (const raw of candidates) {
        signal?.throwIfAborted();
        const candidate = normalizeWorkspaceRelativePath(workspaceRoot, raw);
        if (!candidate || !isPathWithinScope(candidate, scopePath)) continue;
        const policy = evaluateWorkspacePathPolicy(candidate, { workspaceRoot, mode: 'read' });
        if (!policy.ok) {
            redactedCandidateCount += 1;
            continue;
        }
        if (unique.has(candidate)) {
            duplicateCandidateCount += 1;
            continue;
        }
        unique.add(candidate);
    }
    const paths = [...unique].sort(compareInventoryPaths);
    return { paths, redactedCandidateCount, duplicateCandidateCount };
}

/**
 * @param {string} workspaceRoot
 * @param {string} scopePath
 * @param {string | undefined} cursor
 * @returns {{ok:true;cursor:string|null}|{ok:false;message:string;details:Record<string,unknown>}}
 */
function normalizeInventoryCursor(workspaceRoot, scopePath, cursor) {
    if (cursor === undefined || cursor === '') return { ok: true, cursor: /** @type {string|null} */ (null) };
    const normalized = normalizeWorkspaceRelativePath(workspaceRoot, cursor);
    const visible = normalized && isPathWithinScope(normalized, scopePath)
        ? evaluateWorkspacePathPolicy(normalized, { workspaceRoot, mode: 'read' }).ok
        : false;
    if (!normalized || !visible) {
        return {
            ok: false,
            message: 'Inventory cursor is outside the visible inventory scope.',
            details: {
                code: 'ERR_REPO_INVENTORY_CURSOR',
                failureClass: 'invalid-input',
                retryability: 'fix-input',
                recoveryRequired: false,
                hint: 'Use nextCursor returned by the same repo_inventory path/source scope, or omit cursor.',
            },
        };
    }
    return { ok: true, cursor: normalized };
}

/**
 * @param {readonly string[]} paths
 * @param {number} maxResults
 * @param {number} maxOutputBytes
 * @returns {{ok:true;paths:string[];contentBytes:number;nextCursor:string|null;truncated:boolean;truncationReason:string|null}|{ok:false;message:string;details:Record<string,unknown>}}
 */
function pageInventoryPaths(paths, maxResults, maxOutputBytes) {
    /** @type {string[]} */
    const selected = [];
    let contentBytes = 0;
    let stoppedAtOutputBudget = false;
    for (const candidate of paths) {
        if (selected.length >= maxResults) break;
        const contribution = Buffer.byteLength(candidate, 'utf8') + (selected.length > 0 ? 1 : 0);
        if (contentBytes + contribution > maxOutputBytes) {
            if (selected.length === 0) {
                return {
                    ok: false,
                    message: `First inventory path requires ${String(contribution)} UTF-8 bytes but maxOutputBytes is ${String(maxOutputBytes)}.`,
                    details: {
                        code: 'ERR_REPO_INVENTORY_PAGE_ITEM_TOO_LARGE',
                        failureClass: 'bounded-output-item-too-large',
                        retryability: 'manual-decision',
                        recoveryRequired: false,
                        requiredBytes: contribution,
                        maxOutputBytes,
                    },
                };
            }
            stoppedAtOutputBudget = true;
            break;
        }
        selected.push(candidate);
        contentBytes += contribution;
    }
    const truncated = selected.length < paths.length;
    const nextCursor = truncated ? selected[selected.length - 1] ?? null : null;
    return {
        ok: true,
        paths: selected,
        contentBytes,
        nextCursor,
        truncated,
        truncationReason: truncated ? (stoppedAtOutputBudget ? 'content-byte-budget' : 'entry-limit') : null,
    };
}

/** @param {readonly string[]} paths @param {string} scopePath */
function buildInventoryAggregates(paths, scopePath) {
    const extensionCounts = new Map();
    const topDirectoryCounts = new Map();
    let totalPathBytes = 0;
    for (const candidate of paths) {
        totalPathBytes += Buffer.byteLength(candidate, 'utf8');
        const extension = extname(candidate).toLowerCase() || '[none]';
        extensionCounts.set(extension, (extensionCounts.get(extension) ?? 0) + 1);
        const scoped = scopePath === '.' ? candidate : candidate === scopePath ? '' : candidate.slice(scopePath.length + 1);
        const firstSegment = scoped.includes('/') ? scoped.slice(0, scoped.indexOf('/')) : '[root]';
        topDirectoryCounts.set(firstSegment || '[root]', (topDirectoryCounts.get(firstSegment || '[root]') ?? 0) + 1);
    }
    return {
        visibleFiles: paths.length,
        totalPathBytes,
        extensionKindCount: extensionCounts.size,
        topExtensions: sortCountRows(extensionCounts).slice(0, MAX_AGGREGATE_ROWS),
        topDirectories: sortCountRows(topDirectoryCounts).slice(0, MAX_AGGREGATE_ROWS),
    };
}

/** @param {Map<string, number>} counts */
function sortCountRows(counts) {
    return [...counts.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || compareInventoryPaths(a.name, b.name));
}

/** @param {unknown} value @param {string} fallback */
function normalizeOptionalRepositoryPath(value, fallback) {
    if (value === undefined || value === null) return fallback;
    const text = String(value).trim();
    return text === '' ? fallback : text;
}

/** @param {string} workspaceRoot @param {unknown} value */
function normalizeWorkspaceRelativePath(workspaceRoot, value) {
    const raw = String(value ?? '').trim();
    if (!raw) return null;
    const relativePath = (isAbsolute(raw) ? relative(workspaceRoot, raw) : raw)
        .replace(/\\/gu, '/')
        .replace(/^\.\//u, '')
        .replace(/\/+$/u, '');
    if (relativePath === '') return '.';
    if (relativePath === '..' || relativePath.startsWith('../') || isAbsolute(relativePath)) return null;
    return relativePath;
}

/** @param {string} candidate @param {string} scopePath */
function isPathWithinScope(candidate, scopePath) {
    return scopePath === '.' || candidate === scopePath || candidate.startsWith(`${scopePath}/`);
}

/** @param {string} a @param {string} b */
function compareInventoryPaths(a, b) {
    return a < b ? -1 : a > b ? 1 : 0;
}
