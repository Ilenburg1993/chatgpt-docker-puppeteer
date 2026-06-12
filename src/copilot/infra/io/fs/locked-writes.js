// @ts-check
/**
 * Escritas e mkdir protegidos por lock por recurso.
 *
 * Extraído do `io-engine` para reduzir acoplamento e manter a facade pública estável.
 *
 * @module copilot/infra/io/fs/locked-writes
 */

import { buildIoMeta, createIoTraceId, withIoMeta } from '#copilot/core';
import * as fs from 'node:fs/promises';
import { dirname } from 'node:path';
import { acquireIoResourceLock, withIoResourceLock } from '../../io-locks.js';
import { nowIoMs, publishIoOperation } from '../../io-observability.js';
import { assertValidIoFilePath } from '../../policy/path-resource.js';
import { assertExpectedSha256 } from '../../policy/preconditions.js';
import { sha256 } from '../../shared/hash.js';
import { invalidateIoCacheTiers } from '../invalidation/cache-tiers.js';
import { appendFileUnlocked } from './append.js';
import { mkdirPathUnlocked } from './mkdir.js';
import { normalizeWritePayload, writeAtomicFileUnlocked } from './write-atomic.js';

/**
 * @param {number} startedAt
 * @returns {number}
 */
function elapsedMs(startedAt) {
    return Math.max(0, Math.round(nowIoMs() - startedAt));
}

/**
 * @param {import('#copilot/core/io-contracts').IoMeta} io
 * @param {boolean} success
 * @param {unknown} [error]
 * @returns {import('#copilot/core/io-contracts').IoMeta}
 */
function publishAndReturn(io, success, error) {
    publishIoOperation(io, { success, ...(error !== undefined ? { error } : {}) });
    return io;
}

/**
 * @param {string} filePath
 * @param {unknown} error
 * @returns {Error}
 */
function normalizeCreateExclusiveError(filePath, error) {
    const code = /** @type {{ code?: unknown }} */ (error)?.code;
    if (code !== 'EEXIST') return /** @type {Error} */ (error);
    const err = new Error(`Destino já existe: ${filePath}`);
    /** @type {{ code?: string; cause?: unknown }} */ (err).code = 'EEXIST';
    /** @type {{ code?: string; cause?: unknown }} */ (err).cause = error;
    return err;
}

/**
 * Escrita atômica central: tmp no mesmo diretório + rename. Usa lock por path real para evitar corrida intra-processo.
 *
 * @param {string} filePath
 * @param {string | Buffer} content
 * @param {{
 *     encoding?: BufferEncoding;
 *     riskClass?: import('#copilot/core/io-contracts').IoRiskClass;
 *     traceId?: string;
 *     mode?: number;
 *     requireExists?: boolean;
 *     failIfExists?: boolean;
 *     expectedHash?: string;
 *     lockTimeoutMs?: number;
 *     signal?: AbortSignal;
 *     advisoryLimits?: Record<string, unknown>;
 * }} [options]
 * @returns {Promise<{
 *     path: string;
 *     bytesWritten: number;
 *     io: import('#copilot/core/io-contracts').IoMeta;
 *     lockWaitMs: number;
 *     previousHash: string | null;
 *     contentHash: string;
 * }>}
 */
export async function writeFileAtomic(filePath, content, options = {}) {
    assertValidIoFilePath(filePath);
    const traceId = options.traceId ?? createIoTraceId();
    const startedAt = nowIoMs();
    const { payload, bytes } = normalizeWritePayload(filePath, content, options.encoding ?? 'utf8');
    const contentHash = sha256(payload);
    try {
        const lease = await acquireIoResourceLock(filePath, {
            ...(options.lockTimeoutMs === undefined ? {} : { timeoutMs: options.lockTimeoutMs }),
            ...(options.signal === undefined ? {} : { signal: options.signal }),
        });
        const value = await (async () => {
            try {
                return await lease.run(async () => {
                    /** @type {string | null} */
                    let previousHash = null;
                    if (options.requireExists) {
                        try {
                            await fs.access(filePath);
                        } catch {
                            const err = new Error(`Arquivo não encontrado: ${filePath}`);
                            /** @type {{ code?: string }} */ (err).code = 'ENOENT';
                            throw err;
                        }
                    }

                    if (options.failIfExists) {
                        try {
                            await fs.access(filePath);
                            const err = new Error(`Destino já existe: ${filePath}`);
                            /** @type {{ code?: string }} */ (err).code = 'EEXIST';
                            throw err;
                        } catch (accessError) {
                            const code = /** @type {{ code?: unknown }} */ (accessError)?.code;
                            if (code !== 'ENOENT' && code !== 'ENOTDIR') throw accessError;
                        }
                    }

                    if (options.expectedHash) {
                        previousHash = assertExpectedSha256(await fs.readFile(filePath), options.expectedHash);
                    }

                    await writeAtomicFileUnlocked(filePath, payload, {
                        ...(options.mode === undefined ? {} : { mode: options.mode }),
                        exclusive: Boolean(options.failIfExists),
                    });
                    return { path: filePath, bytesWritten: bytes, previousHash, contentHash };
                });
            } finally {
                lease.release();
            }
        })();
        const waitMs = lease.waitMs;
        invalidateIoCacheTiers(filePath);
        const io = publishAndReturn(
            buildIoMeta({
                operation: 'write',
                target: filePath,
                targetKind: 'file',
                bytesWritten: value.bytesWritten,
                durationMs: elapsedMs(startedAt),
                engine: 'io-engine.atomic-write',
                riskClass: options.riskClass ?? 'medium',
                traceId,
                advisoryLimits: {
                    ...(options.advisoryLimits ?? {}),
                    lockWaitMs: waitMs,
                    expectedHash: options.expectedHash ?? null,
                    contentHash,
                },
            }),
            true,
        );
        return { ...value, lockWaitMs: waitMs, io };
    } catch (error) {
        const finalError = options.failIfExists ? normalizeCreateExclusiveError(filePath, error) : error;
        publishAndReturn(
            buildIoMeta({
                operation: 'write',
                target: filePath,
                targetKind: 'file',
                durationMs: elapsedMs(startedAt),
                engine: 'io-engine.atomic-write',
                riskClass: options.riskClass ?? 'medium',
                traceId,
            }),
            false,
            finalError,
        );
        throw finalError;
    }
}

