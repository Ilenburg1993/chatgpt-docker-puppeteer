// @ts-check
/**
 * Protocol-neutral structured Git read service.
 *
 * Physical process execution stays in infra through execWorkspaceGit. This owner composes only fixed Git subcommands,
 * validates caller revision/path/search atoms and parses documented machine-readable formats.
 *
 * @module copilot/mcp/workspace/git/read-service
 */

import { evaluateWorkspacePathPolicy } from '#copilot/infra/public/policy';
import { isAbsolute } from 'node:path';

import { execWorkspaceGit } from './runtime.js';
import {
    normalizeGitPickaxe,
    normalizeGitRevision,
    parseGitBlameLinePorcelain,
    parseGitLogRecords,
    parseGitLsTreeZ,
    parseGitNameStatusZ,
    parseGitStatusPorcelainV2Z,
    parseGitWorktreePorcelainZ,
} from './read-model.js';

const DEFAULT_GIT_READ_MAX_BUFFER_BYTES = 4 * 1024 * 1024;
const MAX_GIT_READ_PATHS = 200;
const MAX_GIT_LOG_LIMIT = 200;
const MAX_GIT_BLAME_LINES = 500;
const LOG_FORMAT = '%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%P%x1f%s%x00';

/** @typedef {import('../contracts/capability.js').McpWorkspaceCapability} GitReadWorkspace */
/**
 * @typedef {Readonly<{
 *   workspace: GitReadWorkspace;
 *   config: import('./config.js').McpGitProcessConfig;
 *   signal?: AbortSignal;
 * }>} WorkspaceGitReadServiceOptions
 */

