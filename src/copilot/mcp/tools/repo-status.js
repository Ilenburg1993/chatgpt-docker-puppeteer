// @ts-check
/**
 * repo_status MCP tool.
 *
 * @module copilot/mcp/tools/repo-status
 */

import { errorResult, getMcpWorkspaceRoot, okResult } from '#copilot/mcp/control-plane';
import { execGit } from '#copilot/mcp/tools/shared';

/**
 * @returns {Promise<import('../control-plane/result.js').StructuredCallToolResult>}
 */
export async function repoStatusHandler() {
    const [branch, status, head] = await Promise.all([
        execGit(['branch', '--show-current']),
        execGit(['status', '--short', '--branch']),
        execGit(['rev-parse', '--short', 'HEAD']),
    ]);
    if (!status.success) {
        return errorResult(status.error ?? 'Unable to read git status.', {
            code: 'ERR_GIT_STATUS_FAILED',
            hint: 'Confirm this workspace is a Git repository and Git is available in the container.',
        });
    }
    const structured = {
        success: true,
        workspaceRoot: getMcpWorkspaceRoot(),
        branch: branch.stdout.trim(),
        head: head.stdout.trim(),
        status: status.stdout,
        dirty: status.stdout
            .split('\n')
            .filter((line) => line.trim() !== '')
            .some((line) => !line.startsWith('## ')),
    };
    return okResult(structured, `branch=${structured.branch}\nhead=${structured.head}\n${structured.status}`.trim());
}
