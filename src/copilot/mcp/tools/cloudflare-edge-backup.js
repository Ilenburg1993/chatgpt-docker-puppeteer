// @ts-check
/**
 * Cloudflare edge backup tools.
 *
 * @module copilot/mcp/tools/cloudflare-edge-backup
 */

import { createCloudflareEdgeBackup, listCloudflareEdgeBackups } from '#copilot/mcp/public/cloudflare/edge';

import { defineMcpRawTool } from '#copilot/mcp/public/protocol/catalog';
import { okResult, requireMcpToolCloudflareEnvironmentAuthority } from '#copilot/mcp/public/protocol/tools';
import { z } from 'zod';

/**
 * @type {import('#copilot/mcp/public/protocol/catalog').McpRawToolDefinition}
 */
export const mcpCloudflareEdgeBackupCreateTool = defineMcpRawTool({
    name: 'mcp_cloudflare_edge_backup_create',
    title: 'Cloudflare edge backup create',
    description:
        'Persist a local JSON backup of the current Cloudflare tunnel, DNS, rulesets and policy diff before any edge mutation.',
    inputSchema: {
        label: z.string().optional()['describe']('Optional filesystem-safe label for the backup file.'),
        includeSnapshot: z
            .boolean()
            .optional()
            ['describe']('Whether to include the full snapshot in the tool response. Default: false.'),
    },

    handler: async ({ label, includeSnapshot }, operationContext) =>
        okResult(
            await createCloudflareEdgeBackup({
                authority: requireMcpToolCloudflareEnvironmentAuthority(operationContext),
                ...(typeof label === 'string' ? { label } : {}),
                ...(includeSnapshot === true ? { includeSnapshot: true } : {}),
            }),
        ),
});

/**
 * @type {import('#copilot/mcp/public/protocol/catalog').McpRawToolDefinition}
 */
export const mcpCloudflareEdgeBackupsListTool = defineMcpRawTool({
    name: 'mcp_cloudflare_edge_backups_list',
    title: 'Cloudflare edge backups list',
    description: 'List local Cloudflare edge snapshot backups created before Cloudflare edge changes.',
    inputSchema: {
        limit: z.number().int().min(1).max(200).optional()['describe']('Maximum backups to return. Default: 20.'),
    },

    handler: async ({ limit }) => okResult(await listCloudflareEdgeBackups(limit === undefined ? {} : { limit })),
});
