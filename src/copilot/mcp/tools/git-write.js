// @ts-check
/**
 * Governed Git mutation tools for the MCP connector.
 *
 * The surface deliberately does not expose arbitrary Git commands, remotes, refspecs or force flags. Stage operations
 * are path-bounded, commits are HEAD-preconditioned, and pushes use only the already-configured upstream.
 *
 * @module copilot/mcp/tools/git-write
 */

import { z } from 'zod';
import {
    appendMcpAuditEvent,
    boundedWriteAnnotations,
    destructiveAnnotations,
    errorResult,
    okResult,
    readOnlyAnnotations,
    resolveWritePath,
} from '#copilot/mcp/control-plane';
import { execGit } from '#copilot/mcp/tools/shared';

const MAX_STAGE_PATHS = 200;
const MAX_STAGE_FILES = 500;
const MAX_COMMIT_MESSAGE_CHARS = 4000;
const HEAD_RE = /^[0-9a-f]{7,64}$/iu;
const PATHSPEC_MAGIC_RE = /^(?::|[-])|[*?[\]{}!]/u;

const explicitPathsSchema = z
    .array(z.string().min(1).max(1024))
    .min(1)
    .max(MAX_STAGE_PATHS)
    .describe('Explicit workspace-relative paths. Git pathspec magic, globs, option-like values and implicit dot are rejected.');

/** @returns {Promise<string | null>} */
async function readHead() {
    const result = await execGit(['rev-parse', 'HEAD']);
    return result.success ? result.stdout.trim() || null : null;
}

/** @returns {Promise<string | null>} */
async function readBranch() {
    const result = await execGit(['branch', '--show-current']);
    return result.success ? result.stdout.trim() || null : null;
}

