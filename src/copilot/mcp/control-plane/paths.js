// @ts-check
/**
 * Workspace path helpers for the ChatGPT MCP server.
 *
 * @module copilot/mcp/control-plane/paths
 */

import { WORKSPACE_ROOT, validatePath } from '#copilot/tools';
import path from 'node:path';

/**
 * @typedef {{
 *   ok: true;
 *   resolved: string;
 *   relative: string;
 *   validatedReadPath?: unknown;
 * }} McpPathOk
 * @typedef {{
 *   ok: false;
 *   reason: string;
 *   code: 'ERR_EMPTY_PATH' | 'ERR_NULL_BYTE_PATH' | 'ERR_PATH_DENIED' | 'ERR_INVALID_PATH';
 *   hint: string;
 *   inputPath: string;
 *   mode: 'read' | 'write';
 * }} McpPathError
 */

/**
 * @returns {string}
 */
export function getMcpWorkspaceRoot() {
    return WORKSPACE_ROOT || process.cwd();
}

/**
 * @param {string} filePath
 * @returns {Promise<McpPathOk | McpPathError>}
 */
export async function resolveReadPath(filePath) {
    const result = await validatePath(filePath, { mode: 'read' });
    if (!result.ok) return pathError(filePath, 'read', result.reason ?? 'Path denied.');
    return {
        ok: true,
        resolved: result.resolved,
        relative: toWorkspaceRelativePath(result.resolved),
        validatedReadPath: result.validatedReadPath,
    };
}

/**
 * @param {string} filePath
 * @returns {Promise<McpPathOk | McpPathError>}
 */
export async function resolveWritePath(filePath) {
    const result = await validatePath(filePath, { mode: 'write' });
    if (!result.ok) return pathError(filePath, 'write', result.reason ?? 'Path denied.');
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

/**
 * @param {string} filePath
 * @param {'read' | 'write'} mode
 * @param {string} reason
 * @returns {McpPathError}
 */
function pathError(filePath, mode, reason) {
    return {
        ok: false,
        reason,
        code: classifyPathError(reason),
        hint: buildPathErrorHint(reason),
        inputPath: filePath,
        mode,
    };
}

/**
 * @param {string} reason
 * @returns {McpPathError['code']}
 */
function classifyPathError(reason) {
    const normalized = reason.toLowerCase();
    if (normalized.includes('path vazio')) return 'ERR_EMPTY_PATH';
    if (normalized.includes('byte nulo') || normalized.includes('null byte')) return 'ERR_NULL_BYTE_PATH';
    if (normalized.includes('acesso negado') || normalized.includes('denied')) return 'ERR_PATH_DENIED';
    return 'ERR_INVALID_PATH';
}

/**
 * @param {string} reason
 * @returns {string}
 */
function buildPathErrorHint(reason) {
    const code = classifyPathError(reason);
    if (code === 'ERR_EMPTY_PATH') {
        return 'Use a workspace-relative path, or omit optional path fields when the tool documents a default.';
    }
    if (code === 'ERR_NULL_BYTE_PATH') {
        return 'Remove null bytes from the path and retry with a normal workspace-relative path.';
    }
    if (code === 'ERR_PATH_DENIED') {
        return 'Use a path inside the configured workspace and allowed MCP scope.';
    }
    return 'Check that the path is valid, workspace-relative and supported by the selected tool.';
}
