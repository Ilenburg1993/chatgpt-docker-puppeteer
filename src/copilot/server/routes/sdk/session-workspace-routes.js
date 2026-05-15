// @ts-check
/**
 * Rotas HTTP de workspace SDK e convergência SDK -> FS local.
 *
 * O workspace SDK é virtual/session-scoped; materialização local deve passar pelas file-tools canônicas para preservar
 * policy, locks e observabilidade do `io-engine`.
 */

import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { IO_PATH_POLICY_VERSION, evaluateIoPathPolicyAsync } from '#copilot/core';
import { utf8ByteLength } from '#copilot/infra/public/buffer';
import { resolveSdkRouteSharedDeps } from './deps.js';
import { validateBody, withErrorHandler } from './session-middleware.js';
import { getActiveSessionEntryOrReply, withSessionRuntimeMeta } from './session-route-helpers.js';
import {
    WorkspaceCreateFileBodySchema,
    WorkspaceMaterializeBodySchema,
    WorkspaceMirrorBodySchema,
    WorkspacePromoteBodySchema,
} from './session-schemas.js';
import { validateWorkspacePath } from './session-workspace-helpers.js';

const SDK_CONVERGENCE_STATUS = Object.freeze({
    started: 'started',
    succeeded: 'succeeded',
    failed: 'failed',
});

