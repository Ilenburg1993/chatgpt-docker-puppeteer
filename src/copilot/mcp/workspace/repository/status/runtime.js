// @ts-check
/**
 * Repository status operation for the MCP workspace.
 *
 * Returns domain data only. Wire adapters are responsible for converting a failed status read into MCP error results.
 *
 * @module copilot/mcp/workspace/repository/status/runtime
 */

import { MCP_WORKSPACE_ROOT } from '#copilot/mcp/public/workspace';
import { execWorkspaceGit } from '#copilot/mcp/public/workspace/git';

/**
 * @typedef {{
 *     success: true;
 *     workspaceRoot: string;
 *     branch: string;
 *     head: string;
 *     status: string;
 *     dirty: boolean;
 * } | {
 *     success: false;
 *     error: string;
 *     code: 'ERR_GIT_STATUS_FAILED';
 *     hint: string;
 * }} RepositoryStatus
 */

/** @typedef {(args: string[], options?: { cwd?: string }) => ReturnType<typeof execWorkspaceGit>} RepositoryStatusGitExec */

/**
 * @param {{ workspaceRoot?: string; gitConfig?: import('#copilot/mcp/public/workspace/git').McpGitProcessConfig; signal?: AbortSignal; execGit?: RepositoryStatusGitExec }} [options]
 * @returns {Promise<RepositoryStatus>}
 */
export async function readRepositoryStatus(options = {}) {
    const workspaceRoot = options.workspaceRoot ?? MCP_WORKSPACE_ROOT;
    /** @type {RepositoryStatusGitExec} */
    const execGit =
        options.execGit ??
        ((args, execOptions = {}) => {
            if (!options.gitConfig) throw new TypeError('Repository status requires an explicit Git process config.');
            return execWorkspaceGit(args, {
                cwd: execOptions.cwd ?? workspaceRoot,
                config: options.gitConfig,
                ...(options.signal ? { signal: options.signal } : {}),
            });
        });
    const [status, head] = await Promise.all([
        execGit(['status', '--short', '--branch'], { cwd: workspaceRoot }),
        execGit(['rev-parse', '--short', 'HEAD'], { cwd: workspaceRoot }),
    ]);
    if (!status.success) {
        return {
            success: false,
            error: status.error ?? 'Unable to read git status.',
            code: 'ERR_GIT_STATUS_FAILED',
            hint: 'Confirm this workspace is a Git repository and Git is available in the container.',
        };
    }
    const statusText = status.stdout;
    const branchLine = statusText.split('\n', 1)[0] ?? '';
    const branch = branchLine.startsWith('## ') ? branchLine.slice(3).split('...')[0]?.trim() || 'HEAD' : 'HEAD';
    return {
        success: true,
        workspaceRoot,
        branch,
        head: head.stdout.trim(),
        status: statusText,
        dirty: statusText
            .split('\n')
            .filter((line) => line.trim() !== '')
            .some((line) => !line.startsWith('## ')),
    };
}
