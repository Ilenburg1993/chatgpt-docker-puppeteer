// @ts-check
/**
 * repo_status MCP wire adapter.
 *
 * @module copilot/mcp/tools/repo-status
 */

import {
    errorResult,
    okResult,
    requireMcpToolGitConfig,
    requireMcpToolWorkspace,
} from '#copilot/mcp/public/protocol/tools';
import { readRepositoryStatus } from '#copilot/mcp/public/workspace/repository/status';
import { z } from 'zod';

export const repoStatusOutputSchema = z.object({
    success: z.literal(true),
    workspaceRoot: z.string(),
    branch: z.string(),
    head: z.string(),
    status: z.string(),
    dirty: z.boolean(),
});

/**
 * Wire-only projection for repo_status. Internal consumers must use readRepositoryStatus() instead of invoking this
 * handler as an application API.
 *
 * @param {Record<string, unknown>} _input
 * @param {import('#copilot/mcp/public/protocol/tools').McpToolOperationContext | undefined} operationContext
 * @returns {Promise<import('#copilot/mcp/public/protocol/tools').StructuredCallToolResult>}
 */
export async function repoStatusHandler(_input, operationContext) {
    const workspace = requireMcpToolWorkspace(operationContext);
    const status = await readRepositoryStatus({
        workspaceRoot: workspace.workspaceRoot,
        gitConfig: requireMcpToolGitConfig(operationContext),
        ...(operationContext?.signal ? { signal: operationContext.signal } : {}),
    });
    if (!status.success) {
        return errorResult(status.error, {
            code: status.code,
            hint: status.hint,
        });
    }
    return okResult(status, `branch=${status.branch}\nhead=${status.head}\n${status.status}`.trim());
}