/** @returns {Promise<string | null>} */
async function readUpstream() {
    const result = await execGit(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']);
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
 * @param {string[]} paths
 * @returns {Promise<{ ok: true; paths: string[] } | { ok: false; error: string; path?: string }>}
 */
async function normalizeExplicitPaths(paths) {
    const normalized = [];
    const seen = new Set();
    for (const rawValue of paths) {
        const raw = rawValue.trim().replaceAll('\\', '/');
        if (!raw || raw === '.' || raw === './') {
            return { ok: false, error: 'Implicit workspace-wide staging is not allowed; provide explicit paths.', path: rawValue };
        }
        if (PATHSPEC_MAGIC_RE.test(raw)) {
            return { ok: false, error: 'Git pathspec magic, globbing and option-like path values are not allowed.', path: rawValue };
        }
        const resolved = await resolveWritePath(raw);
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
 * @param {string[]} paths
 * @returns {Promise<
 *   | { ok: true; paths: string[]; affected: string[]; affectedCount: number }
 *   | { ok: false; error: string; path?: string }
 * >}
 */
async function planStage(paths) {
    const normalized = await normalizeExplicitPaths(paths);
    if (!normalized.ok) return normalized;
    const status = await execGit(['status', '--porcelain=v1', '--untracked-files=all', '--', ...normalized.paths], {
        maxBufferBytes: 4 * 1024 * 1024,
    });
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
    return { ok: true, paths: normalized.paths, affected, affectedCount: affected.length };
}

/** @returns {Promise<{ names: string[]; stat: string }>} */
async function readStagedSummary() {
    const [names, stat] = await Promise.all([
        execGit(['diff', '--cached', '--name-only']),
        execGit(['diff', '--cached', '--stat']),
    ]);
    return {
        names: names.success
            ? names.stdout.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean)
            : [],
        stat: stat.success ? stat.stdout : '',
    };
}

/** @returns {Promise<{ name: string | null; email: string | null }>} */
async function readCommitIdentity() {
    const [name, email] = await Promise.all([
        execGit(['config', '--get', 'user.name']),
        execGit(['config', '--get', 'user.email']),
    ]);
    return {
        name: name.success ? name.stdout.trim() || null : null,
        email: email.success ? email.stdout.trim() || null : null,
    };
}

/** @returns {Promise<Record<string, unknown>>} */
async function buildPushState() {
    const [head, branch, upstream] = await Promise.all([readHead(), readBranch(), readUpstream()]);
    let ahead = null;
    let behind = null;
    if (upstream) {
        const counts = await execGit(['rev-list', '--left-right', '--count', '@{upstream}...HEAD']);
        if (counts.success) {
            const [behindRaw, aheadRaw] = counts.stdout.trim().split(/\s+/u);
            behind = Number.isFinite(Number(behindRaw)) ? Number(behindRaw) : null;
            ahead = Number.isFinite(Number(aheadRaw)) ? Number(aheadRaw) : null;
        }
    }
    return { head, branch, upstream, ahead, behind };
}

/** @type {import('../registry.js').McpToolDefinition[]} */
export const gitWriteTools = [
    {
        name: 'git_stage_plan',
        title: 'Plan bounded Git stage',
        description: 'Validate explicit workspace paths and enumerate the exact changed files that bounded staging would affect.',
        inputSchema: { paths: explicitPathsSchema },
        annotations: readOnlyAnnotations(),
        handler: async ({ paths }) => {
            const plan = await planStage(paths);
            if (!plan.ok) return errorResult(plan.error, { code: 'ERR_GIT_STAGE_PLAN', path: plan.path ?? null });
            const head = await readHead();
            return okResult({ success: true, ...plan, head }, JSON.stringify({ ...plan, head }, null, 2));
        },
    },
    {
        name: 'git_stage',
        title: 'Stage explicit Git paths',
        description: 'Stage only the explicitly supplied, policy-validated workspace paths. Never performs git add -A or implicit dot staging.',
        inputSchema: {
            paths: explicitPathsSchema,
            expectedHead: z.string().max(64).optional().describe('Optional HEAD prefix precondition from git_stage_plan.'),
            confirmStage: z.literal(true).describe('Explicit acknowledgement that the enumerated path set should be staged.'),
        },
        annotations: boundedWriteAnnotations(),
        handler: async ({ paths, expectedHead }) => {
            const head = await readHead();
            const headError = validateExpectedHead(expectedHead, head);
            if (headError) return errorResult(headError, { code: 'ERR_GIT_HEAD_PRECONDITION', expectedHead, head });
            const plan = await planStage(paths);
            if (!plan.ok) return errorResult(plan.error, { code: 'ERR_GIT_STAGE_PLAN', path: plan.path ?? null });
            if (plan.affectedCount === 0) {
                return okResult({ success: true, staged: false, reason: 'no-selected-changes', paths: plan.paths, head }, 'No selected changes to stage.');
            }
            const result = await execGit(['add', '--', ...plan.paths], { timeoutMs: 30_000 });
            if (!result.success) return errorResult(result.error ?? 'git add failed.', { code: 'ERR_GIT_STAGE_FAILED', paths: plan.paths });
            const staged = await readStagedSummary();
            await appendMcpAuditEvent({ event: 'git_stage', tool: 'git_stage', head, paths: plan.paths, affectedCount: plan.affectedCount, stagedCount: staged.names.length });
            return okResult({ success: true, staged: true, head, paths: plan.paths, affected: plan.affected, stagedFiles: staged.names, stat: staged.stat }, staged.stat || staged.names.join('\n'));
        },
    },
    {
        name: 'git_commit_plan',
        title: 'Plan Git commit',
        description: 'Return staged files, diff stat, current HEAD and configured Git identity before creating a commit.',
        inputSchema: {
            message: z.string().min(1).max(MAX_COMMIT_MESSAGE_CHARS),
            expectedHead: z.string().max(64).optional(),
        },
        annotations: readOnlyAnnotations(),
        handler: async ({ message, expectedHead }) => {
            const [head, identity, staged] = await Promise.all([readHead(), readCommitIdentity(), readStagedSummary()]);
            const headError = validateExpectedHead(expectedHead, head);
            if (headError) return errorResult(headError, { code: 'ERR_GIT_HEAD_PRECONDITION', expectedHead, head });
            const plan = { success: true, head, identity, message: message.trim(), stagedFiles: staged.names, stagedCount: staged.names.length, stat: staged.stat, canCommit: staged.names.length > 0 && Boolean(identity.name && identity.email) };
            return okResult(plan, JSON.stringify(plan, null, 2));
        },
    },
    {
        name: 'git_commit',
        title: 'Create bounded Git commit',
        description: 'Commit the already-staged Git index without amend, signing overrides, arbitrary flags or additional staging.',
        inputSchema: {
            message: z.string().min(1).max(MAX_COMMIT_MESSAGE_CHARS),
            expectedHead: z.string().max(64).optional(),
            confirmCommit: z.literal(true),
        },
        annotations: boundedWriteAnnotations(),
        handler: async ({ message, expectedHead }) => {
            const [head, identity, staged] = await Promise.all([readHead(), readCommitIdentity(), readStagedSummary()]);
            const headError = validateExpectedHead(expectedHead, head);
            if (headError) return errorResult(headError, { code: 'ERR_GIT_HEAD_PRECONDITION', expectedHead, head });
            if (staged.names.length === 0) return errorResult('No staged changes are available to commit.', { code: 'ERR_GIT_EMPTY_INDEX' });
            if (!identity.name || !identity.email) return errorResult('Git user.name/user.email are not configured.', { code: 'ERR_GIT_IDENTITY_MISSING', identity });
            const result = await execGit(['commit', '-m', message.trim()], { timeoutMs: 120_000, maxBufferBytes: 4 * 1024 * 1024 });
            if (!result.success) return errorResult(result.error ?? 'git commit failed.', { code: 'ERR_GIT_COMMIT_FAILED', previousHead: head, stagedFiles: staged.names });
            const newHead = await readHead();
            await appendMcpAuditEvent({ event: 'git_commit', tool: 'git_commit', previousHead: head, newHead, stagedFiles: staged.names, message: message.trim().slice(0, 240) });
            return okResult({ success: true, previousHead: head, head: newHead, committedFiles: staged.names, output: result.stdout, stderr: result.stderr }, result.stdout || String(newHead));
        },
    },
    {
        name: 'git_push_plan',
        title: 'Check upstream Git push',
        description: 'Resolve only the current branch upstream and perform git push --dry-run without accepting a remote, refspec or force option.',
        inputSchema: {
            expectedHead: z.string().max(64).optional(),
            runDryRun: z.boolean().optional().describe('Contact the configured upstream with git push --dry-run. Default: true.'),
        },
        annotations: { ...readOnlyAnnotations(), openWorldHint: true },
        handler: async ({ expectedHead, runDryRun }) => {
            const state = await buildPushState();
            const headError = validateExpectedHead(expectedHead, /** @type {string | null} */ (state['head']));
            if (headError) return errorResult(headError, { code: 'ERR_GIT_HEAD_PRECONDITION', expectedHead, head: state['head'] });
            if (!state['branch']) return errorResult('Detached HEAD cannot be pushed by the governed tool.', { code: 'ERR_GIT_DETACHED_HEAD', state });
            if (!state['upstream']) return errorResult('Current branch has no configured upstream.', { code: 'ERR_GIT_UPSTREAM_MISSING', state });
            let dryRun = null;
            if (runDryRun !== false) {
                const result = await execGit(['push', '--dry-run', '--porcelain'], { timeoutMs: 60_000, maxBufferBytes: 2 * 1024 * 1024 });
                dryRun = { success: result.success, stdout: result.stdout, stderr: result.stderr, error: result.error ?? null };
            }
            return okResult({ success: true, ...state, dryRun, canPush: dryRun ? dryRun.success : true }, JSON.stringify({ ...state, dryRun }, null, 2));
        },
    },
    {
        name: 'git_push',
        title: 'Push current branch to configured upstream',
        description: 'Push the current branch using only its existing upstream. Force, arbitrary remotes and arbitrary refspecs are impossible through this tool.',
        inputSchema: {
            expectedHead: z.string().min(7).max(64).describe('HEAD precondition obtained from git_commit/git_push_plan.'),
            expectedUpstream: z.string().min(1).max(256).describe('Expected existing upstream, for example origin/main.'),
            confirmPush: z.literal(true),
        },
        annotations: { ...destructiveAnnotations(), openWorldHint: true },
        handler: async ({ expectedHead, expectedUpstream }) => {
            const state = await buildPushState();
            const headError = validateExpectedHead(expectedHead, /** @type {string | null} */ (state['head']));
            if (headError) return errorResult(headError, { code: 'ERR_GIT_HEAD_PRECONDITION', expectedHead, head: state['head'] });
            if (!state['branch']) return errorResult('Detached HEAD cannot be pushed by the governed tool.', { code: 'ERR_GIT_DETACHED_HEAD', state });
            if (!state['upstream'] || state['upstream'] !== expectedUpstream) {
                return errorResult(`Upstream precondition failed: expected ${expectedUpstream}, actual ${String(state['upstream'])}.`, { code: 'ERR_GIT_UPSTREAM_PRECONDITION', state });
            }
            const dryRun = await execGit(['push', '--dry-run', '--porcelain'], { timeoutMs: 60_000, maxBufferBytes: 2 * 1024 * 1024 });
            if (!dryRun.success) return errorResult(dryRun.error ?? 'Git push dry-run failed.', { code: 'ERR_GIT_PUSH_DRY_RUN_FAILED', state, stderr: dryRun.stderr });
            const result = await execGit(['push', '--porcelain'], { timeoutMs: 120_000, maxBufferBytes: 4 * 1024 * 1024 });
            if (!result.success) return errorResult(result.error ?? 'Git push failed.', { code: 'ERR_GIT_PUSH_FAILED', state, stderr: result.stderr });
            const after = await buildPushState();
            await appendMcpAuditEvent({ event: 'git_push', tool: 'git_push', head: state['head'], branch: state['branch'], upstream: state['upstream'], aheadBefore: state['ahead'], aheadAfter: after['ahead'] });
            return okResult({ success: true, before: state, after, output: result.stdout, stderr: result.stderr }, result.stdout || result.stderr || 'Push completed.');
        },
    },
];
