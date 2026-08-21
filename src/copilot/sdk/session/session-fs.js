// @ts-check
/**
 * src/copilot/sdk/session/session-fs.js
 *
 * Helpers canônicos para promover SessionFs no runtime local do Copilot. Mantém em L1 tanto a configuração client-side
 * (`CopilotClientOptions.sessionFs`) quanto o provider session-level (`createSessionFsProvider`), mantendo
 * `createSessionFsHandler` apenas como alias legado na wrapper layer.
 *
 * @module copilot/sdk/session/session-fs
 */

import { getApplicationWorkspaceInfra } from '#copilot/boot/application-infra';
import { readCopilotSessionFsBootConfig } from '#copilot/boot/session-fs';
import { evaluateIoPathPolicyAsync } from '#copilot/core/io-policy';
import { createConfiguredFsGrant, createConfiguredFsIo } from '#copilot/infra/public/composition/filesystem/configured';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import { classifySdkError } from '../errors.js';
import { log } from '../logger.js';
import { emitSdkOperationMetric } from '../telemetry/operation-metrics.js';

/**
 * @typedef {import('../types.js').SessionFsProvider} SessionFsProvider
 *
 * @typedef {import('../types.js').CreateSessionFsProvider} CreateSessionFsProvider
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
 * @param {unknown} error
 * @returns {boolean}
 */
