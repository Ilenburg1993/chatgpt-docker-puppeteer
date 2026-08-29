// @ts-check
/**
 * Canonical governed workspace-entry walker for read-only filesystem enumeration.
 *
 * This is the single owner for physical directory traversal used by higher-level inventory/tree projections. It never
 * follows symlinks, applies the canonical workspace read policy before exposing a candidate, keeps traversal bounded,
 * and returns only workspace-relative paths. Callers may select/filter projections without reimplementing filesystem
 * walking or path-policy checks.
 *
 * @module copilot/infra/filesystem/read/walk
 */

import {
    assertValidIoFilePath,
    evaluateWorkspacePathPolicy,
    normalizeWorkspaceRoot,
} from '#copilot/infra/internal/policy';
import { readdir } from 'node:fs/promises';
import { basename, matchesGlob, relative, resolve } from 'node:path';

const DEFAULT_WALK_HARD_MAX_ENTRIES = 100_000;
const MAX_WALK_DEPTH = 1024;

/** @typedef {'file'|'directory'|'symlink'|'other'} WorkspaceWalkEntryType */
/** @typedef {{name:string;type:WorkspaceWalkEntryType;path:string;depth:number}} WorkspaceWalkEntry */

/**
 * @typedef {{
 *   workspaceRoot?: string;
 *   recursive?: boolean;
 *   depth?: number;
 *   showHidden?: boolean;
 *   includeSymlinks?: boolean;
 *   includePattern?: string;
 *   excludePattern?: string;
 *   hardMaxEntries?: number;
 *   signal?: AbortSignal;
 * }} WorkspaceWalkOptions
 */

/**
 * @param {string} rootPath
 * @param {WorkspaceWalkOptions} [options]
 */
export async function walkWorkspaceEntriesFresh(rootPath, options = {}) {
    assertValidIoFilePath(rootPath, 'rootPath');
    options.signal?.throwIfAborted();
    const resolvedRoot = resolve(rootPath);
    const workspaceRoot = normalizeWorkspaceRoot(options.workspaceRoot ?? resolvedRoot);
    const recursive = options.recursive === true;
    const depth = resolveWalkDepth(options.depth, recursive);
    const showHidden = options.showHidden === true;
    const includeSymlinks = options.includeSymlinks === true;
    const hardMaxEntries = normalizeHardMaxEntries(options.hardMaxEntries);
    validateWalkPatterns(options.includePattern, options.excludePattern);

    /** @type {{directory:string;depth:number}[]} */
    const pending = [{ directory: resolvedRoot, depth: 0 }];
    /** @type {WorkspaceWalkEntry[]} */
    const entries = [];
    const protectedPaths = new Set();
    const hiddenPaths = new Set();
    const symlinkPaths = new Set();
    let visitedEntries = 0;
    let userExcludedEntries = 0;

    while (pending.length > 0) {
        options.signal?.throwIfAborted();
        const current = pending.shift();
        if (!current) break;
        const children = await readdir(current.directory, { withFileTypes: true });
        children.sort((left, right) => compareWorkspacePaths(left.name, right.name));

        for (const child of children) {
            options.signal?.throwIfAborted();
            visitedEntries += 1;
            if (visitedEntries > hardMaxEntries) {
                throw Object.assign(
                    new Error(`Workspace traversal exceeded ${String(hardMaxEntries)} visited entries.`),
                    {
                        code: 'ERR_WORKSPACE_WALK_LIMIT',
                        hardMaxEntries,
                        visitedEntries,
                    },
                );
            }

            const absolutePath = resolve(current.directory, child.name);
            const entryDepth = current.depth + 1;
            if (!showHidden && child.name.startsWith('.')) {
                hiddenPaths.add(absolutePath);
                continue;
            }

            const policy = evaluateWorkspacePathPolicy(absolutePath, { workspaceRoot, mode: 'read' });
            if (!policy.ok) {
                protectedPaths.add(absolutePath);
                continue;
            }

            const workspaceRelative = normalizeRelativePath(relative(workspaceRoot, absolutePath));
            const scopeRelative = normalizeRelativePath(relative(resolvedRoot, absolutePath));
            if (!workspaceRelative || !scopeRelative) continue;

            const type = classifyDirent(child);
            const excluded = matchesOptionalWalkPattern(scopeRelative, options.excludePattern);
            const included = !options.includePattern || matchesWalkPattern(scopeRelative, options.includePattern);
            if (excluded) userExcludedEntries += 1;

            if (type === 'symlink') {
                symlinkPaths.add(absolutePath);
                if (includeSymlinks && included && !excluded) {
                    entries.push({ name: child.name, type, path: workspaceRelative, depth: entryDepth });
                }
                continue;
            }

            if (included && !excluded) {
                entries.push({ name: child.name, type, path: workspaceRelative, depth: entryDepth });
            }

            if (type === 'directory' && recursive && entryDepth < depth && !excluded) {
                pending.push({ directory: absolutePath, depth: entryDepth });
            }
        }
    }

    entries.sort((left, right) => compareWorkspacePaths(left.path, right.path));
    return Object.freeze({
        entries: Object.freeze(entries),
        entryCount: entries.length,
        visitedEntries,
        protectedEntriesPruned: protectedPaths.size,
        hiddenEntriesPruned: hiddenPaths.size,
        symlinksObserved: symlinkPaths.size,
        userExcludedEntries,
        recursive,
        depth,
        engine: 'node:fs/promises.readdir',
        traversal: 'iterative-directory-walk',
        symlinkTraversal: 'disabled',
        pathProjection: 'workspace-relative-only',
    });
}