/**
 * Garante diretório pai e escreve de forma atômica.
 *
 * @param {string} filePath
 * @param {string | Buffer} content
 * @param {Parameters<typeof writeFileAtomic>[2] & { createParentDirs?: boolean }} [options]
 */
export async function createOrReplaceFileAtomic(filePath, content, options = {}) {
    assertValidIoFilePath(filePath);
    if (options.createParentDirs !== false) {
        await mkdirPathLocked(dirname(filePath), {
            recursive: true,
            advisoryLimits: {
                operation: 'createOrReplaceFileAtomic.parentMkdir',
            },
        });
    }
    return writeFileAtomic(filePath, content, options);
}

/**
 * Append com lock por path. Mantém append separado de write para observabilidade e política de risco.
 *
 * @param {string} filePath
 * @param {string | Buffer} content
 * @param {{
 *     encoding?: BufferEncoding;
 *     mode?: number;
 *     traceId?: string;
 *     lockTimeoutMs?: number;
 *     signal?: AbortSignal;
 *     advisoryLimits?: Record<string, unknown>;
 * }} [options]
 */
export async function appendTextLocked(filePath, content, options = {}) {
    assertValidIoFilePath(filePath);
    const traceId = options.traceId ?? createIoTraceId();
    const startedAt = nowIoMs();
    const { payload, bytes } = normalizeWritePayload(filePath, content, options.encoding ?? 'utf8');
    try {
        const lease = await acquireIoResourceLock(filePath, {
            ...(options.lockTimeoutMs === undefined ? {} : { timeoutMs: options.lockTimeoutMs }),
            ...(options.signal === undefined ? {} : { signal: options.signal }),
        });
        try {
            await lease.run(async () =>
                appendFileUnlocked(filePath, payload, options.mode === undefined ? {} : { mode: options.mode }),
            );
        } finally {
            lease.release();
        }
        const waitMs = lease.waitMs;
        invalidateIoCacheTiers(filePath);
        const io = publishAndReturn(
            buildIoMeta({
                operation: 'append',
                target: filePath,
                targetKind: 'file',
                bytesWritten: bytes,
                durationMs: elapsedMs(startedAt),
                engine: 'io-engine.fs.appendFile',
                riskClass: 'medium',
                traceId,
                advisoryLimits: { ...(options.advisoryLimits ?? {}), lockWaitMs: waitMs },
            }),
            true,
        );
        return { path: filePath, bytesWritten: bytes, lockWaitMs: waitMs, io };
    } catch (error) {
        publishAndReturn(
            buildIoMeta({
                operation: 'append',
                target: filePath,
                targetKind: 'file',
                durationMs: elapsedMs(startedAt),
                engine: 'io-engine.fs.appendFile',
                riskClass: 'medium',
                traceId,
            }),
            false,
            error,
        );
        throw error;
    }
}

/**
 * Cria diretório com lock por path, preservando a semântica do SDK SessionFsProvider.mkdir().
 *
 * @param {string} dirPath
 * @param {{ recursive?: boolean; mode?: number; traceId?: string; advisoryLimits?: Record<string, unknown> }} [options]
 * @returns {Promise<{
 *     path: string;
 *     created: true;
 *     io: import('#copilot/core/io-contracts').IoMeta;
 *     lockWaitMs: number;
 * }>}
 */
export async function mkdirPathLocked(dirPath, options = {}) {
    assertValidIoFilePath(dirPath);
    const traceId = options.traceId ?? createIoTraceId();
    const startedAt = nowIoMs();
    try {
        const { waitMs } = await withIoResourceLock(dirPath, async () =>
            mkdirPathUnlocked(dirPath, {
                recursive: Boolean(options.recursive),
                ...(options.mode === undefined ? {} : { mode: options.mode }),
            }),
        );
        const io = publishAndReturn(
            buildIoMeta({
                operation: 'mkdir',
                target: dirPath,
                targetKind: 'directory',
                durationMs: elapsedMs(startedAt),
                engine: 'io-engine.fs.mkdir',
                riskClass: 'medium',
                traceId,
                advisoryLimits: {
                    ...(options.advisoryLimits ?? {}),
                    lockWaitMs: waitMs,
                    recursive: Boolean(options.recursive),
                },
            }),
            true,
        );
        return withIoMeta({ path: dirPath, created: /** @type {const} */ (true), lockWaitMs: waitMs }, io);
    } catch (error) {
        publishAndReturn(
            buildIoMeta({
                operation: 'mkdir',
                target: dirPath,
                targetKind: 'directory',
                durationMs: elapsedMs(startedAt),
                engine: 'io-engine.fs.mkdir',
                riskClass: 'medium',
                traceId,
            }),
            false,
            error,
        );
        throw error;
    }
}
