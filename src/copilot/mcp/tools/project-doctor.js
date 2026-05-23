// @ts-check
/**
 * project_doctor MCP tool.
 *
 * @module copilot/mcp/tools/project-doctor
 */

import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { readOnlyAnnotations } from '../control-plane/annotations.js';
import { getMcpWorkspaceRoot } from '../control-plane/paths.js';
import { okResult } from '../control-plane/result.js';
import { execGit } from './shared/git.js';

/**
 * @type {import('../registry.js').McpToolDefinition}
 */
export const projectDoctorTool = {
    name: 'project_doctor',
    title: 'Project doctor',
    description: 'Return basic runtime, workspace and script information for the copilot MCP project.',
    inputSchema: {
        includeScripts: z.boolean().optional().describe('Include relevant npm scripts. Default: true.'),
    },
    annotations: readOnlyAnnotations(),
    handler: async ({ includeScripts }) => {
        const packageJsonUrl = new URL('../../../../package.json', import.meta.url);
        const packageJson = /** @type {{ scripts?: Record<string, string> }} */ (
            JSON.parse(await readFile(packageJsonUrl, 'utf8'))
        );
        const scripts = packageJson.scripts ?? {};
        const relevantScripts = Object.fromEntries(
            Object.entries(scripts).filter(([name]) => {
                return (
                    name === 'typecheck:strict:src.copilot' ||
                    name === 'lint:copilot' ||
                    name === 'test:copilot:unit' ||
                    name === 'copilot:mcp:safe-suite' ||
                    name.startsWith('terminal:llm-b')
                );
            }),
        );
        const branch = await execGit(['branch', '--show-current']);
        const structured = {
            success: true,
            node: process.version,
            platform: process.platform,
            pid: process.pid,
            workspaceRoot: getMcpWorkspaceRoot(),
            branch: branch.stdout.trim(),
            validators: {
                typecheck: 'npm run typecheck:strict:src.copilot',
                lint: 'npm run lint:copilot',
                unitMcp: 'npx vitest --config vitest.copilot.config.js run tests/unit/copilot/mcp',
                unit: 'npm run test:copilot:unit',
                mcpFastSuite: 'npm run copilot:mcp:safe-suite -- mcp-fast',
                mcpFullSuite: 'npm run copilot:mcp:safe-suite -- mcp-full',
                copilotFastSuite: 'npm run copilot:mcp:safe-suite -- copilot-fast',
            },
            scripts: includeScripts === false ? undefined : relevantScripts,
        };
        return okResult(structured);
    },
};