function isNotFoundError(error) {
    const code = /** @type {{ code?: unknown }} */ (error ?? {}).code;
    return code === 'ENOENT' || code === 'ENOTDIR';
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
 * @param {'read' | 'write'} [mode]
 * @returns {Promise<string>}
 */
async function resolveWithinRoot(rootDir, inputPath, mode = 'read') {
    const policy = await evaluateIoPathPolicyAsync(inputPath, {
        workspaceRoot: rootDir,
        mode,
    });

    if (!policy.ok) {
        const error = new Error(`[sdk/session-fs] ${policy.reason}`);
        /** @type {{ code?: string }} */ (error).code = 'EINVAL';
        throw error;
    }

    return policy.realPath;
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
 * @param {string} absolutePath
 * @param {string} workspaceRoot
 * @returns {{ display: string; withinWorkspace: boolean }}
 */
function buildSafeSessionFsPathDisplay(absolutePath, workspaceRoot) {
    const root = resolve(workspaceRoot);
    const target = resolve(absolutePath);
    const rel = relative(root, target).replace(/\\/gu, '/');
    if (rel === '') {
        return { display: 'workspace:.', withinWorkspace: true };
    }
    if (!rel.startsWith('../') && rel !== '..' && !isAbsolute(rel)) {
        return { display: `workspace:${rel}`, withinWorkspace: true };
    }
    return { display: `external:${basename(target)}`, withinWorkspace: false };
}

/**
 * @param {string | null} path
 * @param {ReturnType<typeof createConfiguredFsIo>} io
 * @returns {Promise<boolean | null>}
 */
async function pathExists(path, io) {
    if (!path) return null;
    try {
        await io.statPath(path, { advisoryLimits: { source: 'session.fs.state' } });
        return true;
    } catch (error) {
        if (isNotFoundError(error)) return false;
        throw error;
    }
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
    const sessionWorkspaceInfra = getApplicationWorkspaceInfra(root);
    const {
        appendTextLocked,
        createOrReplaceFileAtomic,
        mkdirPathLocked,
        moveFileLocked,
        readText,
        removePathLocked,
        statPath,
    } = sessionWorkspaceInfra.io;
    const { scanDirectory } = sessionWorkspaceInfra.indexing;

    return {
        async readFile(path) {
            return instrumentSessionFsOperation(
                'session.fs.readFile',
                async () => {
                    const target = await resolveWithinRoot(root, path, 'read');
                    const result = await readText(target, { advisoryLimits: { source: 'session.fs' } });
                    return result.content;
                },
                createOperationContext(sessionId, { provider: 'local', pathDepth: safePathDepth(path) }),
            );
        },
        async writeFile(path, content, mode) {
            return instrumentSessionFsOperation(
                'session.fs.writeFile',
                async () => {
                    const target = await resolveWithinRoot(root, path, 'write');
                    await createOrReplaceFileAtomic(target, content, {
                        encoding: 'utf8',
                        createParentDirs: true,
                        riskClass: 'medium',
                        advisoryLimits: { source: 'session.fs' },
                        ...(mode === undefined ? {} : { mode }),
                    });
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
                    const target = await resolveWithinRoot(root, path, 'write');
                    await mkdirPathLocked(dirname(target), {
                        recursive: true,
                        advisoryLimits: { source: 'session.fs.parent' },
                    });
                    await appendTextLocked(target, content, {
                        encoding: 'utf8',
                        advisoryLimits: { source: 'session.fs' },
                        ...(mode === undefined ? {} : { mode }),
                    });
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
                        await statPath(await resolveWithinRoot(root, path, 'read'), {
                            advisoryLimits: { source: 'session.fs' },
                        });
                        return true;
                    } catch (error) {
                        if (isNotFoundError(error)) return false;
                        throw error;
                    }
                },
                createOperationContext(sessionId, { provider: 'local', pathDepth: safePathDepth(path) }),
            );
        },
        async stat(path) {
            return instrumentSessionFsOperation(
                'session.fs.stat',
                async () => {
                    const target = await resolveWithinRoot(root, path, 'read');
                    const { stats } = await statPath(target, { advisoryLimits: { source: 'session.fs' } });
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
                    const target = await resolveWithinRoot(root, path, 'write');
                    await mkdirPathLocked(target, {
                        recursive,
                        advisoryLimits: { source: 'session.fs' },
                        ...(mode === undefined ? {} : { mode }),
                    });
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
                async () => {
                    const target = await resolveWithinRoot(root, path, 'read');
                    const scan = await scanDirectory(target, {
                        workspaceRoot: root,
                        showHidden: true,
                        recursive: false,
                    });
                    return scan.entries.map((entry) => entry.name);
                },
                createOperationContext(sessionId, { provider: 'local', pathDepth: safePathDepth(path) }),
            );
        },
        async readdirWithTypes(path) {
            return instrumentSessionFsOperation(
                'session.fs.readdirWithTypes',
                async () => {
                    const target = await resolveWithinRoot(root, path, 'read');
                    const scan = await scanDirectory(target, {
                        workspaceRoot: root,
                        showHidden: true,
                        recursive: false,
                    });
                    return scan.entries
                        .filter((entry) => entry.type === 'file' || entry.type === 'directory')
                        .map((entry) => ({
                            name: entry.name,
                            type: entry.type,
                        }));
                },
                createOperationContext(sessionId, { provider: 'local', pathDepth: safePathDepth(path) }),
            );
        },
        async rm(path, recursive, force) {
            return instrumentSessionFsOperation(
                'session.fs.rm',
                async () => {
                    const target = await resolveWithinRoot(root, path, 'write');
                    await removePathLocked(target, {
                        recursive,
                        force,
                        ...(recursive ? { recursiveConfirmation: target } : {}),
                    });
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
                    const srcTarget = await resolveWithinRoot(root, src, 'read');
                    const destTarget = await resolveWithinRoot(root, dest, 'write');
                    await moveFileLocked(srcTarget, destTarget, { overwrite: true });
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
 * Descreve a configuração e os caminhos de SessionFs sem expor paths absolutos fora do workspace.
 *
 * @param {string | null | undefined} [sessionId]
 * @returns {{
 *     enabled: boolean;
 *     initialCwd: string;
 *     sessionStatePath: string;
 *     conventions: 'windows' | 'posix';
 *     storageRoot: { display: string; withinWorkspace: boolean };
 *     session: { key: string; display: string; withinWorkspace: boolean } | null;
 * }}
 */
export function describeConfiguredSessionFs(sessionId) {
    const config = readCopilotSessionFsBootConfig();
    const storageRootDir = resolve(config.storageRootDir);
    const storageRoot = buildSafeSessionFsPathDisplay(storageRootDir, config.initialCwd);
    const cleanSessionId = typeof sessionId === 'string' && sessionId.trim() ? sessionId.trim() : null;
    const sessionKey = cleanSessionId && config.enabled ? toSessionStorageKey(cleanSessionId) : null;
    const sessionDir = sessionKey ? resolve(storageRootDir, sessionKey) : null;
    const session = sessionKey && sessionDir ? buildSafeSessionFsPathDisplay(sessionDir, config.initialCwd) : null;
    return {
        enabled: config.enabled,
        initialCwd: config.initialCwd,
        sessionStatePath: config.sessionStatePath,
        conventions: config.conventions,
        storageRoot,
        session: sessionKey && session ? { key: sessionKey, ...session } : null,
    };
}

/**
 * Lê estado operacional mínimo de SessionFs para cockpit/diagnóstico.
 *
 * @param {string | null | undefined} [sessionId]
 * @returns {Promise<
 *     ReturnType<typeof describeConfiguredSessionFs> & {
 *         storageRoot: ReturnType<typeof describeConfiguredSessionFs>['storageRoot'] & { exists: boolean | null };
 *         session:
 *             | (NonNullable<ReturnType<typeof describeConfiguredSessionFs>['session']> & { exists: boolean | null })
 *             | null;
 *     }
 * >}
 */
export async function readConfiguredSessionFsState(sessionId) {
    const descriptor = describeConfiguredSessionFs(sessionId);
    const config = readCopilotSessionFsBootConfig();
    const storageRootDir = resolve(config.storageRootDir);
    const sessionDir =
        descriptor.enabled && descriptor.session ? resolve(storageRootDir, descriptor.session.key) : null;
    const stateIo = createConfiguredFsIo(
        createConfiguredFsGrant({
            id: 'sdk.session.session-fs.state',
            roots: [storageRootDir],
            operations: ['stat'],
            symlinkPolicy: 'deny',
            durability: ['file-and-directory'],
        }),
    );
    const [storageRootExists, sessionExists] = await Promise.all([
        descriptor.enabled ? pathExists(storageRootDir, stateIo) : Promise.resolve(null),
        descriptor.enabled ? pathExists(sessionDir, stateIo) : Promise.resolve(null),
    ]);
    return {
        ...descriptor,
        storageRoot: { ...descriptor.storageRoot, exists: storageRootExists },
        session: descriptor.session ? { ...descriptor.session, exists: sessionExists } : null,
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
