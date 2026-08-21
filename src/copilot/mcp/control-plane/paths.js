// @ts-check
/**
 * Workspace path helpers for the ChatGPT MCP server.
 *
 * @module copilot/mcp/control-plane/paths
 */

import { getApplicationWorkspaceInfra } from '#copilot/boot';
import { WORKSPACE_ROOT } from '#copilot/tools';
import path from 'node:path';

const MCP_WORKSPACE_INFRA = getApplicationWorkspaceInfra(WORKSPACE_ROOT || process.cwd());
const MCP_WORKSPACE_PATH_AUTHORITY = MCP_WORKSPACE_INFRA.authority;
const MCP_WORKSPACE_IO = MCP_WORKSPACE_INFRA.io;
const MCP_WORKSPACE_INDEXING = MCP_WORKSPACE_INFRA.indexing;

/**
 * @typedef {{
 *     ok: true;
 *     resolved: string;
 *     relative: string;
 *     validatedReadPath?: import('#copilot/infra/public/composition/workspace/authority').ValidatedReadWorkspacePath;
 *     validatedWritePath?: import('#copilot/infra/public/composition/workspace/authority').ValidatedMutableWorkspacePath;
 * }} McpPathOk
 * @typedef {McpPathOk & { validatedReadPath: import('#copilot/infra/public/composition/workspace/authority').ValidatedReadWorkspacePath }} McpValidatedReadPathOk
 *
 * @typedef {{
 *     ok: false;
 *     reason: string;
 *     code: 'ERR_EMPTY_PATH' | 'ERR_NULL_BYTE_PATH' | 'ERR_PATH_DENIED' | 'ERR_INVALID_PATH';
 *     hint: string;
 *     inputPath: string;
 *     mode: 'read' | 'write';
 * }} McpPathError
 */

/**
 * @returns {string}
 */
export function getMcpWorkspaceRoot() {
    return MCP_WORKSPACE_PATH_AUTHORITY.workspaceRoot;
}

/** Return the composition-owned MCP workspace I/O facade. */
export function getMcpWorkspaceIo() {
    return MCP_WORKSPACE_IO;
}

/** Return the composition-owned MCP workspace indexing facade. */
export function getMcpWorkspaceIndexing() {
    return MCP_WORKSPACE_INDEXING;
}

/** Return the runtime-owned persistent index registry used by the MCP workspace. */
export function getMcpWorkspaceIndexRegistry() {
    const registry = MCP_WORKSPACE_INDEXING.registry;
    if (!registry) throw new Error('MCP workspace is not attached to an InfraRuntime index registry.');
    return registry;
}

/** @param {(filePath:string,event:{recursive:boolean;source:string})=>void} hook */
export function registerMcpWorkspaceInvalidationHook(hook) {
    return MCP_WORKSPACE_INFRA.registerInvalidationHook(hook);
}

/**
 * Start a workspace-owned external watcher after canonical workspace authorization.
 * @param {string} [relativeRoot]
 */
export function startMcpWorkspaceExternalWatch(relativeRoot = 'src/copilot') {
    return MCP_WORKSPACE_INFRA.startExternalWatch(path.resolve(getMcpWorkspaceRoot(), relativeRoot));
}

/**
 * Resolve a read path without issuing a reusable opaque capability.
 *
 * @param {string} filePath
 * @returns {Promise<McpPathOk | McpPathError>}
 */
export async function resolveReadPath(filePath) {
    try {
        const resolved = await MCP_WORKSPACE_PATH_AUTHORITY.resolvePath(filePath, 'read');
        return { ok: true, resolved, relative: toWorkspaceRelativePath(resolved) };
    } catch (error) {
        return pathError(filePath, 'read', authorityFailureReason(error));
    }
}

/**
 * Resolve a read path and require issuance of the branded read-only capability.
 *
 * @param {string} filePath
 * @returns {Promise<McpValidatedReadPathOk | McpPathError>}
 */
export async function resolveValidatedReadPath(filePath) {
    try {
        const validatedReadPath = await MCP_WORKSPACE_PATH_AUTHORITY.authorizeRead(filePath, 'read');
        return {
            ok: true,
            resolved: validatedReadPath.realPath,
            relative: toWorkspaceRelativePath(validatedReadPath.realPath),
            validatedReadPath,
        };
    } catch (error) {
        return pathError(filePath, 'read', authorityFailureReason(error));
    }
}

/**
 * @param {string} filePath
 * @param {{ issueMutableCapability?: boolean }} [options]
 * @returns {Promise<McpPathOk | McpPathError>}
 */
export async function resolveWritePath(filePath, options = {}) {
    try {
        const validatedWritePath = options.issueMutableCapability
            ? await MCP_WORKSPACE_PATH_AUTHORITY.authorizeMutation(filePath, 'write')
            : undefined;
        const resolved =
            validatedWritePath?.realPath ?? (await MCP_WORKSPACE_PATH_AUTHORITY.resolvePath(filePath, 'write'));
        return {
            ok: true,
            resolved,
            relative: toWorkspaceRelativePath(resolved),
            ...(validatedWritePath === undefined ? {} : { validatedWritePath }),
        };
    } catch (error) {
        return pathError(filePath, 'write', authorityFailureReason(error));
    }
}

/**
 * @param {string} absolutePath
 * @returns {string}
 */
export function toWorkspaceRelativePath(absolutePath) {
    const relative = path.relative(getMcpWorkspaceRoot(), absolutePath);
    return relative === '' ? '.' : relative;
}

/** @param {unknown} error */
function authorityFailureReason(error) {
    const failure = /** @type {Error & { code?: string; policyReason?: string }} */ (error);
    if (failure.code === 'PATH_REQUIRED') return 'Caminho inválido: path vazio.';
    if (failure.code === 'PATH_NULL_BYTE') return 'Caminho inválido: contém byte nulo.';
    const reason = failure.policyReason ?? failure.message ?? 'Path denied.';
    return `Acesso negado: ${reason}`;
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