/** @param {WorkspaceGitReadServiceOptions} options */
export function createWorkspaceGitReadService(options) {
    if (!options?.workspace?.workspaceRoot) throw new TypeError('Git read service requires workspace authority.');
    if (!options.config) throw new TypeError('Git read service requires Git process config.');

    /** @param {string[]} args @param {{timeoutMs?:number;maxBufferBytes?:number}} [limits] */
    const exec = (args, limits = {}) =>
        execWorkspaceGit(args, {
            cwd: options.workspace.workspaceRoot,
            config: options.config,
            maxBufferBytes: limits.maxBufferBytes ?? DEFAULT_GIT_READ_MAX_BUFFER_BYTES,
            ...(limits.timeoutMs === undefined ? {} : { timeoutMs: limits.timeoutMs }),
            ...(options.signal ? { signal: options.signal } : {}),
        });

    /** @param {unknown} rawPaths */
    const paths = (rawPaths) => normalizeGitReadPaths(rawPaths, options.workspace.workspaceRoot);

    return Object.freeze({
        /** @param {{paths?:unknown}} [input] */
        async status(input = {}) {
            const resolvedPaths = paths(input.paths);
            const args = [
                '--literal-pathspecs',
                'status',
                '--porcelain=v2',
                '-z',
                '--branch',
                '--show-stash',
                '--untracked-files=all',
            ];
            appendPaths(args, resolvedPaths);
            const result = await exec(args);
            if (!result.success) return readFailure('status', result);
            return { ok: true, ...parseGitStatusPorcelainV2Z(result.stdout), paths: resolvedPaths };
        },

        /** @param {{staged?:boolean;base?:unknown;head?:unknown;paths?:unknown;view?:'patch'|'stat'|'name-status'}} [input] */
        async diff(input = {}) {
            const view = input.view ?? 'patch';
            const resolvedPaths = paths(input.paths);
            const range = normalizeOptionalGitRange(input.base, input.head);
            if (input.staged === true && range) {
                throw gitReadServiceError('ERR_GIT_DIFF_MODE', 'staged diff cannot be combined with base/head range.');
            }
            const args = ['--literal-pathspecs', 'diff'];
            if (input.staged === true) args.push('--cached');
            if (view === 'stat') args.push('--stat');
            else if (view === 'name-status') args.push('--name-status', '-z', '--find-renames=50%');
            if (range) args.push(range.base, range.head);
            appendPaths(args, resolvedPaths);
            const result = await exec(args);
            if (!result.success) return readFailure('diff', result);
            if (view === 'name-status') {
                return {
                    ok: true,
                    view,
                    changes: parseGitNameStatusZ(result.stdout).changes,
                    uncertain: parseGitNameStatusZ(result.stdout).uncertain,
                    staged: input.staged === true,
                    range,
                    paths: resolvedPaths,
                };
            }
            return {
                ok: true,
                view,
                output: result.stdout,
                staged: input.staged === true,
                range,
                paths: resolvedPaths,
            };
        },

        /** @param {{limit?:number;base?:unknown;head?:unknown;paths?:unknown;searchString?:unknown;searchRegex?:unknown}} [input] */
        async log(input = {}) {
            const limit = normalizeBoundedInteger(input.limit, 10, 1, MAX_GIT_LOG_LIMIT, 'limit');
            const range = normalizeOptionalGitRange(input.base, input.head);
            const resolvedPaths = paths(input.paths);
            if (input.searchString !== undefined && input.searchRegex !== undefined) {
                throw gitReadServiceError('ERR_GIT_LOG_SEARCH_MODE', 'searchString and searchRegex are mutually exclusive.');
            }
            const args = ['--literal-pathspecs', 'log', '-z', `--max-count=${String(limit)}`, `--format=${LOG_FORMAT}`];
            if (range) args.push(`${range.base}..${range.head}`);
            if (input.searchString !== undefined) args.push(`-S${normalizeGitPickaxe(input.searchString, 'searchString')}`);
            if (input.searchRegex !== undefined) args.push(`-G${normalizeGitPickaxe(input.searchRegex, 'searchRegex')}`);
            appendPaths(args, resolvedPaths);
            const result = await exec(args);
            if (!result.success) return readFailure('log', result);
            const parsed = parseGitLogRecords(result.stdout);
            return { ok: true, commits: parsed.commits, uncertain: parsed.uncertain, limit, range, paths: resolvedPaths };
        },

        /** @param {unknown} base @param {unknown} head */
        async mergeBase(base, head) {
            const range = normalizeRequiredGitRange(base, head);
            const result = await exec(['merge-base', range.base, range.head]);
            if (!result.success) return readFailure('merge-base', result);
            const hash = result.stdout.trim();
            if (!/^[0-9a-f]{7,64}$/iu.test(hash)) {
                return { ok: false, code: 'ERR_GIT_MERGE_BASE_PARSE', error: 'Git merge-base returned an invalid object id.' };
            }
            return { ok: true, base: range.base, head: range.head, mergeBase: hash };
        },

        /** @param {{base:unknown;head:unknown;paths?:unknown}} input */
        async changedFiles(input) {
            const range = normalizeRequiredGitRange(input.base, input.head);
            const resolvedPaths = paths(input.paths);
            const args = ['--literal-pathspecs', 'diff', '--name-status', '-z', '--find-renames=50%', range.base, range.head];
            appendPaths(args, resolvedPaths);
            const result = await exec(args);
            if (!result.success) return readFailure('changed-files', result);
            const parsed = parseGitNameStatusZ(result.stdout);
            return { ok: true, ...range, changes: parsed.changes, uncertain: parsed.uncertain, paths: resolvedPaths };
        },

        /** @param {{revision?:unknown;path?:unknown;maxBytes?:number}} [input] */
        async show(input = {}) {
            const revision = normalizeGitRevision(input.revision ?? 'HEAD');
            if (input.path === undefined) {
                const result = await exec(['show', '-s', '-z', `--format=${LOG_FORMAT}`, revision]);
                if (!result.success) return readFailure('show', result);
                const parsed = parseGitLogRecords(result.stdout);
                const commit = parsed.commits[0] ?? null;
                if (!commit) return { ok: false, code: 'ERR_GIT_SHOW_PARSE', error: 'Git show returned no commit metadata.' };
                return { ok: true, revision, kind: 'commit', commit, uncertain: parsed.uncertain };
            }
            const [filePath] = paths([input.path]);
            if (!filePath) throw gitReadServiceError('ERR_GIT_PATH', 'path is required for path-at-revision show.');
            const maxBytes = normalizeBoundedInteger(input.maxBytes, 512 * 1024, 1024, 4 * 1024 * 1024, 'maxBytes');
            const result = await exec(['cat-file', 'blob', `${revision}:${filePath}`], { maxBufferBytes: maxBytes });
            if (!result.success) return readFailure('show-path', result);
            if (result.stdout.includes('\u0000')) {
                return { ok: false, code: 'ERR_GIT_BINARY_BLOB', error: 'Path-at-revision content appears binary and is not returned as text.' };
            }
            return { ok: true, revision, kind: 'path', path: filePath, content: result.stdout, bytes: Buffer.byteLength(result.stdout) };
        },

        /** @param {{revision?:unknown;path?:unknown;recursive?:boolean;maxEntries?:number}} [input] */
        async tree(input = {}) {
            const revision = normalizeGitRevision(input.revision ?? 'HEAD');
            const resolvedPaths = input.path === undefined ? [] : paths([input.path]);
            const maxEntries = normalizeBoundedInteger(input.maxEntries, 200, 1, 2000, 'maxEntries');
            const args = ['--literal-pathspecs', 'ls-tree', '-z', '-l'];
            if (input.recursive === true) args.push('-r');
            args.push(revision);
            appendPaths(args, resolvedPaths);
            const result = await exec(args);
            if (!result.success) return readFailure('tree', result);
            const parsed = parseGitLsTreeZ(result.stdout);
            const entries = parsed.entries.slice(0, maxEntries);
            return {
                ok: true,
                revision,
                path: resolvedPaths[0] ?? null,
                recursive: input.recursive === true,
                entries,
                returnedCount: entries.length,
                totalCount: parsed.entries.length,
                truncated: parsed.entries.length > entries.length,
                uncertain: parsed.uncertain,
            };
        },

        /** @param {{revision?:unknown;path:unknown;startLine?:number;endLine?:number}} input */
        async blame(input) {
            const revision = normalizeGitRevision(input.revision ?? 'HEAD');
            const [filePath] = paths([input.path]);
            if (!filePath) throw gitReadServiceError('ERR_GIT_PATH', 'path is required for blame.');
            const startLine = normalizeBoundedInteger(input.startLine, 1, 1, Number.MAX_SAFE_INTEGER, 'startLine');
            const endLine = normalizeBoundedInteger(
                input.endLine,
                Math.min(Number.MAX_SAFE_INTEGER, startLine + 199),
                startLine,
                Math.min(Number.MAX_SAFE_INTEGER, startLine + MAX_GIT_BLAME_LINES - 1),
                'endLine',
            );
            const result = await exec([
                '--literal-pathspecs',
                'blame',
                '--line-porcelain',
                '-L',
                `${String(startLine)},${String(endLine)}`,
                revision,
                '--',
                filePath,
            ]);
            if (!result.success) return readFailure('blame', result);
            const parsed = parseGitBlameLinePorcelain(result.stdout);
            return { ok: true, revision, path: filePath, startLine, endLine, lines: parsed.lines, uncertain: parsed.uncertain };
        },

        async worktrees() {
            const result = await exec(['worktree', 'list', '--porcelain', '-z']);
            if (!result.success) return readFailure('worktrees', result);
            const parsed = parseGitWorktreePorcelainZ(result.stdout);
            return { ok: true, worktrees: parsed.worktrees, uncertain: parsed.uncertain };
        },
    });
}

