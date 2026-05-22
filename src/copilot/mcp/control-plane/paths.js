// @ts-check
/**
 * Workspace path helpers for the ChatGPT MCP server.
 *
 * @module copilot/mcp/control-plane/paths
 */

import { WORKSPACE_ROOT, validatePath } from '#copilot/tools';
import path from 'node:path';

/**
 * @returns {string}
 */
export function getMcpWorkspaceRoot() {
    return WORKSPACE_ROOT || process.cwd();
}

/**
 * @param {string} filePath
 * @returns {Promise<{ ok: true; resolved: string; relative: string } | { ok: false; reason: string }>}
 */
export async function resolveReadPath(filePath) {
    const result = await validatePath(filePath, { mode: 'read' });
    if (!result.ok) return { ok: false, reason: result.reason ?? 'Path denied.' };
    return {
        ok: true,
        resolved: result.resolved,
        relative: toWorkspaceRelativePath(result.resolved),
    };
}

/**
 * @param {string} absolutePath
 * @returns {string}
 */
export function toWorkspaceRelativePath(absolutePath) {
    const relative = path.relative(getMcpWorkspaceRoot(), absolutePath);
    return relative === '' ? '.' : relative;
}
