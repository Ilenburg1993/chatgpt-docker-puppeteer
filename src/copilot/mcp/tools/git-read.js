// @ts-check
/**
 * Read-only Git MCP tools.
 *
 * @module copilot/mcp/tools/git-read
 */

import { errorResult, okResult, readOnlyAnnotations } from '#copilot/mcp/public/protocol/tools';
import { execWorkspaceGit as execGit } from '#copilot/mcp/public/workspace/git';
import { z } from 'zod';

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
 * @type {import('#copilot/mcp/public/protocol/catalog').McpToolDefinition[]}
 */
export const gitReadTools = [
    {
        name: 'git_status',
        title: 'Git status',
        description: 'Return the current Git branch, HEAD and short status for the workspace.',
        inputSchema: {},
        outputSchema: gitStatusOutputSchema,
        annotations: readOnlyAnnotations(),
        handler: async () => {
            const status = await execGit(['status', '--short', '--branch']);
            if (!status.success) {
                return errorResult(status.error ?? 'Unable to read git status.', {
                    code: 'ERR_GIT_STATUS_FAILED',
                    hint: 'Confirm this workspace is a Git repository and Git is available in the container.',
                });
            }
            return okResult({ success: true, status: status.stdout }, status.stdout || '(clean)');
        },
    },
    {
        name: 'git_diff',
        title: 'Git diff',
        description: 'Return a unified Git diff for the workspace or for one path.',
        inputSchema: {
            staged: z.boolean().optional()['describe']('If true, return staged changes only.'),
            path: z.string().optional()['describe']('Optional workspace-relative path to diff.'),
        },
        outputSchema: gitDiffOutputSchema,
        annotations: readOnlyAnnotations(),
        handler: async ({ staged, path }) => {
            const args = ['diff'];
            if (staged === true) args.push('--staged');
            if (path) args.push('--', path);
            const diff = await execGit(args, { maxBufferBytes: 4 * 1024 * 1024 });
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
    },
    {
        name: 'git_log',
        title: 'Git log',
        description: 'Return recent Git commits for the workspace.',
        inputSchema: {
            limit: z.number().int().min(1).max(50).optional()['describe']('Maximum commits to return. Default: 10.'),
        },
        outputSchema: gitLogOutputSchema,
        annotations: readOnlyAnnotations(),
        handler: async ({ limit }) => {
            const safeLimit = String(limit ?? 10);
            const log = await execGit(['log', '--oneline', `-${safeLimit}`]);
            if (!log.success) {
                return errorResult(log.error ?? 'Unable to read git log.', {
                    code: 'ERR_GIT_LOG_FAILED',
                    hint: 'Confirm the repository has commits and Git can access HEAD.',
                    limit: Number(safeLimit),
                });
            }
            return okResult({ success: true, log: log.stdout, limit: Number(safeLimit) }, log.stdout);
        },
    },
    {
        name: 'git_branch_info',
        title: 'Git branch info',
        description: 'Return current branch and upstream tracking information.',
        inputSchema: {},
        outputSchema: gitBranchInfoOutputSchema,
        annotations: readOnlyAnnotations(),
        handler: async () => {
            const [branch, upstream, head] = await Promise.all([
                execGit(['branch', '--show-current']),
                execGit(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']),
                execGit(['rev-parse', '--short', 'HEAD']),
            ]);
            const structured = {
                success: true,
                branch: branch.stdout.trim(),
                upstream: upstream.success ? upstream.stdout.trim() : null,
                head: head.stdout.trim(),
            };
            return okResult(structured, JSON.stringify(structured, null, 2));
        },
    },
];
