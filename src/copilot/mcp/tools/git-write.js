// @ts-check
/**
 * Governed Git mutation tools for the MCP connector.
 *
 * The surface deliberately does not expose arbitrary Git commands, remotes, refspecs or force flags. Stage operations
 * are path-bounded, commits are HEAD-preconditioned, and pushes use only the already-configured upstream.
 *
 * @module copilot/mcp/tools/git-write
 */

// @ts-check
/**
 * Governed Git mutation tools for the MCP connector.
 *
 * The surface deliberately does not expose arbitrary Git commands, remotes, refspecs or force flags. Stage operations
 * are path-bounded, commits are HEAD-preconditioned, and pushes use only the already-configured upstream.
 *
 * @module copilot/mcp/tools/git-write
 */

import { defineMcpRawTool } from '#copilot/mcp/public/protocol/catalog';
import {
    errorResult,
    okResult,
    requireMcpToolAuditCapability,
    requireMcpToolGitConfig,
    requireMcpToolWorkspace,
    withResultExecutionHint,
} from '#copilot/mcp/public/protocol/tools';
import { execWorkspaceGit as execGit } from '#copilot/mcp/public/workspace/git';
import { z } from 'zod';

const MAX_STAGE_PATHS = 200;
const MAX_STAGE_FILES = 500;
const MAX_COMMIT_MESSAGE_CHARS = 4000;
const HEAD_RE = /^[0-9a-f]{7,64}$/iu;
const PATHSPEC_MAGIC_RE = /^(?::|[-])|[*?[\]{}!]/u;

/** @typedef {import('#copilot/mcp/public/workspace').McpWorkspaceCapability} GitWriteWorkspaceCapability */
/** @typedef {{ timeoutMs?: number; maxBufferBytes?: number }} GitWriteExecOptions */
/** @typedef {(args: string[], options?: GitWriteExecOptions) => ReturnType<typeof execGit>} GitWriteExec */
/** @typedef {Readonly<{ workspace: GitWriteWorkspaceCapability; exec: GitWriteExec; audit: NonNullable<import('#copilot/mcp/public/protocol/tools').McpToolCapabilityProjection['audit']> }>} GitWriteRuntime */

/**
 * @param {import('#copilot/mcp/public/protocol/tools').McpToolOperationContext | undefined} operationContext
 * @returns {GitWriteRuntime}
 */
function createGitWriteRuntime(operationContext) {
    const workspace = requireMcpToolWorkspace(operationContext);
    const config = requireMcpToolGitConfig(operationContext);
    /** @type {GitWriteExec} */
    const exec = (args, options = {}) =>
        execGit(args, {
            ...options,
            cwd: workspace.workspaceRoot,
            config,
            ...(operationContext?.signal ? { signal: operationContext.signal } : {}),
        });
    return Object.freeze({ workspace, exec, audit: requireMcpToolAuditCapability(operationContext) });
}

const explicitPathsSchema = z
    .array(z.string().min(1).max(1024))
    .min(1)
    .max(MAX_STAGE_PATHS)
    ['describe'](
        'Explicit workspace-relative paths. Git pathspec magic, globs, option-like values and implicit dot are rejected.',
    );

/** @param {GitWriteRuntime} runtime @returns {Promise<string | null>} */
async function readHead(runtime) {
    const result = await runtime.exec(['rev-parse', 'HEAD']);
    return result.success ? result.stdout.trim() || null : null;
}

/** @param {GitWriteRuntime} runtime @returns {Promise<string | null>} */
async function readBranch(runtime) {
    const result = await runtime.exec(['branch', '--show-current']);
    return result.success ? result.stdout.trim() || null : null;
}