/**
 * @typedef {ReturnType<typeof resolveSdkRouteSharedDeps>} RouteDeps
 *
 * @typedef {NonNullable<ReturnType<RouteDeps['sdkSession']['getClientSession']>>} SessionEntry
 *
 * @typedef {{ name: string; handler?: Function }} ToolLike
 */

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function normalizeSdkFilePath(value) {
    if (typeof value !== 'string') return null;
    const candidate = value.trim();
    return candidate && validateWorkspacePath(candidate).ok ? candidate : null;
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function normalizeOptionalPath(value) {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/**
 * @param {unknown} content
 * @returns {string | null}
 */
function extractTextContent(content) {
    if (typeof content === 'string') return content;
    if (content && typeof content === 'object') {
        const maybeContent = /** @type {{ content?: unknown }} */ (content).content;
        if (typeof maybeContent === 'string') return maybeContent;
    }
    return null;
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function extractWorkspaceFiles(value) {
    if (Array.isArray(value)) return value.map(String);
    if (value && typeof value === 'object') {
        const files = /** @type {{ files?: unknown }} */ (value).files;
        if (Array.isArray(files)) return files.map(String);
    }
    return [];
}

/**
 * @param {unknown} cursor
 * @param {unknown} pageSize
 * @param {number} total
 * @returns {{
 *           ok: true;
 *           enabled: boolean;
 *           offset: number;
 *           pageSize: number | null;
 *           nextCursor: string | null;
 *           endOffset: number;
 *       }
 *     | { ok: false; reason: string }}
 */
function resolveMirrorPagination(cursor, pageSize, total) {
    const enabled = typeof pageSize === 'number' && Number.isFinite(pageSize) && pageSize > 0;
    if (!enabled && (cursor === undefined || cursor === null || cursor === '')) {
        return { ok: true, enabled: false, offset: 0, pageSize: null, nextCursor: null, endOffset: total };
    }

    const offset = cursor === undefined || cursor === null || cursor === '' ? 0 : Number(cursor);
    if (!Number.isInteger(offset) || offset < 0) {
        return { ok: false, reason: 'Invalid mirror cursor.' };
    }
    if (!enabled) {
        return { ok: false, reason: 'Mirror cursor requires pageSize.' };
    }

    const normalizedPageSize = Math.max(1, Math.floor(pageSize));
    const endOffset = Math.min(total, offset + normalizedPageSize);
    return {
        ok: true,
        enabled: true,
        offset,
        pageSize: normalizedPageSize,
        nextCursor: endOffset < total ? String(endOffset) : null,
        endOffset,
    };
}

/**
 * @param {string} localPath
 * @param {string} workspaceRoot
 * @param {'read' | 'write'} [mode]
 * @returns {Promise<{ normalizedPath: string; policyDecision: 'allow'; policyReason: null }>}
 */
async function resolveLocalPathOrThrow(localPath, workspaceRoot, mode = 'write') {
    const decision = await evaluateIoPathPolicyAsync(localPath, { workspaceRoot, mode });
    if (!decision.ok) {
        const error = new Error(decision.reason);
        Object.assign(error, { code: 'ERR_LOCAL_PATH_POLICY' });
        throw error;
    }
    return {
        normalizedPath: decision.relativePath || '.',
        policyDecision: 'allow',
        policyReason: null,
    };
}

/**
 * @param {RouteDeps} routeDeps
 * @param {{
 *     operation: string;
 *     phase: string;
 *     status: 'started' | 'succeeded' | 'failed';
 *     sessionId?: string;
 *     attributes?: Record<string, unknown>;
 * }} metric
 * @returns {void}
 */
function emitConvergenceMetric(routeDeps, metric) {
    if (typeof routeDeps.sdkTelemetry?.emitOperationMetric !== 'function') {
        return;
    }
    routeDeps.sdkTelemetry.emitOperationMetric({
        operation: metric.operation,
        status: metric.status,
        ...(metric.sessionId !== undefined ? { sessionId: metric.sessionId } : {}),
        attributes: { phase: metric.phase, ...(metric.attributes ?? {}) },
    });
}

/**
 * @param {RouteDeps} routeDeps
 * @param {boolean} overwrite
 * @returns {{ name: string; handler: Function | null; buildArgs: (localPath: string, content: string) => object }}
 */
function getFileWriteTool(routeDeps, overwrite) {
    const tools = /** @type {ToolLike[]} */ (Array.isArray(routeDeps.allTools) ? routeDeps.allTools : []);
    if (overwrite) {
        const tool = tools.find((entry) => entry.name === 'write_file_content');
        return {
            name: 'write_file_content',
            handler: typeof tool?.handler === 'function' ? tool.handler : null,
            buildArgs: (localPath, content) => ({ path: localPath, content, encoding: 'utf8' }),
        };
    }
    const tool = tools.find((entry) => entry.name === 'create_file');
    return {
        name: 'create_file',
        handler: typeof tool?.handler === 'function' ? tool.handler : null,
        buildArgs: (localPath, content) => ({ path: localPath, content, overwrite: false, createParentDirs: true }),
    };
}

/**
 * @param {RouteDeps} routeDeps
 * @returns {{ name: string; handler: Function | null; buildArgs: (localPath: string) => object }}
 */
function getFileReadTool(routeDeps) {
    const tools = /** @type {ToolLike[]} */ (Array.isArray(routeDeps.allTools) ? routeDeps.allTools : []);
    const tool = tools.find((entry) => entry.name === 'read_file_content');
    return {
        name: 'read_file_content',
        handler: typeof tool?.handler === 'function' ? tool.handler : null,
        buildArgs: (localPath) => ({ path: localPath, encoding: 'utf8' }),
    };
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function extractLocalReadContent(value) {
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object') {
        const record = /** @type {Record<string, unknown>} */ (value);
        if (record['success'] === false) return null;
        if (typeof record['content'] === 'string') return record['content'];
        if (typeof record['text'] === 'string') return record['text'];
    }
    return null;
}

/**
 * @param {unknown} error
 * @returns {boolean}
 */
function isSdkWorkspaceMissingError(error) {
    const message = String(error instanceof Error ? error.message : error).toLowerCase();
    return (
        message.includes('enoent') ||
        message.includes('not found') ||
        message.includes('no such file') ||
        message.includes('missing')
    );
}

/**
 * @param {'created' | 'overwritten' | 'conflict'} action
 * @param {{ checked: boolean; overwrite: boolean; existingBytes?: number | null; reason?: string | null }} input
 * @returns {{
 *     direction: 'fs->sdk';
 *     requested: 'overwrite' | 'fail-if-exists';
 *     action: 'created' | 'overwritten' | 'conflict';
 *     checked: boolean;
 *     reason: string | null;
 *     existingBytes: number | null;
 * }}
 */
function buildPromoteAudit(action, input) {
    return {
        direction: 'fs->sdk',
        requested: input.overwrite ? 'overwrite' : 'fail-if-exists',
        action,
        checked: input.checked,
        reason: input.reason ?? null,
        existingBytes: input.existingBytes ?? null,
    };
}

/**
 * @param {import('express').Response} res
 * @param {RouteDeps} routeDeps
 * @param {Record<string, unknown>} payload
 * @param {string} sessionId
 * @returns {void}
 */
function sendOk(res, routeDeps, payload, sessionId) {
    res.json(withSessionRuntimeMeta(routeDeps, { ok: true, ...payload }, sessionId));
}

/**
 * @param {import('express').Response} res
 * @param {RouteDeps} routeDeps
 * @param {number} status
 * @param {string} error
 * @param {string} message
 * @returns {void}
 */
function sendError(res, routeDeps, status, error, message) {
    res.status(status).json({
        ok: false,
        ...routeDeps.sdkRuntimeProjection.buildRuntimeRouteMetaPayload(routeDeps),
        error: message,
        code: error,
        message,
    });
}

/**
 * @param {import('express').Router} router
 * @returns {void}
 */
export function registerSessionWorkspaceRoutes(router) {
    router.get('/sessions/:id/workspace/files', (req, res) => {
        void withErrorHandler(req, res, async () => {
            const routeDeps = resolveSdkRouteSharedDeps(req);
            const id = /** @type {string} */ (req.params['id']);
            const entry = getActiveSessionEntryOrReply(routeDeps, id, res);
            if (!entry) return;

            const result = await routeDeps.sdkSessionRpc.workspaceListFiles(entry.session);
            sendOk(res, routeDeps, { files: extractWorkspaceFiles(result) }, id);
        });
    });

    router.get('/sessions/:id/workspace/file', (req, res) => {
        void withErrorHandler(req, res, async () => {
            const routeDeps = resolveSdkRouteSharedDeps(req);
            const id = /** @type {string} */ (req.params['id']);
            const entry = getActiveSessionEntryOrReply(routeDeps, id, res);
            if (!entry) return;

            const filePath = normalizeSdkFilePath(req.query['path']);
            if (!filePath) {
                sendError(res, routeDeps, 400, 'INVALID_PATH', 'Query parameter "path" is required.');
                return;
            }

            const content = await routeDeps.sdkSessionRpc.workspaceReadFile(entry.session, filePath);
            sendOk(res, routeDeps, { filePath, content }, id);
        });
    });

    router.post('/sessions/:id/workspace/file', validateBody(WorkspaceCreateFileBodySchema), (req, res) => {
        void withErrorHandler(req, res, async () => {
            const routeDeps = resolveSdkRouteSharedDeps(req);
            const id = /** @type {string} */ (req.params['id']);
            const entry = getActiveSessionEntryOrReply(routeDeps, id, res);
            if (!entry) return;

            const filePath = normalizeSdkFilePath(req.body?.path);
            if (!filePath) {
                sendError(res, routeDeps, 400, 'INVALID_PATH', 'Invalid workspace SDK path.');
                return;
            }

            const result = await routeDeps.sdkSessionRpc.workspaceCreateFile(entry.session, filePath, req.body.content);
            sendOk(res, routeDeps, { filePath, result }, id);
        });
    });

    router.post('/sessions/:id/workspace/materialize', validateBody(WorkspaceMaterializeBodySchema), (req, res) => {
        void withErrorHandler(req, res, async () => {
            const routeDeps = resolveSdkRouteSharedDeps(req);
            const id = /** @type {string} */ (req.params['id']);
            const entry = getActiveSessionEntryOrReply(routeDeps, id, res);
            if (!entry) return;

            const sdkPath = normalizeSdkFilePath(req.body?.path);
            if (!sdkPath) {
                sendError(res, routeDeps, 400, 'INVALID_PATH', 'Invalid workspace SDK path.');
                return;
            }

            const traceId = randomUUID();
            const overwrite = req.body?.overwrite === true;
            const workspaceRoot = process.cwd();
            const desiredLocalPath = normalizeOptionalPath(req.body?.destinationPath) ?? sdkPath;
            let localPath;
            try {
                localPath = await resolveLocalPathOrThrow(desiredLocalPath, workspaceRoot, 'write');
            } catch (error) {
                sendError(
                    res,
                    routeDeps,
                    400,
                    'INVALID_LOCAL_PATH',
                    String(error instanceof Error ? error.message : error),
                );
                return;
            }

            emitConvergenceMetric(routeDeps, {
                operation: 'workspace.materialize',
                phase: 'read_sdk',
                status: SDK_CONVERGENCE_STATUS.started,
                sessionId: id,
                attributes: { traceId, sdkPath, localPath: localPath.normalizedPath, overwrite },
            });
            const sdkContentRaw = await routeDeps.sdkSessionRpc.workspaceReadFile(entry.session, sdkPath);
            const sdkContent = extractTextContent(sdkContentRaw);
            if (sdkContent === null) {
                emitConvergenceMetric(routeDeps, {
                    operation: 'workspace.materialize',
                    phase: 'read_sdk',
                    status: SDK_CONVERGENCE_STATUS.failed,
                    sessionId: id,
                    attributes: {
                        traceId,
                        sdkPath,
                        localPath: localPath.normalizedPath,
                        overwrite,
                        reason: 'non-textual-content',
                    },
                });
                sendError(
                    res,
                    routeDeps,
                    422,
                    'NON_TEXT_CONTENT',
                    'Workspace content is not textual and cannot be materialized.',
                );
                return;
            }

            emitConvergenceMetric(routeDeps, {
                operation: 'workspace.materialize',
                phase: 'read_sdk',
                status: SDK_CONVERGENCE_STATUS.succeeded,
                sessionId: id,
                attributes: {
                    traceId,
                    sdkPath,
                    localPath: localPath.normalizedPath,
                    overwrite,
                    bytes: utf8ByteLength(sdkContent, 'sdk workspace content'),
                },
            });

            const tool = getFileWriteTool(routeDeps, overwrite);
            if (!tool.handler) {
                sendError(res, routeDeps, 503, 'MISSING_FILE_TOOL', `Required file tool is unavailable: ${tool.name}`);
                return;
            }

            emitConvergenceMetric(routeDeps, {
                operation: 'workspace.materialize',
                phase: 'write_local',
                status: SDK_CONVERGENCE_STATUS.started,
                sessionId: id,
                attributes: { traceId, sdkPath, localPath: localPath.normalizedPath, overwrite },
            });
            const writeResult = await tool.handler(tool.buildArgs(localPath.normalizedPath, sdkContent));
            emitConvergenceMetric(routeDeps, {
                operation: 'workspace.materialize',
                phase: 'write_local',
                status: SDK_CONVERGENCE_STATUS.succeeded,
                sessionId: id,
                attributes: {
                    traceId,
                    sdkPath,
                    localPath: localPath.normalizedPath,
                    overwrite,
                    bytes: utf8ByteLength(sdkContent, 'sdk workspace content'),
                },
            });

            sendOk(
                res,
                routeDeps,
                {
                    result: {
                        sdkPath,
                        localPath: localPath.normalizedPath,
                        overwrite,
                        traceId,
                        io: {
                            operation: 'write',
                            target: 'file',
                            policyVersion: IO_PATH_POLICY_VERSION,
                            policyDecision: localPath.policyDecision,
                            policyReason: localPath.policyReason,
                            traceId,
                        },
                        write: writeResult,
                    },
                },
                id,
            );
        });
    });

    router.post('/sessions/:id/workspace/mirror', validateBody(WorkspaceMirrorBodySchema), (req, res) => {
        void withErrorHandler(req, res, async () => {
            const routeDeps = resolveSdkRouteSharedDeps(req);
            const id = /** @type {string} */ (req.params['id']);
            const entry = getActiveSessionEntryOrReply(routeDeps, id, res);
            if (!entry) return;

            const overwrite = req.body?.overwrite === true;
            const workspaceRoot = process.cwd();
            let destinationRoot;
            try {
                destinationRoot = await resolveLocalPathOrThrow(
                    normalizeOptionalPath(req.body?.destinationRoot) ?? '.',
                    workspaceRoot,
                    'write',
                );
            } catch (error) {
                sendError(
                    res,
                    routeDeps,
                    400,
                    'INVALID_LOCAL_PATH',
                    String(error instanceof Error ? error.message : error),
                );
                return;
            }

            const tool = getFileWriteTool(routeDeps, overwrite);
            if (!tool.handler) {
                sendError(res, routeDeps, 503, 'MISSING_FILE_TOOL', `Required file tool is unavailable: ${tool.name}`);
                return;
            }

            const filesResult = await routeDeps.sdkSessionRpc.workspaceListFiles(entry.session);
            const sdkPaths = extractWorkspaceFiles(filesResult);
            const pagination = resolveMirrorPagination(req.body?.cursor, req.body?.pageSize, sdkPaths.length);
            if (!pagination.ok) {
                sendError(res, routeDeps, 400, 'INVALID_CURSOR', pagination.reason);
                return;
            }
            const selectedSdkPaths = pagination.enabled
                ? sdkPaths.slice(pagination.offset, pagination.endOffset)
                : sdkPaths;
            /**
             * @type {{
             *     sdkPath: string;
             *     localPath: string;
             *     status: 'ok' | 'failed' | 'skipped';
             *     traceId: string;
             *     reason?: string;
             *     io?: object;
             *     write?: unknown;
             * }[]}
             */
            const items = [];

            for (const maybeSdkPath of selectedSdkPaths) {
                const sdkPath = normalizeSdkFilePath(maybeSdkPath);
                const traceId = randomUUID();
                if (!sdkPath) {
                    items.push({
                        sdkPath: maybeSdkPath,
                        localPath: '',
                        status: 'failed',
                        traceId,
                        reason: 'invalid-sdk-path',
                    });
                    continue;
                }

                const localCandidate = path.posix.join(destinationRoot.normalizedPath, sdkPath);
                let localPath;
                try {
                    localPath = await resolveLocalPathOrThrow(localCandidate, workspaceRoot, 'write');
                } catch (error) {
                    items.push({
                        sdkPath,
                        localPath: localCandidate,
                        status: 'failed',
                        traceId,
                        reason: String(error instanceof Error ? error.message : error),
                    });
                    continue;
                }

                emitConvergenceMetric(routeDeps, {
                    operation: 'workspace.mirror',
                    phase: 'read_sdk',
                    status: SDK_CONVERGENCE_STATUS.started,
                    sessionId: id,
                    attributes: { traceId, sdkPath, localPath: localPath.normalizedPath, overwrite },
                });
                const sdkContentRaw = await routeDeps.sdkSessionRpc.workspaceReadFile(entry.session, sdkPath);
                const sdkContent = extractTextContent(sdkContentRaw);
                if (sdkContent === null) {
                    emitConvergenceMetric(routeDeps, {
                        operation: 'workspace.mirror',
                        phase: 'read_sdk',
                        status: SDK_CONVERGENCE_STATUS.failed,
                        sessionId: id,
                        attributes: {
                            traceId,
                            sdkPath,
                            localPath: localPath.normalizedPath,
                            overwrite,
                            reason: 'non-textual-content',
                        },
                    });
                    items.push({
                        sdkPath,
                        localPath: localPath.normalizedPath,
                        status: 'skipped',
                        traceId,
                        reason: 'non-textual-content',
                    });
                    continue;
                }

                emitConvergenceMetric(routeDeps, {
                    operation: 'workspace.mirror',
                    phase: 'read_sdk',
                    status: SDK_CONVERGENCE_STATUS.succeeded,
                    sessionId: id,
                    attributes: {
                        traceId,
                        sdkPath,
                        localPath: localPath.normalizedPath,
                        overwrite,
                        bytes: utf8ByteLength(sdkContent, 'sdk workspace content'),
                    },
                });
                emitConvergenceMetric(routeDeps, {
                    operation: 'workspace.mirror',
                    phase: 'write_local',
                    status: SDK_CONVERGENCE_STATUS.started,
                    sessionId: id,
                    attributes: { traceId, sdkPath, localPath: localPath.normalizedPath, overwrite },
                });
                const writeResult = await tool.handler(tool.buildArgs(localPath.normalizedPath, sdkContent));
                emitConvergenceMetric(routeDeps, {
                    operation: 'workspace.mirror',
                    phase: 'write_local',
                    status: SDK_CONVERGENCE_STATUS.succeeded,
                    sessionId: id,
                    attributes: {
                        traceId,
                        sdkPath,
                        localPath: localPath.normalizedPath,
                        overwrite,
                        bytes: utf8ByteLength(sdkContent, 'sdk workspace content'),
                    },
                });

                items.push({
                    sdkPath,
                    localPath: localPath.normalizedPath,
                    status: 'ok',
                    traceId,
                    io: {
                        operation: 'write',
                        target: 'file',
                        policyVersion: IO_PATH_POLICY_VERSION,
                        policyDecision: localPath.policyDecision,
                        policyReason: localPath.policyReason,
                        traceId,
                    },
                    write: writeResult,
                });
            }

            const summary = {
                total: items.length,
                ok: items.filter((item) => item.status === 'ok').length,
                failed: items.filter((item) => item.status === 'failed').length,
                skipped: items.filter((item) => item.status === 'skipped').length,
            };

            sendOk(
                res,
                routeDeps,
                {
                    result: {
                        destinationRoot: destinationRoot.normalizedPath,
                        overwrite,
                        summary,
                        pagination: {
                            enabled: pagination.enabled,
                            totalFiles: sdkPaths.length,
                            returnedFiles: selectedSdkPaths.length,
                            offset: pagination.offset,
                            pageSize: pagination.pageSize,
                            nextCursor: pagination.nextCursor,
                            advisoryMaxFiles:
                                typeof req.body?.maxFiles === 'number' && Number.isFinite(req.body.maxFiles)
                                    ? req.body.maxFiles
                                    : null,
                        },
                        items,
                    },
                },
                id,
            );
        });
    });

    router.post('/sessions/:id/workspace/promote', validateBody(WorkspacePromoteBodySchema), (req, res) => {
        void withErrorHandler(req, res, async () => {
            const routeDeps = resolveSdkRouteSharedDeps(req);
            const id = /** @type {string} */ (req.params['id']);
            const entry = getActiveSessionEntryOrReply(routeDeps, id, res);
            if (!entry) return;

            const traceId = randomUUID();
            const overwrite = req.body?.overwrite === true;
            const workspaceRoot = process.cwd();
            let localPath;
            try {
                localPath = await resolveLocalPathOrThrow(String(req.body?.sourcePath ?? ''), workspaceRoot, 'read');
            } catch (error) {
                sendError(
                    res,
                    routeDeps,
                    400,
                    'INVALID_LOCAL_PATH',
                    String(error instanceof Error ? error.message : error),
                );
                return;
            }

            const sdkPath = normalizeSdkFilePath(req.body?.destinationPath ?? localPath.normalizedPath);
            if (!sdkPath) {
                sendError(res, routeDeps, 400, 'INVALID_PATH', 'Invalid workspace SDK destination path.');
                return;
            }

            const readTool = getFileReadTool(routeDeps);
            if (!readTool.handler) {
                sendError(
                    res,
                    routeDeps,
                    503,
                    'MISSING_FILE_TOOL',
                    `Required file tool is unavailable: ${readTool.name}`,
                );
                return;
            }

            emitConvergenceMetric(routeDeps, {
                operation: 'workspace.promote',
                phase: 'read_local',
                status: SDK_CONVERGENCE_STATUS.started,
                sessionId: id,
                attributes: { traceId, localPath: localPath.normalizedPath, sdkPath, overwrite },
            });
            const readResult = await readTool.handler(readTool.buildArgs(localPath.normalizedPath));
            const localContent = extractLocalReadContent(readResult);
            if (localContent === null) {
                emitConvergenceMetric(routeDeps, {
                    operation: 'workspace.promote',
                    phase: 'read_local',
                    status: SDK_CONVERGENCE_STATUS.failed,
                    sessionId: id,
                    attributes: {
                        traceId,
                        localPath: localPath.normalizedPath,
                        sdkPath,
                        overwrite,
                        reason: 'non-textual-or-read-failed',
                    },
                });
                sendError(res, routeDeps, 422, 'LOCAL_READ_FAILED', 'Local file is not textual or could not be read.');
                return;
            }

            const bytes = utf8ByteLength(localContent, 'sdk workspace local content');
            emitConvergenceMetric(routeDeps, {
                operation: 'workspace.promote',
                phase: 'read_local',
                status: SDK_CONVERGENCE_STATUS.succeeded,
                sessionId: id,
                attributes: { traceId, localPath: localPath.normalizedPath, sdkPath, overwrite, bytes },
            });

            let audit = buildPromoteAudit(overwrite ? 'overwritten' : 'created', {
                checked: false,
                overwrite,
                reason: overwrite ? 'overwrite-requested' : 'destination-not-found',
            });
            if (!overwrite) {
                emitConvergenceMetric(routeDeps, {
                    operation: 'workspace.promote',
                    phase: 'conflict_check',
                    status: SDK_CONVERGENCE_STATUS.started,
                    sessionId: id,
                    attributes: { traceId, localPath: localPath.normalizedPath, sdkPath, overwrite },
                });
                try {
                    const existingRaw = await routeDeps.sdkSessionRpc.workspaceReadFile(entry.session, sdkPath);
                    const existingContent = extractTextContent(existingRaw);
                    audit = buildPromoteAudit('conflict', {
                        checked: true,
                        overwrite,
                        existingBytes:
                            existingContent === null
                                ? null
                                : utf8ByteLength(existingContent, 'sdk workspace existing content'),
                        reason: 'destination-exists',
                    });
                    emitConvergenceMetric(routeDeps, {
                        operation: 'workspace.promote',
                        phase: 'conflict_check',
                        status: SDK_CONVERGENCE_STATUS.failed,
                        sessionId: id,
                        attributes: {
                            traceId,
                            localPath: localPath.normalizedPath,
                            sdkPath,
                            overwrite,
                            reason: audit.reason,
                            existingBytes: audit.existingBytes,
                        },
                    });
                    res.status(409).json(
                        withSessionRuntimeMeta(
                            routeDeps,
                            {
                                ok: false,
                                code: 'SDK_DESTINATION_CONFLICT',
                                error: 'Workspace SDK destination already exists.',
                                message: 'Workspace SDK destination already exists.',
                                result: {
                                    sdkPath,
                                    localPath: localPath.normalizedPath,
                                    overwrite,
                                    traceId,
                                    audit,
                                },
                            },
                            id,
                        ),
                    );
                    return;
                } catch (error) {
                    if (!isSdkWorkspaceMissingError(error)) {
                        emitConvergenceMetric(routeDeps, {
                            operation: 'workspace.promote',
                            phase: 'conflict_check',
                            status: SDK_CONVERGENCE_STATUS.failed,
                            sessionId: id,
                            attributes: {
                                traceId,
                                localPath: localPath.normalizedPath,
                                sdkPath,
                                overwrite,
                                reason: String(error instanceof Error ? error.message : error),
                            },
                        });
                        throw error;
                    }
                    emitConvergenceMetric(routeDeps, {
                        operation: 'workspace.promote',
                        phase: 'conflict_check',
                        status: SDK_CONVERGENCE_STATUS.succeeded,
                        sessionId: id,
                        attributes: {
                            traceId,
                            localPath: localPath.normalizedPath,
                            sdkPath,
                            overwrite,
                            reason: 'destination-not-found',
                        },
                    });
                    audit = buildPromoteAudit('created', {
                        checked: true,
                        overwrite,
                        reason: 'destination-not-found',
                    });
                }
            }

            emitConvergenceMetric(routeDeps, {
                operation: 'workspace.promote',
                phase: 'write_sdk',
                status: SDK_CONVERGENCE_STATUS.started,
                sessionId: id,
                attributes: { traceId, localPath: localPath.normalizedPath, sdkPath, overwrite, bytes },
            });
            const writeResult = await routeDeps.sdkSessionRpc.workspaceCreateFile(entry.session, sdkPath, localContent);
            emitConvergenceMetric(routeDeps, {
                operation: 'workspace.promote',
                phase: 'write_sdk',
                status: SDK_CONVERGENCE_STATUS.succeeded,
                sessionId: id,
                attributes: { traceId, localPath: localPath.normalizedPath, sdkPath, overwrite, bytes },
            });

            sendOk(
                res,
                routeDeps,
                {
                    result: {
                        sdkPath,
                        localPath: localPath.normalizedPath,
                        overwrite,
                        traceId,
                        audit,
                        io: {
                            operation: 'read',
                            target: 'file',
                            policyVersion: IO_PATH_POLICY_VERSION,
                            policyDecision: localPath.policyDecision,
                            policyReason: localPath.policyReason,
                            traceId,
                        },
                        write: writeResult,
                    },
                },
                id,
            );
        });
    });
}

export const registerSdkSessionWorkspaceRoutes = registerSessionWorkspaceRoutes;
