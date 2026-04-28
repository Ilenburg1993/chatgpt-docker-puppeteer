// @ts-check
/**
 * src/copilot/sdk/session/session-fs.js
 *
 * Helpers canônicos para promover SessionFs no runtime local do Copilot. Mantém em L1 tanto a configuração client-side
 * (`CopilotClientOptions.sessionFs`) quanto o handler session-level (`createSessionFsHandler`), sem reabrir o vendor
 * SDK fora da wrapper layer.
 *
 * @module copilot/sdk/session/session-fs
 */

import {
    appendFile as fsAppendFile,
    mkdir as fsMkdir,
    readFile as fsReadFile,
    readdir as fsReaddir,
    rename as fsRename,
    rm as fsRm,
    stat as fsStat,
    writeFile as fsWriteFile,
} from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { readCopilotSessionFsBootConfig } from '../../boot/session-fs.js';
import { classifySdkError } from '../errors.js';
import { log } from '../logger.js';
import { emitSdkOperationMetric } from '../telemetry/operation-metrics.js';

/**
 * @typedef {import('../types.js').SessionFsProvider} SessionFsProvider
 *
 * @typedef {import('../types.js').CreateSessionFsHandler} CreateSessionFsHandler
 *
 * @typedef {import('../types.js').CopilotSession} CopilotSession
 */

/**
 * @param {string | undefined} path
 * @returns {number | undefined}
 */
function safePathDepth(path) {
    if (typeof path !== 'string') return undefined;
    try {
        return normalizeRelativeSegments(path).length;
    } catch {
        return undefined;
    }
}

/**
 * @param {string} operation
 * @param {() => Promise<any>} action
 * @param {{ sessionId?: string; successAttributes?: Record<string, unknown> }} [context]
 * @returns {Promise<any>}
 */
async function instrumentSessionFsOperation(operation, action, context = {}) {
    const startedAt = Date.now();
    emitSdkOperationMetric({ operation, status: 'started', ...withOptionalSessionId(context.sessionId) });
    try {
        const result = await action();
        emitSdkOperationMetric({
            operation,
            status: 'succeeded',
            durationMs: Date.now() - startedAt,
            ...withOptionalSessionId(context.sessionId),
            ...(context?.successAttributes ? { attributes: context.successAttributes } : {}),
        });
        return result;
    } catch (error) {
        emitSdkOperationMetric({
            operation,
            status: 'failed',
            durationMs: Date.now() - startedAt,
            ...withOptionalSessionId(context.sessionId),
            attributes: {
                ...(context?.successAttributes ?? {}),
                errorKind: classifySdkError(error),
            },
        });
        throw error;
    }
}

/**
 * @param {string} inputPath
 * @returns {string[]}
 */
function normalizeRelativeSegments(inputPath) {
    if (typeof inputPath !== 'string') {
        throw new TypeError('[sdk/session-fs] path deve ser string.');
    }

    const raw = inputPath.trim();
    if (raw === '' || raw === '.') return [];
    const segments = raw.replace(/\\/gu, '/').split('/').filter(Boolean);
    if (segments.some((segment) => segment === '..')) {
        const error = new Error('[sdk/session-fs] path traversal não é permitido.');
        /** @type {{ code?: string }} */ (error).code = 'EINVAL';
        throw error;
    }
    return segments;
}

/**
 * @param {string} rootDir
 * @param {string} inputPath
 * @returns {string}
 */
function resolveWithinRoot(rootDir, inputPath) {
    const segments = normalizeRelativeSegments(inputPath);
    return resolve(rootDir, ...segments);
}

/**
 * @param {string | undefined} sessionId
 * @returns {{ sessionId?: string }}
 */
function withOptionalSessionId(sessionId) {
    return typeof sessionId === 'string' && sessionId.trim() ? { sessionId } : {};
}

/**
 * @param {string | undefined} sessionId
 * @param {Record<string, unknown>} [successAttributes]
 * @returns {{ sessionId?: string; successAttributes?: Record<string, unknown> }}
 */
