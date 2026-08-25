// @ts-check
/** Thin MCP exposure for Cloudflare post-change gates. */

import { runCloudflarePostChangeGates } from '#copilot/mcp/public/cloudflare/posture';
import { defineMcpRawTool } from '#copilot/mcp/public/protocol/catalog';
import {
    okResult,
    requireMcpToolCloudflareConfig,
    requireMcpToolCloudflareEnvironmentAuthority,
} from '#copilot/mcp/public/protocol/tools';
import { z } from 'zod';

/** @type {import('#copilot/mcp/public/protocol/catalog').McpRawToolDefinition} */
export const mcpCloudflarePostChangeGatesTool = defineMcpRawTool({
    name: 'mcp_cloudflare_post_change_gates',
    title: 'Cloudflare post-change gates',
    description:
        'Run a read-only gate bundle after Cloudflare tunnel/origin/edge changes: tunnel status, remote audit, metrics and pass/fail recommendations.',
    inputSchema: {
        includeDetails: z
            .boolean()
            .optional()
            ['describe'](
                'Include full tunnel, remote audit and metrics objects. Defaults to false for faster compact responses.',
            ),
    },
    handler: async (input, operationContext) =>
        okResult(
            await runCloudflarePostChangeGates(
                { includeDetails: input['includeDetails'] === true },
                {
                    config: requireMcpToolCloudflareConfig(operationContext),
                    authority: requireMcpToolCloudflareEnvironmentAuthority(operationContext),
                },
            ),
        ),
});
