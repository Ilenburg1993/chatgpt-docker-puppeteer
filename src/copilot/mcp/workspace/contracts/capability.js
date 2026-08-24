// @ts-check
/**
 * Canonical MCP workspace capability.
 *
 * This module is pure: it never discovers boot/application infrastructure and owns no process-global binding. The
 * composition root supplies an already-owned WorkspaceInfra port and receives an immutable capability that can be
 * passed to request OperationContext or process-scoped services.
 *
 * @module copilot/mcp/workspace/contracts/capability
 */

import path from 'node:path';

/**
 * @typedef {import('#copilot/infra/public/composition/workspace/authority').WorkspacePathAuthority} WorkspacePathAuthority
 * @typedef {ReturnType<typeof import('#copilot/infra/public/composition/workspace/io').createWorkspaceIo>} WorkspaceIo
 * @typedef {ReturnType<typeof import('#copilot/infra/public/composition/workspace/indexing').createWorkspaceIndexing>} WorkspaceIndexing
 * @typedef {{
 *     authority: WorkspacePathAuthority;
 *     io: WorkspaceIo;
 *     indexing: WorkspaceIndexing;
 *     registerInvalidationHook: (hook:(filePath:string,event:{recursive:boolean;source:string})=>void) => () => void;
 *     acquireExternalWatch: (rootPath?:string, options?:Record<string, unknown>) => Promise<Readonly<{
 *         started: boolean;
 *         release: () => boolean;
 *         [key:string]: unknown;
 *     }>>;
 * }} McpWorkspaceInfraPort
 *
 * @typedef {{
 *     ok: true;
 *     resolved: string;
 *     relative: string;
 *     validatedReadPath?: import('#copilot/infra/public/composition/workspace/authority').ValidatedReadWorkspacePath;
 *     validatedWritePath?: import('#copilot/infra/public/composition/workspace/authority').ValidatedMutableWorkspacePath;
 * }} McpPathOk
 * @typedef {McpPathOk & { validatedReadPath: import('#copilot/infra/public/composition/workspace/authority').ValidatedReadWorkspacePath }} McpValidatedReadPathOk
 * @typedef {{
 *     ok: false;
 *     reason: string;
 *     code: 'ERR_EMPTY_PATH' | 'ERR_NULL_BYTE_PATH' | 'ERR_PATH_DENIED' | 'ERR_INVALID_PATH';
 *     hint: string;
 *     inputPath: string;
 *     mode: 'read' | 'write';
 * }} McpPathError
 *
 * @typedef {Readonly<{
 *     workspaceRoot: string;
 *     io: WorkspaceIo;
 *     indexing: WorkspaceIndexing;
 *     indexRegistry: NonNullable<WorkspaceIndexing['registry']>;
 *     resolveReadPath: (filePath:string) => Promise<McpPathOk | McpPathError>;
 *     resolveValidatedReadPath: (filePath:string) => Promise<McpValidatedReadPathOk | McpPathError>;
 *     resolveWritePath: (filePath:string, options?:{ issueMutableCapability?: boolean }) => Promise<McpPathOk | McpPathError>;
 *     toRelativePath: (absolutePath:string) => string;
 *     registerInvalidationHook: McpWorkspaceInfraPort['registerInvalidationHook'];
 *     acquireExternalWatch: (relativeRoot?:string) => ReturnType<McpWorkspaceInfraPort['acquireExternalWatch']>;
 * }>} McpWorkspaceCapability
 */

/**
 * @param {McpWorkspaceInfraPort} workspaceInfra
 * @returns {McpWorkspaceCapability}
 */
export function createMcpWorkspaceCapability(workspaceInfra) {
    if (!workspaceInfra?.authority || !workspaceInfra.io || !workspaceInfra.indexing) {
        throw new TypeError('createMcpWorkspaceCapability requires workspace authority, IO and indexing capabilities.');
    }
    const authority = workspaceInfra.authority;
    const workspaceRoot = authority.workspaceRoot;
    const indexRegistry = workspaceInfra.indexing.registry;
    if (!indexRegistry) throw new Error('MCP workspace requires a runtime-owned persistent index registry.');

    /** @param {string} absolutePath */
    const toRelativePath = (absolutePath) => {
        const relative = path.relative(workspaceRoot, absolutePath);
        return relative === '' ? '.' : relative;
    };

    /** @param {string} filePath @returns {Promise<McpPathOk | McpPathError>} */
    async function resolveReadPath(filePath) {
        try {
            const resolved = await authority.resolvePath(filePath, 'read');
            return { ok: true, resolved, relative: toRelativePath(resolved) };
        } catch (error) {
            return pathError(filePath, 'read', authorityFailureReason(error));
        }
    }

    /** @param {string} filePath @returns {Promise<McpValidatedReadPathOk | McpPathError>} */
    async function resolveValidatedReadPath(filePath) {
        try {
            const validatedReadPath = await authority.authorizeRead(filePath, 'read');
            return {
                ok: true,
                resolved: validatedReadPath.realPath,
                relative: toRelativePath(validatedReadPath.realPath),
                validatedReadPath,
            };
        } catch (error) {
            return pathError(filePath, 'read', authorityFailureReason(error));
        }
    }

    /** @param {string} filePath @param {{ issueMutableCapability?: boolean }} [options] @returns {Promise<McpPathOk | McpPathError>} */
    async function resolveWritePath(filePath, options = {}) {
        try {
            const validatedWritePath = options.issueMutableCapability
                ? await authority.authorizeMutation(filePath, 'write')
                : undefined;
            const resolved = validatedWritePath?.realPath ?? (await authority.resolvePath(filePath, 'write'));
            return {
                ok: true,
                resolved,
                relative: toRelativePath(resolved),
                ...(validatedWritePath === undefined ? {} : { validatedWritePath }),
            };
        } catch (error) {
            return pathError(filePath, 'write', authorityFailureReason(error));
        }
    }

    /** @type {McpWorkspaceCapability} */
    const capability = {
        workspaceRoot,
        io: workspaceInfra.io,
        indexing: workspaceInfra.indexing,
        indexRegistry,
        resolveReadPath,
        resolveValidatedReadPath,
        resolveWritePath,
        toRelativePath,
        registerInvalidationHook: (hook) => workspaceInfra.registerInvalidationHook(hook),
        acquireExternalWatch: (relativeRoot = 'src/copilot') =>
            workspaceInfra.acquireExternalWatch(path.resolve(workspaceRoot, relativeRoot)),
    };
    return Object.freeze(capability);
}

/** @param {unknown} error */
function authorityFailureReason(error) {
    const failure = /** @type {Error & { code?: string; policyReason?: string }} */ (error);
    if (failure.code === 'PATH_REQUIRED') return 'Caminho inválido: path vazio.';
    if (failure.code === 'PATH_NULL_BYTE') return 'Caminho inválido: contém byte nulo.';
    const reason = failure.policyReason ?? failure.message ?? 'Path denied.';
    return `Acesso negado: ${reason}`;
}

/** @param {string} filePath @param {'read'|'write'} mode @param {string} reason @returns {McpPathError} */
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

/** @param {string} reason @returns {McpPathError['code']} */
function classifyPathError(reason) {
    const normalized = reason.toLowerCase();
    if (normalized.includes('path vazio')) return 'ERR_EMPTY_PATH';
    if (normalized.includes('byte nulo') || normalized.includes('null byte')) return 'ERR_NULL_BYTE_PATH';
    if (normalized.includes('acesso negado') || normalized.includes('denied')) return 'ERR_PATH_DENIED';
    return 'ERR_INVALID_PATH';
}

/** @param {string} reason */
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
