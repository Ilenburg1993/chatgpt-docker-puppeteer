// @ts-check
/**
 * Cloudflare edge backup tools.
 *
 * @module copilot/mcp/tools/cloudflare-edge-backup
 */

import { z } from 'zod';
import { createCloudflareEdgeBackup, listCloudflareEdgeBackups } from '../cloudflare/edge-backup.js';
import { boundedWriteAnnotations, readOnlyAnnotations } from '../control-plane/annotations.js';
import { okResult } from '../control-plane/result.js';

/**
 * @type {import('../registry.js').McpToolDefinition}
 */
export const mcpCloudflareEdgeBackupCreateTool = {
    name: 'mcp_cloudflare_edge_backup_create',
    title: 'Cloudflare edge backup create',
    description:
        'Persist a local JSON backup of the current Cloudflare tunnel, DNS, rulesets and policy diff before any edge mutation.',
    inputSchema: {
        label: z.string().optional().describe('Optional filesystem-safe label for the backup file.'),
        includeSnapshot: z
            .boolean()
            .optional()
            .describe('Whether to include the full snapshot in the tool response. Default: false.'),
    },
    annotations: boundedWriteAnnotations(),
    handler: async ({ label, includeSnapshot }) =>
        okResult(
            await createCloudflareEdgeBackup({
                ...(typeof label === 'string' ? { label } : {}),
                ...(includeSnapshot === true ? { includeSnapshot: true } : {}),
            }),
        ),
};

/**
 * @type {import('../registry.js').McpToolDefinition}
 */
export const mcpCloudflareEdgeBackupsListTool = {
    name: 'mcp_cloudflare_edge_backups_list',
    title: 'Cloudflare edge backups list',
    description: 'List local Cloudflare edge snapshot backups created before Cloudflare edge changes.',
    inputSchema: {
        limit: z.number().int().min(1).max(200).optional().describe('Maximum backups to return. Default: 20.'),
    },
    annotations: readOnlyAnnotations(),
    handler: async ({ limit }) => okResult(await listCloudflareEdgeBackups({ limit })),
};
