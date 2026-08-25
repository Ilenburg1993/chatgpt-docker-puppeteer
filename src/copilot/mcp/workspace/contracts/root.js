// @ts-check
/**
 * Canonical repository identity for the MCP workspace owner.
 *
 * A workspace root is identity, not authority. This constant is derived only from this module's physical location and
 * grants no filesystem, indexing, process or mutation capability. Access authority is supplied separately by
 * McpWorkspaceCapability from composition.
 *
 * @module copilot/mcp/workspace/contracts/root
 */

import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MCP_WORKSPACE_ROOT = resolve(fileURLToPath(new URL('../../../../../', import.meta.url)));

/**
 * Resolve a configured path against the canonical MCP workspace identity without granting filesystem authority.
 * Absolute inputs remain absolute; relative inputs are anchored to the repository root rather than ambient cwd.
 *
 * @param {string} configuredPath
 * @returns {string}
 */
export function resolveMcpWorkspaceIdentityPath(configuredPath) {
    const value = String(configuredPath ?? '').trim();
    if (!value || /[\r\n\0]/u.test(value)) {
        throw new TypeError('MCP workspace identity path must be a non-empty single-line path.');
    }
    return resolve(MCP_WORKSPACE_ROOT, value);
}

/**
 * Project an absolute path into the canonical MCP workspace identity without granting filesystem authority.
 *
 * @param {string} absolutePath
 * @returns {string}
 */
export function toMcpWorkspaceRelativePath(absolutePath) {
    const value = relative(MCP_WORKSPACE_ROOT, absolutePath);
    return value === '' ? '.' : value;
}