function createOperationContext(sessionId, successAttributes) {
    return {
        ...withOptionalSessionId(sessionId),
        ...(successAttributes ? { successAttributes } : {}),
    };
}

/**
 * @param {string} sessionId
 * @returns {string}
 */
function toSessionStorageKey(sessionId) {
    if (typeof sessionId !== 'string' || sessionId.trim() === '') {
        throw new TypeError('[sdk/session-fs] session.sessionId deve ser string não-vazia.');
    }
    return encodeURIComponent(sessionId.trim());
}

/**
 * Cria um provider local baseado em `node:fs/promises`, isolado em um diretório-raiz.
 *
 * @param {string} rootDir
 * @param {{ sessionId?: string }} [options]
 * @returns {SessionFsProvider}
 */
export function createLocalSessionFsProvider(rootDir, options = {}) {
    if (typeof rootDir !== 'string' || rootDir.trim() === '') {
        throw new TypeError('[sdk/session-fs] rootDir deve ser string não-vazia.');
    }

    const root = resolve(rootDir);
    const sessionId = typeof options.sessionId === 'string' && options.sessionId.trim() ? options.sessionId : undefined;

    return {
        async readFile(path) {
            return instrumentSessionFsOperation(
                'session.fs.readFile',
                async () => {
                    const target = resolveWithinRoot(root, path);
                    return fsReadFile(target, 'utf8');
                },
                createOperationContext(sessionId, { provider: 'local', pathDepth: safePathDepth(path) }),
            );
        },
        async writeFile(path, content, mode) {
            return instrumentSessionFsOperation(
                'session.fs.writeFile',
                async () => {
                    const target = resolveWithinRoot(root, path);
                    await fsMkdir(dirname(target), { recursive: true });
                    await fsWriteFile(target, content, { encoding: 'utf8', mode });
                },
                createOperationContext(sessionId, {
                    provider: 'local',
                    pathDepth: safePathDepth(path),
                    contentLength: typeof content === 'string' ? content.length : undefined,
                }),
            );
        },
        async appendFile(path, content, mode) {
            return instrumentSessionFsOperation(
                'session.fs.appendFile',
                async () => {
                    const target = resolveWithinRoot(root, path);
                    await fsMkdir(dirname(target), { recursive: true });
                    await fsAppendFile(target, content, { encoding: 'utf8', mode });
                },
                createOperationContext(sessionId, {
                    provider: 'local',
                    pathDepth: safePathDepth(path),
                    contentLength: typeof content === 'string' ? content.length : undefined,
                }),
            );
        },
        async exists(path) {
            return instrumentSessionFsOperation(
                'session.fs.exists',
                async () => {
                    try {
                        await fsStat(resolveWithinRoot(root, path));
                        return true;
                    } catch {
                        return false;
                    }
                },
                createOperationContext(sessionId, { provider: 'local', pathDepth: safePathDepth(path) }),
            );
        },
        async stat(path) {
            return instrumentSessionFsOperation(
                'session.fs.stat',
                async () => {
                    const target = resolveWithinRoot(root, path);
                    const stats = await fsStat(target);
                    return {
                        isFile: stats.isFile(),
                        isDirectory: stats.isDirectory(),
                        size: stats.size,
                        mtime: stats.mtime.toISOString(),
                        birthtime: stats.birthtime.toISOString(),
                    };
                },
                createOperationContext(sessionId, { provider: 'local', pathDepth: safePathDepth(path) }),
            );
        },
        async mkdir(path, recursive, mode) {
            return instrumentSessionFsOperation(
                'session.fs.mkdir',
                async () => {
                    const target = resolveWithinRoot(root, path);
                    await fsMkdir(target, { recursive, mode });
                },
                createOperationContext(sessionId, {
                    provider: 'local',
                    pathDepth: safePathDepth(path),
                    recursive: Boolean(recursive),
                }),
            );
        },
        async readdir(path) {
            return instrumentSessionFsOperation(
                'session.fs.readdir',
                async () => fsReaddir(resolveWithinRoot(root, path)),
                createOperationContext(sessionId, { provider: 'local', pathDepth: safePathDepth(path) }),
            );
        },
        async readdirWithTypes(path) {
            return instrumentSessionFsOperation(
                'session.fs.readdirWithTypes',
                async () => {
                    const entries = await fsReaddir(resolveWithinRoot(root, path), { withFileTypes: true });
                    return entries.map((entry) => ({
                        name: entry.name,
                        type: entry.isDirectory() ? 'directory' : 'file',
                    }));
                },
                createOperationContext(sessionId, { provider: 'local', pathDepth: safePathDepth(path) }),
            );
        },
        async rm(path, recursive, force) {
            return instrumentSessionFsOperation(
                'session.fs.rm',
                async () => {
                    await fsRm(resolveWithinRoot(root, path), { recursive, force });
                },
                createOperationContext(sessionId, {
                    provider: 'local',
                    pathDepth: safePathDepth(path),
                    recursive: Boolean(recursive),
                    force: Boolean(force),
                }),
            );
        },
        async rename(src, dest) {
            return instrumentSessionFsOperation(
                'session.fs.rename',
                async () => {
                    const srcTarget = resolveWithinRoot(root, src);
                    const destTarget = resolveWithinRoot(root, dest);
                    await fsMkdir(dirname(destTarget), { recursive: true });
                    await fsRename(srcTarget, destTarget);
                },
                createOperationContext(sessionId, {
                    provider: 'local',
                    sourceDepth: safePathDepth(src),
                    destinationDepth: safePathDepth(dest),
                }),
            );
        },
    };
}

