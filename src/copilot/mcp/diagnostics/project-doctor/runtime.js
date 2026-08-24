// @ts-check
/**
 * Project-doctor diagnostic operation.
 *
 * Produces domain data and is reusable by wire tools, startup diagnostics and composed maintenance without routing
 * through a tool handler.
 *
 * @module copilot/mcp/diagnostics/project-doctor/runtime
 */

import { execWorkspaceGit } from '#copilot/mcp/public/workspace/git';
import { join } from 'node:path';

/**
 * @param {import('#copilot/mcp/public/workspace').McpWorkspaceCapability} workspace
 * @param {{ includeScripts?: boolean }} [options]
 */
export async function readMcpProjectDoctor(workspace, options = {}) {
    if (!workspace) throw new TypeError('Project doctor requires a workspace capability.');
    const workspaceRoot = workspace.workspaceRoot;
    const packageJsonPath = join(workspaceRoot, 'package.json');
    const packageJson = /** @type {{ scripts?: Record<string, string> }} */ (
        JSON.parse((await workspace.io.readTextFresh(packageJsonPath, { includeHash: false })).content)
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
    const branch = await execWorkspaceGit(['branch', '--show-current'], { cwd: workspaceRoot });
    return {
        success: true,
        node: process.version,
        platform: process.platform,
        pid: process.pid,
        workspaceRoot,
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
        scripts: options.includeScripts === false ? undefined : relevantScripts,
    };
}