/** @param {unknown} base @param {unknown} head */
function normalizeOptionalGitRange(base, head) {
    if (base === undefined && head === undefined) return null;
    if (base === undefined || head === undefined) {
        throw gitReadServiceError('ERR_GIT_RANGE', 'base and head must be supplied together.');
    }
    return normalizeRequiredGitRange(base, head);
}

/** @param {unknown} base @param {unknown} head */
function normalizeRequiredGitRange(base, head) {
    return Object.freeze({ base: normalizeGitRevision(base, 'base'), head: normalizeGitRevision(head, 'head') });
}

/** @param {unknown} value @param {string} workspaceRoot */
function normalizeGitReadPaths(value, workspaceRoot) {
    if (value === undefined || value === null) return Object.freeze([]);
    const rawPaths = Array.isArray(value) ? value : [value];
    if (rawPaths.length > MAX_GIT_READ_PATHS) {
        throw gitReadServiceError('ERR_GIT_PATHS_LIMIT', `At most ${String(MAX_GIT_READ_PATHS)} paths are allowed.`);
    }
    const normalized = [];
    const seen = new Set();
    for (const rawValue of rawPaths) {
        if (typeof rawValue !== 'string') throw gitReadServiceError('ERR_GIT_PATH', 'Git paths must be strings.');
        const candidate = rawValue.trim().replaceAll('\\', '/').replace(/^\.\//u, '').replace(/\/+$/u, '');
        if (
            !candidate ||
            candidate === '.' ||
            isAbsolute(candidate) ||
            candidate === '..' ||
            candidate.startsWith('../') ||
            candidate.includes('\u0000')
        ) {
            throw gitReadServiceError('ERR_GIT_PATH', `Invalid workspace-relative Git path '${rawValue}'.`);
        }
        const policy = evaluateWorkspacePathPolicy(candidate, { workspaceRoot, mode: 'read' });
        if (!policy.ok) throw gitReadServiceError('ERR_GIT_PATH_DENIED', `Git path '${rawValue}' is denied by workspace read policy.`);
        if (!seen.has(candidate)) {
            seen.add(candidate);
            normalized.push(candidate);
        }
    }
    return Object.freeze(normalized);
}

/** @param {string[]} args @param {readonly string[]} paths */
function appendPaths(args, paths) {
    if (paths.length > 0) args.push('--', ...paths);
}

/** @param {string} operation @param {import('./runtime.js').WorkspaceGitExecutionResult} result */
function readFailure(operation, result) {
    return Object.freeze({
        ok: false,
        code: 'ERR_GIT_READ_EXECUTION',
        operation,
        error: result.error ?? `Git ${operation} failed.`,
        exitCode: result.exitCode,
        signal: result.signal,
        cancelled: result.cancelled,
        timedOut: result.timedOut,
        outputLimitExceeded: result.outputLimitExceeded,
        stderr: result.stderr,
    });
}

/** @param {unknown} value @param {number} fallback @param {number} min @param {number} max @param {string} label */
function normalizeBoundedInteger(value, fallback, min, max, label) {
    const parsed = Number(value ?? fallback);
    if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
        throw gitReadServiceError('ERR_GIT_BOUND', `${label} must be an integer between ${String(min)} and ${String(max)}.`);
    }
    return parsed;
}

/** @param {string} code @param {string} message */
function gitReadServiceError(code, message) {
    const error = /** @type {TypeError & {code?:string}} */ (new TypeError(message));
    error.code = code;
    return error;
}