/** @param {GitWriteRuntime} runtime @returns {Promise<string | null>} */
async function readUpstream(runtime) {
    const result = await runtime.exec(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']);
    return result.success ? result.stdout.trim() || null : null;
}

/** @param {string | undefined} expectedHead @param {string | null} actualHead */
function validateExpectedHead(expectedHead, actualHead) {
    if (!expectedHead) return null;
    if (!HEAD_RE.test(expectedHead)) return `Invalid expectedHead '${expectedHead}'.`;
    if (!actualHead || !actualHead.startsWith(expectedHead.toLowerCase())) {
        return `HEAD precondition failed: expected ${expectedHead}, actual ${actualHead ?? 'unavailable'}.`;
    }
    return null;
}

/**
 * @param {GitWriteRuntime} runtime
 * @param {string[]} paths
 * @returns {Promise<{ ok: true; paths: string[] } | { ok: false; error: string; path?: string }>}
 */
async function normalizeExplicitPaths(runtime, paths) {
    const normalized = [];
    const seen = new Set();
    for (const rawValue of paths) {
        const raw = rawValue.trim().replaceAll('\\', '/');
        if (!raw || raw === '.' || raw === './') {
            return {
                ok: false,
                error: 'Implicit workspace-wide staging is not allowed; provide explicit paths.',
                path: rawValue,
            };
        }
        if (PATHSPEC_MAGIC_RE.test(raw)) {
            return {
                ok: false,
                error: 'Git pathspec magic, globbing and option-like path values are not allowed.',
                path: rawValue,
            };
        }
        const resolved = await runtime.workspace.resolveWritePath(raw);
        if (!resolved.ok) return { ok: false, error: resolved.reason, path: rawValue };
        if (resolved.relative === '.' || resolved.relative.startsWith('../')) {
            return { ok: false, error: 'Path must resolve to a concrete target inside the workspace.', path: rawValue };
        }
        const relative = resolved.relative.replaceAll('\\', '/');
        if (!seen.has(relative)) {
            seen.add(relative);
            normalized.push(relative);
        }
    }
    return { ok: true, paths: normalized };
}

/**
 * Git records only an executable/non-executable bit, not the full POSIX mode. This guard identifies the narrow
 * regression produced by an atomic replacement that accidentally recreated a tracked executable script without any
 * x-bit.
 *
 * @param {{ headMode: string; currentMode: number; hasShebang: boolean }} input
 */
export function isAccidentalExecutableModeDrift(input) {
    return input.headMode === '100755' && (input.currentMode & 0o111) === 0 && input.hasShebang;
}

/** @param {GitWriteRuntime} runtime @param {string} filePath */
async function fileHasShebang(runtime, filePath) {
    const snapshot = await runtime.workspace.io.readBytesRangeFresh(filePath, { start: 0, maxBytes: 2 });
    return snapshot.bytesRead === 2 && snapshot.content[0] === 0x23 && snapshot.content[1] === 0x21;
}

/**
 * @param {GitWriteRuntime} runtime
 * @param {string[]} paths
 * @returns {Promise<{ path: string; headMode: string; currentMode: number; targetMode: number }[]>}
 */
async function inspectAccidentalExecutableModeDrift(runtime, paths) {
    const tracked = await runtime.exec(['ls-files', '--stage', '-z', '--', ...paths], {
        maxBufferBytes: 4 * 1024 * 1024,
    });
    if (!tracked.success || !tracked.stdout) return [];
    const rows = [];
    for (const record of tracked.stdout.split('\0').filter(Boolean)) {
        const match = /^(\d{6})\s+[0-9a-f]+\s+\d+\t(.+)$/iu.exec(record);
        if (!match) continue;
        const headMode = match[1];
        const relative = match[2];
        if (headMode !== '100755' || !relative) continue;
        const resolved = await runtime.workspace.resolveWritePath(relative);
        if (!resolved.ok) continue;
        let stats;
        try {
            stats = (await runtime.workspace.io.statPath(resolved.resolved)).stats;
        } catch {
            continue;
        }
        if (!stats.isFile()) continue;
        const currentMode = stats.mode & 0o777;
        if ((currentMode & 0o111) !== 0) continue;
        let hasShebang;
        try {
            hasShebang = await fileHasShebang(runtime, resolved.resolved);
        } catch {
            continue;
        }
        if (!isAccidentalExecutableModeDrift({ headMode, currentMode, hasShebang })) continue;
        rows.push({ path: resolved.relative, headMode, currentMode, targetMode: currentMode | 0o111 });
    }
    return rows;
}

/**
 * @param {GitWriteRuntime} runtime
 * @param {string[]} paths
 */
async function repairAccidentalExecutableModeDrift(runtime, paths) {
    const drift = await inspectAccidentalExecutableModeDrift(runtime, paths);
    const repaired = [];
    for (const row of drift) {
        const resolved = await runtime.workspace.resolveWritePath(row.path);
        if (!resolved.ok) continue;
        const mutation = await runtime.workspace.io.chmodFileLocked(resolved.resolved, row.targetMode, {
            riskClass: 'medium',
            advisoryLimits: { tool: 'git_stage', reason: 'head-executable-shebang-xbit-loss' },
        });
        repaired.push({
            path: row.path,
            previousMode: `0${row.currentMode.toString(8).padStart(3, '0')}`,
            mode: `0${mutation.mode.toString(8).padStart(3, '0')}`,
            traceId: mutation.io.traceId ?? null,
            reason: 'head-executable-shebang-xbit-loss',
        });
    }
    return repaired;
}

/**
 * @param {GitWriteRuntime} runtime
 * @param {string[]} paths
 * @returns {Promise<
 *     | {
 *           ok: true;
 *           paths: string[];
 *           affected: string[];
 *           affectedCount: number;
 *           executableModeDrift: { path: string; headMode: string; currentMode: number; targetMode: number }[];
 *       }
 *     | { ok: false; error: string; path?: string }
 * >}
 */
async function planStage(runtime, paths) {
    const normalized = await normalizeExplicitPaths(runtime, paths);
    if (!normalized.ok) return normalized;
    const status = await runtime.exec(
        ['status', '--porcelain=v1', '--untracked-files=all', '--', ...normalized.paths],
        {
            maxBufferBytes: 4 * 1024 * 1024,
        },
    );
    if (!status.success) return { ok: false, error: status.error ?? 'Unable to inspect selected Git paths.' };
    const affected = status.stdout
        .split(/\r?\n/u)
        .map((line) => line.trimEnd())
        .filter(Boolean);
    if (affected.length > MAX_STAGE_FILES) {
        return {
            ok: false,
            error: `Selected paths expand to ${affected.length} changed files; maximum bounded staging set is ${MAX_STAGE_FILES}.`,
        };
    }
    const executableModeDrift = await inspectAccidentalExecutableModeDrift(runtime, normalized.paths);
    return { ok: true, paths: normalized.paths, affected, affectedCount: affected.length, executableModeDrift };
}

/** @param {GitWriteRuntime} runtime @returns {Promise<{ names: string[]; stat: string }>} */
async function readStagedSummary(runtime) {
    const [names, stat] = await Promise.all([
        runtime.exec(['diff', '--cached', '--name-only']),
        runtime.exec(['diff', '--cached', '--stat']),
    ]);
    return {
        names: names.success
            ? names.stdout
                  .split(/\r?\n/u)
                  .map((line) => line.trim())
                  .filter(Boolean)
            : [],
        stat: stat.success ? stat.stdout : '',
    };
}

/** @param {GitWriteRuntime} runtime @returns {Promise<{ name: string | null; email: string | null }>} */
async function readCommitIdentity(runtime) {
    const [name, email] = await Promise.all([
        runtime.exec(['config', '--get', 'user.name']),
        runtime.exec(['config', '--get', 'user.email']),
    ]);
    return {
        name: name.success ? name.stdout.trim() || null : null,
        email: email.success ? email.stdout.trim() || null : null,
    };
}

/** @param {GitWriteRuntime} runtime @returns {Promise<Record<string, unknown>>} */
async function buildPushState(runtime) {
    const [head, branch, upstream] = await Promise.all([readHead(runtime), readBranch(runtime), readUpstream(runtime)]);
    let ahead = null;
    let behind = null;
    if (upstream) {
        const counts = await runtime.exec(['rev-list', '--left-right', '--count', '@{upstream}...HEAD']);
        if (counts.success) {
            const [behindRaw, aheadRaw] = counts.stdout.trim().split(/\s+/u);
            behind = Number.isFinite(Number(behindRaw)) ? Number(behindRaw) : null;
            ahead = Number.isFinite(Number(aheadRaw)) ? Number(aheadRaw) : null;
        }
    }
    return { head, branch, upstream, ahead, behind };
}

/** @param {string} file @param {string[]} selected */
function isFileCoveredBySelectedPaths(file, selected) {
    const normalized = file.replaceAll('\\', '/');
    return selected.some(
        (candidate) => normalized === candidate || normalized.startsWith(`${candidate.replace(/\/$/u, '')}/`),
    );
}

/** @type {import('#copilot/mcp/public/protocol/catalog').McpRawToolDefinition[]} */
export const gitWriteTools = [
    defineMcpRawTool({
        name: 'git_stage_plan',
        title: 'Plan bounded Git stage',
        description:
            'Validate explicit workspace paths and enumerate the exact changed files that bounded staging would affect.',
        inputSchema: { paths: explicitPathsSchema },

        handler: async ({ paths }, operationContext) => {
            const runtime = createGitWriteRuntime(operationContext);
            const plan = await planStage(runtime, paths);
            if (!plan.ok) return errorResult(plan.error, { code: 'ERR_GIT_STAGE_PLAN', path: plan.path ?? null });
            const head = await readHead(runtime);
            return okResult({ success: true, ...plan, head }, JSON.stringify({ ...plan, head }, null, 2));
        },
    }),
    defineMcpRawTool({
        name: 'git_stage',
        title: 'Stage explicit Git paths',
        description:
            'Stage only the explicitly supplied, policy-validated workspace paths. Never performs git add -A or implicit dot staging.',
        inputSchema: {
            paths: explicitPathsSchema,
            expectedHead: z
                .string()
                .max(64)
                .optional()
                ['describe']('Optional HEAD prefix precondition from git_stage_plan.'),
            confirmStage: z
                .literal(true)
                ['describe']('Explicit acknowledgement that the enumerated path set should be staged.'),
        },

        handler: async ({ paths, expectedHead }, operationContext) => {
            const runtime = createGitWriteRuntime(operationContext);
            const head = await readHead(runtime);
            const headError = validateExpectedHead(expectedHead, head);
            if (headError) return errorResult(headError, { code: 'ERR_GIT_HEAD_PRECONDITION', expectedHead, head });
            const plan = await planStage(runtime, paths);
            if (!plan.ok) return errorResult(plan.error, { code: 'ERR_GIT_STAGE_PLAN', path: plan.path ?? null });
            if (plan.affectedCount === 0) {
                return okResult(
                    { success: true, staged: false, reason: 'no-selected-changes', paths: plan.paths, head },
                    'No selected changes to stage.',
                );
            }
            const repairedExecutableModes = await repairAccidentalExecutableModeDrift(runtime, plan.paths);
            const result = await runtime.exec(['add', '--', ...plan.paths], { timeoutMs: 30_000 });
            if (!result.success)
                return errorResult(result.error ?? 'git add failed.', {
                    code: 'ERR_GIT_STAGE_FAILED',
                    paths: plan.paths,
                });
            const staged = await readStagedSummary(runtime);
            await runtime.audit.append({
                event: 'git_stage',
                tool: 'git_stage',
                head,
                paths: plan.paths,
                affectedCount: plan.affectedCount,
                stagedCount: staged.names.length,
                repairedExecutableModes,
            });
            return okResult(
                {
                    success: true,
                    staged: true,
                    head,
                    paths: plan.paths,
                    affected: plan.affected,
                    executableModeDrift: plan.executableModeDrift,
                    repairedExecutableModes,
                    stagedFiles: staged.names,
                    stat: staged.stat,
                },
                staged.stat || staged.names.join('\n'),
            );
        },
    }),
    defineMcpRawTool({
        name: 'git_commit_plan',
        title: 'Plan Git commit',
        description:
            'Return staged files, diff stat, current HEAD and configured Git identity before creating a commit.',
        inputSchema: {
            message: z.string().min(1).max(MAX_COMMIT_MESSAGE_CHARS),
            expectedHead: z.string().max(64).optional(),
        },

        handler: async ({ message, expectedHead }, operationContext) => {
            const runtime = createGitWriteRuntime(operationContext);
            const [head, identity, staged] = await Promise.all([
                readHead(runtime),
                readCommitIdentity(runtime),
                readStagedSummary(runtime),
            ]);
            const headError = validateExpectedHead(expectedHead, head);
            if (headError) return errorResult(headError, { code: 'ERR_GIT_HEAD_PRECONDITION', expectedHead, head });
            const plan = {
                success: true,
                head,
                identity,
                message: message.trim(),
                stagedFiles: staged.names,
                stagedCount: staged.names.length,
                stat: staged.stat,
                canCommit: staged.names.length > 0 && Boolean(identity.name && identity.email),
            };
            return okResult(plan, JSON.stringify(plan, null, 2));
        },
    }),
    defineMcpRawTool({
        name: 'git_commit',
        title: 'Create bounded Git commit',
        description:
            'Commit the already-staged Git index without amend, signing overrides, arbitrary flags or additional staging.',
        inputSchema: {
            message: z.string().min(1).max(MAX_COMMIT_MESSAGE_CHARS),
            expectedHead: z.string().max(64).optional(),
            confirmCommit: z.literal(true),
        },

        handler: async ({ message, expectedHead }, operationContext) => {
            const runtime = createGitWriteRuntime(operationContext);
            const [head, identity, staged] = await Promise.all([
                readHead(runtime),
                readCommitIdentity(runtime),
                readStagedSummary(runtime),
            ]);
            const headError = validateExpectedHead(expectedHead, head);
            if (headError) return errorResult(headError, { code: 'ERR_GIT_HEAD_PRECONDITION', expectedHead, head });
            if (staged.names.length === 0)
                return errorResult('No staged changes are available to commit.', { code: 'ERR_GIT_EMPTY_INDEX' });
            if (!identity.name || !identity.email)
                return errorResult('Git user.name/user.email are not configured.', {
                    code: 'ERR_GIT_IDENTITY_MISSING',
                    identity,
                });
            const result = await runtime.exec(['commit', '-m', message.trim()], {
                timeoutMs: 120_000,
                maxBufferBytes: 4 * 1024 * 1024,
            });
            if (!result.success)
                return errorResult(result.error ?? 'git commit failed.', {
                    code: 'ERR_GIT_COMMIT_FAILED',
                    previousHead: head,
                    stagedFiles: staged.names,
                });
            const newHead = await readHead(runtime);
            await runtime.audit.append({
                event: 'git_commit',
                tool: 'git_commit',
                previousHead: head,
                newHead,
                stagedFiles: staged.names,
                message: message.trim().slice(0, 240),
            });
            return okResult(
                {
                    success: true,
                    previousHead: head,
                    head: newHead,
                    committedFiles: staged.names,
                    output: result.stdout,
                    stderr: result.stderr,
                },
                result.stdout || String(newHead),
            );
        },
    }),
    defineMcpRawTool({
        name: 'git_push_plan',
        title: 'Check upstream Git push',
        description:
            'Resolve only the current branch upstream and perform git push --dry-run without accepting a remote, refspec or force option.',
        inputSchema: {
            expectedHead: z.string().max(64).optional(),
            runDryRun: z
                .boolean()
                .optional()
                ['describe']('Contact the configured upstream with git push --dry-run. Default: true.'),
        },

        handler: async ({ expectedHead, runDryRun }, operationContext) => {
            const runtime = createGitWriteRuntime(operationContext);
            const state = await buildPushState(runtime);
            const headError = validateExpectedHead(expectedHead, /** @type {string | null} */ (state['head']));
            if (headError)
                return errorResult(headError, { code: 'ERR_GIT_HEAD_PRECONDITION', expectedHead, head: state['head'] });
            if (!state['branch'])
                return errorResult('Detached HEAD cannot be pushed by the governed tool.', {
                    code: 'ERR_GIT_DETACHED_HEAD',
                    state,
                });
            if (!state['upstream'])
                return errorResult('Current branch has no configured upstream.', {
                    code: 'ERR_GIT_UPSTREAM_MISSING',
                    state,
                });
            let dryRun = null;
            if (runDryRun !== false) {
                const result = await runtime.exec(['push', '--dry-run', '--porcelain'], {
                    timeoutMs: 60_000,
                    maxBufferBytes: 2 * 1024 * 1024,
                });
                dryRun = {
                    success: result.success,
                    stdout: result.stdout,
                    stderr: result.stderr,
                    error: result.error ?? null,
                };
            }
            return okResult(
                { success: true, ...state, dryRun, canPush: dryRun ? dryRun.success : true },
                JSON.stringify({ ...state, dryRun }, null, 2),
            );
        },
    }),
    defineMcpRawTool({
        name: 'git_publish_changes',
        title: 'Stage, commit and optionally push explicit changes',
        description:
            'Governed one-call publish path: stage only explicit workspace paths, commit from a clean initial index, and optionally push only the current branch to its existing upstream.',
        inputSchema: {
            paths: explicitPathsSchema,
            message: z.string().min(1).max(MAX_COMMIT_MESSAGE_CHARS),
            expectedHead: z.string().max(64).optional()['describe']('Optional initial HEAD prefix precondition.'),
            push: z.boolean().optional()['describe']('Push after commit. Default: true.'),
            pushDryRunFirst: z
                .boolean()
                .optional()
                ['describe'](
                    'Run one upstream push --dry-run before the real push. Default: false for lower network latency.',
                ),
            confirmPublish: z
                .literal(true)
                ['describe']('Explicit acknowledgement of stage + commit + optional upstream push.'),
        },

        handler: async ({ paths, message, expectedHead, push, pushDryRunFirst }, operationContext) => {
            const runtime = createGitWriteRuntime(operationContext);
            const startedAt = Date.now();
            const initialHead = await readHead(runtime);
            const headError = validateExpectedHead(expectedHead, initialHead);
            if (headError) {
                return errorResult(headError, {
                    code: 'ERR_GIT_HEAD_PRECONDITION',
                    expectedHead,
                    head: initialHead,
                });
            }
            const initialStaged = await readStagedSummary(runtime);
            if (initialStaged.names.length > 0) {
                return errorResult('Composite publish requires a clean Git index before staging explicit paths.', {
                    code: 'ERR_GIT_PUBLISH_INDEX_NOT_CLEAN',
                    stagedFiles: initialStaged.names,
                    hint: 'Use the granular git_commit/git_push flow for intentionally pre-staged changes.',
                });
            }
            const plan = await planStage(runtime, paths);
            if (!plan.ok) return errorResult(plan.error, { code: 'ERR_GIT_STAGE_PLAN', path: plan.path ?? null });
            if (plan.affectedCount === 0) {
                return errorResult('No selected changes are available to publish.', {
                    code: 'ERR_GIT_PUBLISH_NO_CHANGES',
                    paths: plan.paths,
                });
            }

            const stageStartedAt = Date.now();
            const repairedExecutableModes = await repairAccidentalExecutableModeDrift(runtime, plan.paths);
            const stage = await runtime.exec(['add', '--', ...plan.paths], { timeoutMs: 30_000 });
            if (!stage.success) {
                return errorResult(stage.error ?? 'git add failed.', {
                    code: 'ERR_GIT_STAGE_FAILED',
                    paths: plan.paths,
                });
            }
            const staged = await readStagedSummary(runtime);
            const unexpectedStaged = staged.names.filter((file) => !isFileCoveredBySelectedPaths(file, plan.paths));
            if (unexpectedStaged.length > 0) {
                await runtime.exec(['reset', '--', ...plan.paths], { timeoutMs: 30_000 });
                return errorResult('Composite publish observed staged files outside the explicit selected path set.', {
                    code: 'ERR_GIT_PUBLISH_STAGE_ESCAPE',
                    unexpectedStaged,
                    selectedPaths: plan.paths,
                });
            }
            if (staged.names.length === 0) {
                return errorResult('Selected changes produced an empty staged index.', { code: 'ERR_GIT_EMPTY_INDEX' });
            }

            const identity = await readCommitIdentity(runtime);
            if (!identity.name || !identity.email) {
                await runtime.exec(['reset', '--', ...plan.paths], { timeoutMs: 30_000 });
                return errorResult('Git user.name/user.email are not configured.', {
                    code: 'ERR_GIT_IDENTITY_MISSING',
                    identity,
                });
            }
            const commitStartedAt = Date.now();
            const commit = await runtime.exec(['commit', '-m', message.trim()], {
                timeoutMs: 120_000,
                maxBufferBytes: 4 * 1024 * 1024,
            });
            if (!commit.success) {
                return errorResult(commit.error ?? 'git commit failed.', {
                    code: 'ERR_GIT_COMMIT_FAILED',
                    previousHead: initialHead,
                    stagedFiles: staged.names,
                });
            }
            const committedHead = await readHead(runtime);
            const shouldPush = push !== false;
            let pushResult = null;
            let pushStartedAt = null;
            let beforePush = null;
            let afterPush = null;
            if (shouldPush) {
                beforePush = await buildPushState(runtime);
                if (!beforePush['branch']) {
                    return errorResult('Commit created, but detached HEAD cannot be pushed by the governed tool.', {
                        code: 'ERR_GIT_DETACHED_HEAD_AFTER_COMMIT',
                        committedHead,
                        committed: true,
                    });
                }
                if (!beforePush['upstream']) {
                    return errorResult('Commit created, but current branch has no configured upstream.', {
                        code: 'ERR_GIT_UPSTREAM_MISSING_AFTER_COMMIT',
                        committedHead,
                        committed: true,
                    });
                }
                if (pushDryRunFirst === true) {
                    const dryRun = await runtime.exec(['push', '--dry-run', '--porcelain'], {
                        timeoutMs: 60_000,
                        maxBufferBytes: 2 * 1024 * 1024,
                    });
                    if (!dryRun.success) {
                        return errorResult(dryRun.error ?? 'Git push dry-run failed after commit.', {
                            code: 'ERR_GIT_PUSH_DRY_RUN_FAILED_AFTER_COMMIT',
                            committed: true,
                            committedHead,
                            state: beforePush,
                            stderr: dryRun.stderr,
                        });
                    }
                }
                pushStartedAt = Date.now();
                const pushed = await runtime.exec(['push', '--porcelain'], {
                    timeoutMs: 120_000,
                    maxBufferBytes: 4 * 1024 * 1024,
                });
                pushResult = {
                    success: pushed.success,
                    stdout: pushed.stdout,
                    stderr: pushed.stderr,
                    error: pushed.error ?? null,
                };
                if (!pushed.success) {
                    return errorResult(pushed.error ?? 'Git push failed after commit.', {
                        code: 'ERR_GIT_PUSH_FAILED_AFTER_COMMIT',
                        committed: true,
                        committedHead,
                        state: beforePush,
                        stderr: pushed.stderr,
                    });
                }
                afterPush = await buildPushState(runtime);
            }

            await runtime.audit.append({
                event: 'git_publish_changes',
                tool: 'git_publish_changes',
                previousHead: initialHead,
                head: committedHead,
                paths: plan.paths,
                committedFiles: staged.names,
                pushed: shouldPush,
                upstream: afterPush?.['upstream'] ?? beforePush?.['upstream'] ?? null,
            });
            const structured = {
                success: true,
                previousHead: initialHead,
                head: committedHead,
                paths: plan.paths,
                committedFiles: staged.names,
                stat: staged.stat,
                executableModeDrift: plan.executableModeDrift,
                repairedExecutableModes,
                pushed: shouldPush,
                pushDryRunFirst: pushDryRunFirst === true,
                beforePush,
                afterPush,
                pushOutput: pushResult,
                timings: {
                    totalMs: Date.now() - startedAt,
                    stageMs: commitStartedAt - stageStartedAt,
                    commitMs: (pushStartedAt ?? Date.now()) - commitStartedAt,
                    pushMs: pushStartedAt === null ? 0 : Date.now() - pushStartedAt,
                },
                nextAction: shouldPush
                    ? 'Publish completed; no separate git_stage/git_commit/git_push calls are required.'
                    : 'Commit completed locally; use git_push_plan/git_push later if remote publication is desired.',
            };
            const result = okResult(
                structured,
                shouldPush
                    ? `Committed and pushed ${staged.names.length} file(s).`
                    : `Committed ${staged.names.length} file(s).`,
            );
            return withResultExecutionHint(result, {
                logicalOperations: shouldPush ? 3 : 2,
                mode: shouldPush ? 'git-publish:stage-commit-push' : 'git-publish:stage-commit',
            });
        },
    }),
    defineMcpRawTool({
        name: 'git_push',
        title: 'Push current branch to configured upstream',
        description:
            'Push the current branch using only its existing upstream. Force, arbitrary remotes and arbitrary refspecs are impossible through this tool.',
        inputSchema: {
            expectedHead: z
                .string()
                .min(7)
                .max(64)
                ['describe']('HEAD precondition obtained from git_commit/git_push_plan.'),
            expectedUpstream: z
                .string()
                .min(1)
                .max(256)
                ['describe']('Expected existing upstream, for example origin/main.'),
            pushDryRunFirst: z
                .boolean()
                .optional()
                ['describe'](
                    'Run git push --dry-run before the real push. Default: false; git_push_plan remains available for explicit preflight.',
                ),
            confirmPush: z.literal(true),
        },

        handler: async ({ expectedHead, expectedUpstream, pushDryRunFirst }, operationContext) => {
            const runtime = createGitWriteRuntime(operationContext);
            const state = await buildPushState(runtime);
            const headError = validateExpectedHead(expectedHead, /** @type {string | null} */ (state['head']));
            if (headError)
                return errorResult(headError, { code: 'ERR_GIT_HEAD_PRECONDITION', expectedHead, head: state['head'] });
            if (!state['branch'])
                return errorResult('Detached HEAD cannot be pushed by the governed tool.', {
                    code: 'ERR_GIT_DETACHED_HEAD',
                    state,
                });
            if (!state['upstream'] || state['upstream'] !== expectedUpstream) {
                return errorResult(
                    `Upstream precondition failed: expected ${expectedUpstream}, actual ${String(state['upstream'])}.`,
                    { code: 'ERR_GIT_UPSTREAM_PRECONDITION', state },
                );
            }
            if (pushDryRunFirst === true) {
                const dryRun = await runtime.exec(['push', '--dry-run', '--porcelain'], {
                    timeoutMs: 60_000,
                    maxBufferBytes: 2 * 1024 * 1024,
                });
                if (!dryRun.success) {
                    return errorResult(dryRun.error ?? 'Git push dry-run failed.', {
                        code: 'ERR_GIT_PUSH_DRY_RUN_FAILED',
                        state,
                        stderr: dryRun.stderr,
                    });
                }
            }
            const result = await runtime.exec(['push', '--porcelain'], {
                timeoutMs: 120_000,
                maxBufferBytes: 4 * 1024 * 1024,
            });
            if (!result.success)
                return errorResult(result.error ?? 'Git push failed.', {
                    code: 'ERR_GIT_PUSH_FAILED',
                    state,
                    stderr: result.stderr,
                });
            const after = await buildPushState(runtime);
            await runtime.audit.append({
                event: 'git_push',
                tool: 'git_push',
                head: state['head'],
                branch: state['branch'],
                upstream: state['upstream'],
                aheadBefore: state['ahead'],
                aheadAfter: after['ahead'],
            });
            return okResult(
                {
                    success: true,
                    pushDryRunFirst: pushDryRunFirst === true,
                    before: state,
                    after,
                    output: result.stdout,
                    stderr: result.stderr,
                },
                result.stdout || result.stderr || 'Push completed.',
            );
        },
    }),
];
