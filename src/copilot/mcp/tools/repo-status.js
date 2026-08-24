// @ts-check
/**
 * repo_status MCP wire adapter.
 *
 * @module copilot/mcp/tools/repo-status
 */

import { errorResult, okResult } from '#copilot/mcp/public/protocol/tools';
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
 * @returns {Promise<import('#copilot/mcp/public/protocol/tools').StructuredCallToolResult>}
 */
export async function repoStatusHandler() {
    const status = await readRepositoryStatus();
    if (!status.success) {
        return errorResult(status.error, {
            code: status.code,
            hint: status.hint,
        });
    }
    return okResult(status, `branch=${status.branch}\nhead=${status.head}\n${status.status}`.trim());
}
