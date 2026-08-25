// @ts-check
/**
 * Read-only Git MCP tools.
 *
 * @module copilot/mcp/tools/git-read
 */

// @ts-check
/**
 * Read-only Git MCP tools.
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
import { execWorkspaceGit as execGit } from '#copilot/mcp/public/workspace/git';
import { z } from 'zod';

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
    return Object.freeze({ exec });
}

const gitStatusOutputSchema = z.object({
    success: z.literal(true),
    status: z.string(),
});
const gitDiffOutputSchema = z.object({
    success: z.literal(true),
    diff: z.string(),
    staged: z.boolean(),
    path: z.string().nullable(),
});
const gitLogOutputSchema = z.object({
    success: z.literal(true),
    log: z.string(),
    limit: z.number().int().min(1).max(50),
});
const gitBranchInfoOutputSchema = z.object({
    success: z.literal(true),
    branch: z.string(),
    upstream: z.string().nullable(),
    head: z.string(),
});

/**
 * @type {import('#copilot/mcp/public/protocol/catalog').McpRawToolDefinition[]}
 */
export const gitReadTools = [
    defineMcpRawTool({
        name: 'git_status',
        title: 'Git status',
        description: 'Return the current Git branch, HEAD and short status for the workspace.',
        inputSchema: {},
        outputSchema: gitStatusOutputSchema,

        handler: async (_args, operationContext) => {
            const git = createGitReadRuntime(operationContext);
            const status = await git.exec(['status', '--short', '--branch']);
            if (!status.success) {
                return errorResult(status.error ?? 'Unable to read git status.', {
                    code: 'ERR_GIT_STATUS_FAILED',
                    hint: 'Confirm this workspace is a Git repository and Git is available in the container.',
                });
            }
            return okResult({ success: true, status: status.stdout }, status.stdout || '(clean)');
        },
    }),
    defineMcpRawTool({
        name: 'git_diff',
        title: 'Git diff',
        description: 'Return a unified Git diff for the workspace or for one path.',
        inputSchema: {
            staged: z.boolean().optional()['describe']('If true, return staged changes only.'),
            path: z.string().optional()['describe']('Optional workspace-relative path to diff.'),
        },
        outputSchema: gitDiffOutputSchema,

        handler: async ({ staged, path }, operationContext) => {
            const git = createGitReadRuntime(operationContext);
            const args = ['diff'];
            if (staged === true) args.push('--staged');
            if (path) args.push('--', path);
            const diff = await git.exec(args, { maxBufferBytes: 4 * 1024 * 1024 });
            if (!diff.success) {
                return errorResult(diff.error ?? 'Unable to read git diff.', {
                    code: 'ERR_GIT_DIFF_FAILED',
                    hint: 'Check the optional path and confirm Git can read the repository diff.',
                    path: path ?? null,
                });
            }
            return okResult(
                { success: true, diff: diff.stdout, staged: staged === true, path: path ?? null },
                diff.stdout,
            );
        },
    }),
    defineMcpRawTool({
        name: 'git_log',
        title: 'Git log',
        description: 'Return recent Git commits for the workspace.',
        inputSchema: {
            limit: z.number().int().min(1).max(50).optional()['describe']('Maximum commits to return. Default: 10.'),
        },
        outputSchema: gitLogOutputSchema,

        handler: async ({ limit }, operationContext) => {
            const git = createGitReadRuntime(operationContext);
            const safeLimit = String(limit ?? 10);
            const log = await git.exec(['log', '--oneline', `-${safeLimit}`]);
            if (!log.success) {
                return errorResult(log.error ?? 'Unable to read git log.', {
                    code: 'ERR_GIT_LOG_FAILED',
                    hint: 'Confirm the repository has commits and Git can access HEAD.',
                    limit: Number(safeLimit),
                });
            }
            return okResult({ success: true, log: log.stdout, limit: Number(safeLimit) }, log.stdout);
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
            const structured = {
                success: true,
                branch: branch.stdout.trim(),
                upstream: upstream.success ? upstream.stdout.trim() : null,
                head: head.stdout.trim(),
            };
            return okResult(structured, JSON.stringify(structured, null, 2));
        },
    }),
];