/** @param {number | undefined} value @param {boolean} recursive */
function resolveWalkDepth(value, recursive) {
    if (!recursive) return 1;
    if (value === undefined) return MAX_WALK_DEPTH;
    const parsed = Math.trunc(Number(value));
    if (!Number.isFinite(parsed) || parsed < 1) return 1;
    return Math.min(MAX_WALK_DEPTH, parsed);
}

/** @param {number | undefined} value */
function normalizeHardMaxEntries(value) {
    if (value === undefined) return DEFAULT_WALK_HARD_MAX_ENTRIES;
    const parsed = Math.trunc(Number(value));
    if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_WALK_HARD_MAX_ENTRIES;
    return Math.min(Number.MAX_SAFE_INTEGER, parsed);
}

/** @param {import('node:fs').Dirent} entry @returns {WorkspaceWalkEntryType} */
function classifyDirent(entry) {
    if (entry.isFile()) return 'file';
    if (entry.isDirectory()) return 'directory';
    if (entry.isSymbolicLink()) return 'symlink';
    return 'other';
}

/** @param {string} value */
function normalizeRelativePath(value) {
    const normalized = value.replace(/\\/gu, '/').replace(/^\.\//u, '').replace(/\/+$/u, '');
    if (!normalized || normalized === '..' || normalized.startsWith('../')) return '';
    return normalized;
}

/** @param {string | undefined} includePattern @param {string | undefined} excludePattern */
function validateWalkPatterns(includePattern, excludePattern) {
    for (const [kind, pattern] of [
        ['include', includePattern],
        ['exclude', excludePattern],
    ]) {
        if (!pattern) continue;
        try {
            matchesWalkPattern('__mcp_glob_probe__', pattern);
        } catch (error) {
            throw Object.assign(new Error(`Invalid workspace ${kind} glob pattern.`), {
                code: 'ERR_WORKSPACE_WALK_GLOB_PATTERN',
                kind,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }
}

/** @param {string} value @param {string | undefined} pattern */
function matchesOptionalWalkPattern(value, pattern) {
    return pattern ? matchesWalkPattern(value, pattern) : false;
}

/** @param {string} value @param {string} pattern */
function matchesWalkPattern(value, pattern) {
    return matchesGlob(value, pattern) || (!pattern.includes('/') && matchesGlob(basename(value), pattern));
}

/** @param {string} a @param {string} b */
function compareWorkspacePaths(a, b) {
    return a < b ? -1 : a > b ? 1 : 0;
}
