// @ts-check
/**
 * project_doctor MCP wire adapter.
 *
 * @module copilot/mcp/tools/project-doctor
 */

import { readMcpProjectDoctor } from '#copilot/mcp/public/diagnostics/project-doctor';
import { okResult, readOnlyAnnotations, requireMcpToolWorkspace } from '#copilot/mcp/public/protocol/tools';
import { z } from 'zod';

/**
 * @type {import('#copilot/mcp/public/protocol/catalog').McpToolDefinition}
 */
export const projectDoctorTool = {
    name: 'project_doctor',
    title: 'Project doctor',
    description: 'Return basic runtime, workspace and script information for the copilot MCP project.',
    inputSchema: {
        includeScripts: z.boolean().optional()['describe']('Include relevant npm scripts. Default: true.'),
    },
    annotations: readOnlyAnnotations(),
    handler: async ({ includeScripts }, operationContext) =>
        okResult(await readMcpProjectDoctor(requireMcpToolWorkspace(operationContext), { includeScripts })),
};
