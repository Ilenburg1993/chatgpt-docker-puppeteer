// @ts-check
/**
 * Structured read-only Git MCP tools.
 *
 * Tools own wire schema/result semantics only. Revision/path grammar and documented Git machine formats live in the
 * workspace Git read model/service; physical subprocess execution lives in infra/process through execWorkspaceGit.
 *
 * @module copilot/mcp/tools/git-read
 */

import { defineMcpRawTool } from '#copilot/mcp/public/protocol/catalog';
import {
    errorResult,
    okResult,
    requireMcpToolGitConfig,
    requireMcpToolWorkspace,
} from '#copilot/mcp/public/protocol/tools';
import { createWorkspaceGitReadService, execWorkspaceGit as execGit } from '#copilot/mcp/public/workspace/git';
import { z } from 'zod';

const pathSchema = z.string().min(1).max(2048);
const pathsSchema = z.array(pathSchema).min(1).max(200);
const revisionSchema = z.string().min(1).max(256);

const gitStatusBranchSchema = z.object({
    oid: z.string().nullable(),
    head: z.string().nullable(),
    upstream: z.string().nullable(),
    ahead: z.number().int().min(0),
    behind: z.number().int().min(0),
    stashCount: z.number().int().min(0),
});
const gitStatusEntrySchema = z.object({
    kind: z.enum(['ordinary', 'renamed', 'unmerged', 'untracked', 'ignored']),
    path: z.string(),
    indexStatus: z.string(),
    worktreeStatus: z.string(),
    submodule: z.string().nullable(),
    originalPath: z.string().optional(),
    score: z.number().int().nullable().optional(),
});
const gitNameStatusChangeSchema = z.object({
    status: z.string(),
    code: z.string(),
    path: z.string(),
    oldPath: z.string().optional(),
    score: z.number().int().nullable().optional(),
    deleted: z.boolean(),
});
const gitCommitSchema = z.object({
    hash: z.string(),
    shortHash: z.string(),
    authorName: z.string(),
    authorEmail: z.string(),
    authoredAt: z.string(),
    parents: z.array(z.string()),
    subject: z.string(),
});

const gitStatusOutputSchema = z.object({
    success: z.literal(true),
    status: z.string(),
    branch: gitStatusBranchSchema,
    entries: z.array(gitStatusEntrySchema),
    counts: z.object({
        changed: z.number().int().min(0),
        unmerged: z.number().int().min(0),
        untracked: z.number().int().min(0),
        ignored: z.number().int().min(0),
    }),
    uncertain: z.boolean(),
});
const gitDiffOutputSchema = z.object({
    success: z.literal(true),
    diff: z.string(),
    staged: z.boolean(),
    path: z.string().nullable(),
    paths: z.array(z.string()),
    view: z.enum(['patch', 'stat', 'name-status']),
    base: z.string().nullable(),
    head: z.string().nullable(),
    changes: z.array(gitNameStatusChangeSchema),
    uncertain: z.boolean(),
});
const gitLogOutputSchema = z.object({
    success: z.literal(true),
    log: z.string(),
    limit: z.number().int().min(1).max(200),
    commits: z.array(gitCommitSchema),
    base: z.string().nullable(),
    head: z.string().nullable(),
    paths: z.array(z.string()),
    uncertain: z.boolean(),
});
const gitBranchInfoOutputSchema = z.object({
    success: z.literal(true),
    branch: z.string(),
    upstream: z.string().nullable(),
    head: z.string(),
});

/** @param {import('#copilot/mcp/public/protocol/tools').McpToolOperationContext | undefined} operationContext */
function createGitReadRuntime(operationContext) {
    const workspace = requireMcpToolWorkspace(operationContext);
    const config = requireMcpToolGitConfig(operationContext);
    /** @param {string[]} args @param {{ timeoutMs?: number; maxBufferBytes?: number }} [options] */
    const exec = (args, options = {}) =>
        execGit(args, {
            ...options,
            cwd: workspace.workspaceRoot,
            config,
            ...(operationContext?.signal ? { signal: operationContext.signal } : {}),
        });
    const service = createWorkspaceGitReadService({
        workspace,
        config,
        ...(operationContext?.signal ? { signal: operationContext.signal } : {}),
    });
    return Object.freeze({ exec, service });
}

/**
 * @param {string} code
 * @param {string} hint
 * @param {{ name: string; result: Awaited<ReturnType<ReturnType<typeof createGitReadRuntime>['exec']>> }[]} reads
 * @param {Record<string, unknown>} [extra]
 */