/**
 * Cria um handler de SessionFs por sessão, persistindo os arquivos de cada sessão em um subdiretório dedicado.
 *
 * @param {{ storageRootDir?: string }} [options]
 * @returns {CreateSessionFsHandler}
 */
export function createWorkspaceSessionFsHandler(options = {}) {
    const bootConfig = readCopilotSessionFsBootConfig();
    const storageRootDir = options.storageRootDir ?? bootConfig.storageRootDir;

    return (session) => {
        emitSdkOperationMetric({
            operation: 'session.fs.handler.create',
            status: 'started',
            sessionId: session.sessionId,
        });
        const sessionKey = toSessionStorageKey(session.sessionId);
        const rootDir = resolve(storageRootDir, sessionKey);
        log('DEBUG', `[sdk/session-fs] provider local criado para sessão '${session.sessionId}' em '${rootDir}'.`);
        const provider = createLocalSessionFsProvider(rootDir, { sessionId: session.sessionId });
        emitSdkOperationMetric({
            operation: 'session.fs.handler.create',
            status: 'succeeded',
            sessionId: session.sessionId,
            attributes: { provider: 'local' },
        });
        return provider;
    };
}

/**
 * Constrói a configuração client-level de SessionFs a partir do boot/env, ou `undefined` quando a capability está
 * desabilitada.
 *
 * @returns {import('../types.js').CopilotClientOptions['sessionFs'] | undefined}
 */
export function buildConfiguredClientSessionFsConfig() {
    const config = readCopilotSessionFsBootConfig();
    if (!config.enabled) return undefined;
    return {
        initialCwd: config.initialCwd,
        sessionStatePath: config.sessionStatePath,
        conventions: config.conventions,
    };
}

/**
 * @returns {number | undefined}
 */
export function getConfiguredSessionIdleTimeoutSeconds() {
    const config = readCopilotSessionFsBootConfig();
    return config.sessionIdleTimeoutSeconds ?? undefined;
}

/**
 * Retorna o handler session-level configurado pelo boot/env, ou `undefined` quando SessionFs está desabilitado.
 *
 * @returns {CreateSessionFsHandler | undefined}
 */
export function getConfiguredSessionFsHandler() {
    const config = readCopilotSessionFsBootConfig();
    if (!config.enabled) return undefined;
    return createWorkspaceSessionFsHandler({ storageRootDir: config.storageRootDir });
}