function gitReadFailureDetails(code, hint, reads, extra = {}) {
    const failedReads = reads
        .filter(({ result }) => result.success !== true)
        .map(({ name, result }) => ({
            name,
            exitCode: result.exitCode,
            timedOut: result.timedOut,
            cancelled: result.cancelled,
            outputLimitExceeded: result.outputLimitExceeded,
            stderr: result.stderr,
        }));
    return {
        ...extra,
        code,
        failureClass: 'git-read',
        retryability: 'inspect-before-retry',
        recoveryRequired: false,
        failedReads,
        hint,
    };
}

/** @param {unknown} error @param {string} fallbackCode @param {string} hint */
function gitInputOrServiceError(error, fallbackCode, hint) {
    const record = /** @type {{code?:unknown;message?:unknown}} */ (error ?? {});
    return errorResult(error instanceof Error ? error.message : String(error), {
        code: typeof record.code === 'string' ? record.code : fallbackCode,
        failureClass: 'git-read',
        retryability: 'fix-input',
        recoveryRequired: false,
        hint,
    });
}

/** @param {Record<string, unknown>} failure @param {string} code @param {string} hint */
function gitServiceFailure(failure, code, hint) {
    return errorResult(String(failure['error'] ?? 'Git read failed.'), {
        ...failure,
        code,
        failureClass: 'git-read',
        retryability: 'inspect-before-retry',
        recoveryRequired: false,
        hint,
    });
}

/** @param {string | undefined} path @param {string[] | undefined} paths */
function selectPaths(path, paths) {
    if (path !== undefined && paths !== undefined) {
        const error = new TypeError('path and paths are mutually exclusive.');
        /** @type {{code?:string}} */ (error).code = 'ERR_GIT_PATH_SHAPE';
        throw error;
    }
    return paths ?? (path === undefined ? undefined : [path]);
}

/** @param {readonly {indexStatus:string;worktreeStatus:string;path:string;originalPath?:string}[]} entries */
function formatStructuredStatus(entries) {
    return entries
        .map((entry) => {
            const xy = `${entry.indexStatus}${entry.worktreeStatus}`;
            return entry.originalPath ? `${xy} ${entry.originalPath} -> ${entry.path}` : `${xy} ${entry.path}`;
        })
        .join('\n');
}

/** @param {readonly {status:string;path:string;oldPath?:string}[]} changes */
function formatNameStatus(changes) {
    return changes
        .map((change) => (change.oldPath ? `${change.status}\t${change.oldPath}\t${change.path}` : `${change.status}\t${change.path}`))
        .join('\n');
}

/**
 * @type {import('#copilot/mcp/public/protocol/catalog').McpRawToolDefinition[]}
 */
export const gitReadTools = [
    defineMcpRawTool({
        name: 'git_status',
        title: 'Git status',
        description: 'Return machine-parsed porcelain-v2 Git status with branch/upstream/ahead/behind and path states.',
        inputSchema: {
            path: pathSchema.optional()['describe']('Optional single workspace-relative path filter.'),
            paths: pathsSchema.optional()['describe']('Optional explicit workspace-relative path filters; mutually exclusive with path.'),
        },
        outputSchema: gitStatusOutputSchema,
        handler: async ({ path, paths }, operationContext) => {
            try {
                const selectedPaths = selectPaths(path, paths);
                const result = await createGitReadRuntime(operationContext).service.status({ paths: selectedPaths });
                if (!result.ok) {
                    return gitServiceFailure(result, 'ERR_GIT_STATUS_FAILED', 'Confirm the workspace Git repository and requested paths are readable.');
                }
                const counts = {
                    changed: result.entries.filter((entry) => entry.kind === 'ordinary' || entry.kind === 'renamed').length,
                    unmerged: result.entries.filter((entry) => entry.kind === 'unmerged').length,
                    untracked: result.entries.filter((entry) => entry.kind === 'untracked').length,
                    ignored: result.entries.filter((entry) => entry.kind === 'ignored').length,
                };
                const status = formatStructuredStatus(result.entries);
                return okResult(
                    { success: true, status, branch: result.branch, entries: result.entries, counts, uncertain: result.uncertain },
                    status || '(clean)',
                );
            } catch (error) {
                return gitInputOrServiceError(error, 'ERR_GIT_STATUS_INPUT', 'Fix the path filter or retry after inspecting Git state.');
            }
        },
    }),
    defineMcpRawTool({
        name: 'git_diff',
        title: 'Git diff',
        description: 'Read bounded Git patch/stat/name-status for working tree, staged state, or a validated base/head range.',
        inputSchema: {
            staged: z.boolean().optional()['describe']('If true, compare the index to HEAD; cannot be combined with base/head.'),
            path: pathSchema.optional()['describe']('Optional single workspace-relative path filter.'),
            paths: pathsSchema.optional()['describe']('Optional explicit path filters; mutually exclusive with path.'),
            base: revisionSchema.optional()['describe']('Validated base revision atom; must be paired with head.'),
            head: revisionSchema.optional()['describe']('Validated head revision atom; must be paired with base.'),
            view: z.enum(['patch', 'stat', 'name-status']).optional()['describe']('Projection. Default: patch.'),
        },
        outputSchema: gitDiffOutputSchema,
        handler: async ({ staged, path, paths, base, head, view }, operationContext) => {
            try {
                const selectedPaths = selectPaths(path, paths);
                const result = await createGitReadRuntime(operationContext).service.diff({
                    ...(staged === undefined ? {} : { staged }),
                    ...(selectedPaths === undefined ? {} : { paths: selectedPaths }),
                    ...(base === undefined ? {} : { base }),
                    ...(head === undefined ? {} : { head }),
                    ...(view === undefined ? {} : { view }),
                });
                if (!result.ok) {
                    return gitServiceFailure(result, 'ERR_GIT_DIFF_FAILED', 'Check the revisions/path filters and confirm Git can read the requested diff.');
                }
                const changes = 'changes' in result ? result.changes : [];
                const uncertain = 'uncertain' in result ? result.uncertain : false;
                const diff = 'output' in result ? result.output : formatNameStatus(changes);
                const structured = {
                    success: true,
                    diff,
                    staged: result.staged,
                    path: result.paths.length === 1 ? (result.paths[0] ?? null) : null,
                    paths: result.paths,
                    view: result.view,
                    base: result.range?.base ?? null,
                    head: result.range?.head ?? null,
                    changes,
                    uncertain,
                };
                return okResult(structured, diff);
            } catch (error) {
                return gitInputOrServiceError(error, 'ERR_GIT_DIFF_INPUT', 'Use separate base/head revision atoms and explicit workspace-relative path filters.');
            }
        },
    }),
    defineMcpRawTool({
        name: 'git_log',
        title: 'Git log',
        description: 'Return structured commit history with bounded range/path filters and optional -S/-G pickaxe search.',
        inputSchema: {
            limit: z.number().int().min(1).max(200).optional()['describe']('Maximum commits. Default: 10.'),
            path: pathSchema.optional()['describe']('Optional single workspace-relative path filter.'),
            paths: pathsSchema.optional()['describe']('Optional explicit path filters; mutually exclusive with path.'),
            base: revisionSchema.optional()['describe']('Validated range base; must be paired with head.'),
            head: revisionSchema.optional()['describe']('Validated range head; must be paired with base.'),
            searchString: z.string().min(1).max(1024).optional()['describe']('Bounded Git -S pickaxe string.'),
            searchRegex: z.string().min(1).max(1024).optional()['describe']('Bounded Git -G pickaxe regex; mutually exclusive with searchString.'),
        },
        outputSchema: gitLogOutputSchema,
        handler: async ({ limit, path, paths, base, head, searchString, searchRegex }, operationContext) => {
            try {
                const selectedPaths = selectPaths(path, paths);
                const result = await createGitReadRuntime(operationContext).service.log({
                    ...(limit === undefined ? {} : { limit }),
                    ...(selectedPaths === undefined ? {} : { paths: selectedPaths }),
                    ...(base === undefined ? {} : { base }),
                    ...(head === undefined ? {} : { head }),
                    ...(searchString === undefined ? {} : { searchString }),
                    ...(searchRegex === undefined ? {} : { searchRegex }),
                });
                if (!result.ok) {
                    return gitServiceFailure(result, 'ERR_GIT_LOG_FAILED', 'Check the range/search/path filters and confirm Git can read commit history.');
                }
                const log = result.commits.map((commit) => `${commit.shortHash} ${commit.subject}`).join('\n');
                return okResult(
                    {
                        success: true,
                        log,
                        limit: result.limit,
                        commits: result.commits,
                        base: result.range?.base ?? null,
                        head: result.range?.head ?? null,
                        paths: result.paths,
                        uncertain: result.uncertain,
                    },
                    log,
                );
            } catch (error) {
                return gitInputOrServiceError(error, 'ERR_GIT_LOG_INPUT', 'Use bounded search values, paired base/head and explicit workspace-relative paths.');
            }
        },
    }),
    defineMcpRawTool({
        name: 'git_branch_info',
        title: 'Git branch info',
        description: 'Return current branch and upstream tracking information.',
        inputSchema: {},
        outputSchema: gitBranchInfoOutputSchema,
        handler: async (_args, operationContext) => {
            const git = createGitReadRuntime(operationContext);
            const [branch, upstream, head] = await Promise.all([
                git.exec(['branch', '--show-current']),
                git.exec(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']),
                git.exec(['rev-parse', '--short', 'HEAD']),
            ]);
            const requiredFailures = [
                { name: 'branch', result: branch },
                { name: 'head', result: head },
            ].filter(({ result }) => result.success !== true);
            if (requiredFailures.length > 0) {
                return errorResult(
                    'Git branch information could not be read reliably.',
                    gitReadFailureDetails(
                        'ERR_GIT_BRANCH_INFO_FAILED',
                        'branch and HEAD are required; upstream remains optional for branches without tracking.',
                        requiredFailures,
                    ),
                );
            }
            const structured = {
                success: true,
                branch: branch.stdout.trim(),
                upstream: upstream.success ? upstream.stdout.trim() : null,
                head: head.stdout.trim(),
            };
            return okResult(structured, JSON.stringify(structured, null, 2));
        },
    }),
    defineMcpRawTool({
        name: 'git_inspect',
        title: 'Git forensic inspect',
        description: 'Read structured merge-base, changed-files, commit/path-at-revision, tree, blame or worktree evidence without arbitrary Git argv.',
        inputSchema: {
            view: z.enum(['merge-base', 'changed-files', 'show', 'tree', 'blame', 'worktrees']),
            base: revisionSchema.optional(),
            head: revisionSchema.optional(),
            revision: revisionSchema.optional(),
            path: pathSchema.optional(),
            paths: pathsSchema.optional(),
            startLine: z.number().int().min(1).optional(),
            endLine: z.number().int().min(1).optional(),
            maxBytes: z.number().int().min(1024).max(4 * 1024 * 1024).optional(),
            recursive: z.boolean().optional(),
            maxEntries: z.number().int().min(1).max(2000).optional(),
        },
        handler: async (input, operationContext) => {
            try {
                const service = createGitReadRuntime(operationContext).service;
                let result;
                if (input.view === 'merge-base') {
                    assertAllowedInspectFields(input, ['view', 'base', 'head']);
                    result = await service.mergeBase(input.base, input.head);
                } else if (input.view === 'changed-files') {
                    assertAllowedInspectFields(input, ['view', 'base', 'head', 'path', 'paths']);
                    result = await service.changedFiles({
                        base: input.base,
                        head: input.head,
                        paths: selectPaths(input.path, input.paths),
                    });
                } else if (input.view === 'show') {
                    assertAllowedInspectFields(input, ['view', 'revision', 'path', 'maxBytes']);
                    result = await service.show({
                        ...(input.revision === undefined ? {} : { revision: input.revision }),
                        ...(input.path === undefined ? {} : { path: input.path }),
                        ...(input.maxBytes === undefined ? {} : { maxBytes: input.maxBytes }),
                    });
                } else if (input.view === 'tree') {
                    assertAllowedInspectFields(input, ['view', 'revision', 'path', 'recursive', 'maxEntries']);
                    result = await service.tree({
                        ...(input.revision === undefined ? {} : { revision: input.revision }),
                        ...(input.path === undefined ? {} : { path: input.path }),
                        ...(input.recursive === undefined ? {} : { recursive: input.recursive }),
                        ...(input.maxEntries === undefined ? {} : { maxEntries: input.maxEntries }),
                    });
                } else if (input.view === 'blame') {
                    assertAllowedInspectFields(input, ['view', 'revision', 'path', 'startLine', 'endLine']);
                    if (!input.path) throw codedTypeError('ERR_GIT_BLAME_PATH_REQUIRED', 'path is required for blame.');
                    result = await service.blame({
                        path: input.path,
                        ...(input.revision === undefined ? {} : { revision: input.revision }),
                        ...(input.startLine === undefined ? {} : { startLine: input.startLine }),
                        ...(input.endLine === undefined ? {} : { endLine: input.endLine }),
                    });
                } else {
                    assertAllowedInspectFields(input, ['view']);
                    result = await service.worktrees();
                }
                if (!result.ok) {
                    return gitServiceFailure(result, 'ERR_GIT_INSPECT_FAILED', 'Inspect the requested revisions/path/view and retry only after correcting the failed evidence read.');
                }
                return okResult({ success: true, view: input.view, ...result }, JSON.stringify({ view: input.view, ...result }, null, 2));
            } catch (error) {
                return gitInputOrServiceError(error, 'ERR_GIT_INSPECT_INPUT', 'Use only fields documented for the selected git_inspect view.');
            }
        },
    }),
];

/** @param {Record<string, unknown>} input @param {readonly string[]} allowed */
function assertAllowedInspectFields(input, allowed) {
    const allowedSet = new Set(allowed);
    const extra = Object.entries(input)
        .filter(([key, value]) => value !== undefined && !allowedSet.has(key))
        .map(([key]) => key);
    if (extra.length > 0) throw codedTypeError('ERR_GIT_INSPECT_SHAPE', `Fields not valid for ${String(input['view'])}: ${extra.join(', ')}.`);
}

/** @param {string} code @param {string} message */
function codedTypeError(code, message) {
    const error = /** @type {TypeError & {code?:string}} */ (new TypeError(message));
    error.code = code;
    return error;
}
