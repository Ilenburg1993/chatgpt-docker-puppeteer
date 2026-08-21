// @ts-check
/** Durable rollback sidecar publication and verified read. */

import { positiveIntegerOr, sha256, toBufferView, toOwnedBuffer } from '#copilot/infra/internal/platform';
import { assertSuccessfulSync, syncParentDirectoryBestEffort } from '#copilot/infra/internal/platform/node/filesystem';
import { markMutationAppliedError } from '#copilot/infra/internal/policy';
import { randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { mkdirPathUnlocked } from '../directory/index.js';
import { SIDECAR_FILE_PATTERN } from './format.js';
import { cleanupExpiredRollbackSidecars, cleanupRollbackSidecars } from './maintenance.js';
import { createDefaultIoRollbackPolicy } from './policy.js';

/** @typedef {import('./types.js').IoRollbackSidecar} IoRollbackSidecar */

/**
 * @param {import('node:fs/promises').FileHandle} handle
 * @param {Buffer} chunk
 * @returns {Promise<void>}
 */
async function writeAll(handle, chunk) {
    let offset = 0;
    while (offset < chunk.byteLength) {
        const { bytesWritten } = await handle.write(chunk, offset, chunk.byteLength - offset, null);
        if (bytesWritten <= 0) {
            const error = new Error('Escrita incompleta no sidecar de rollback.');
            /** @type {{ code?: string }} */ (error).code = 'EROLLBACKSIDECARWRITE';
            throw error;
        }
        offset += bytesWritten;
    }
}

/**
 * Abre um sidecar temporário e o publica somente após hash/tamanho serem conhecidos.
 *
 * @param {{
 *     directory?: string;
 *     ttlMs?: number;
 *     nowMs?: number;
 *     syncDirectory?: typeof syncParentDirectoryBestEffort;
 *     policy?: import('./policy.js').IoRollbackPolicy;
 * }} [options]
 */
export async function createRollbackSidecarWriter(options = {}) {
    const policy = options.policy ?? createDefaultIoRollbackPolicy();
    const directory = path.resolve(options.directory ?? policy.directory);
    const createdAtMs = Math.trunc(options.nowMs ?? Date.now());
    const ttlMs = positiveIntegerOr(options.ttlMs, policy.ttlMs);
    const expiresAtMs = createdAtMs + ttlMs;
    const tempPath = path.join(directory, `.pending-${expiresAtMs}-${process.pid}-${randomUUID()}`);
    await mkdirPathUnlocked(directory, {
        recursive: true,
        mode: 0o700,
        ...(options.syncDirectory === undefined ? {} : { syncDirectory: options.syncDirectory }),
    });
    const handle = await fs.open(tempPath, 'wx', 0o600);
    let bytesWritten = 0;
    let closed = false;
    /** @type {string | null} */
    let publishedPath = null;

    return {
        /**
         * @param {Buffer | Uint8Array} chunk
         */
        async write(chunk) {
            if (closed) throw new Error('Sidecar de rollback já foi finalizado.');
            // The chunk is consumed completely before this method resolves; a zero-copy view is safe and avoids one
            // allocation/copy per streamed mutation-snapshot chunk.
            const buffer = toBufferView(chunk);
            await writeAll(handle, buffer);
            bytesWritten += buffer.byteLength;
        },

        /**
         * @param {{ contentHash: string; bytes: number }} metadata
         * @returns {Promise<IoRollbackSidecar>}
         */
        async commit(metadata) {
            if (closed) throw new Error('Sidecar de rollback já foi finalizado.');
            if (!/^[a-f0-9]{64}$/.test(metadata.contentHash)) {
                throw new TypeError('Hash inválido para sidecar de rollback.');
            }
            if (metadata.bytes !== bytesWritten) {
                const error = new Error(
                    `Tamanho divergente no sidecar de rollback: esperado=${metadata.bytes}, escrito=${bytesWritten}.`,
                );
                /** @type {{ code?: string }} */ (error).code = 'EROLLBACKSIDECARSIZE';
                throw error;
            }

            const finalPath = path.join(directory, `${expiresAtMs}-${metadata.contentHash}-${randomUUID()}.rollback`);
            await handle.sync();
            await handle.close();
            closed = true;
            await fs.rename(tempPath, finalPath);
            publishedPath = finalPath;
            const directorySync = await (options.syncDirectory ?? syncParentDirectoryBestEffort)(finalPath);
            assertSuccessfulSync(directorySync, {
                code: 'EDIRECTORYSYNC',
                message: `Falha ao sincronizar diretório do sidecar de rollback: ${directory}`,
            });

            const descriptor = {
                version: /** @type {const} */ (1),
                path: finalPath,
                contentHash: metadata.contentHash,
                bytes: metadata.bytes,
                createdAtMs,
                expiresAtMs,
            };
            if (policy.enabled) {
                await cleanupRollbackSidecars({
                    policy,
                    directory,
                    nowMs: createdAtMs,
                    preservePath: finalPath,
                    enforceBudget: true,
                }).catch(() => undefined);
            } else {
                await cleanupExpiredRollbackSidecars({ policy, directory, nowMs: createdAtMs }).catch(() => undefined);
            }
            return descriptor;
        },

        async abort() {
            if (!closed) {
                closed = true;
                await handle.close().catch(() => undefined);
            }
            const cleanupPath = publishedPath ?? tempPath;
            const published = publishedPath !== null;
            await fs.unlink(cleanupPath).catch(() => undefined);
            if (published) {
                try {
                    const cleanupSync = await (options.syncDirectory ?? syncParentDirectoryBestEffort)(cleanupPath);
                    assertSuccessfulSync(cleanupSync, {
                        code: 'EDIRECTORYSYNC',
                        message: `Falha ao sincronizar cleanup do sidecar de rollback: ${directory}`,
                    });
                    publishedPath = null;
                } catch (error) {
                    throw markMutationAppliedError(error, {
                        phase: 'rollback-sidecar-cleanup',
                        paths: [cleanupPath],
                    });
                }
            }
        },
    };
}

/**
 * Persiste um Buffer já materializado como sidecar durável.
 *
 * @param {Buffer | Uint8Array} content
 * @param {{
 *     contentHash?: string;
 *     directory?: string;
 *     ttlMs?: number;
 *     nowMs?: number;
 *     syncDirectory?: typeof syncParentDirectoryBestEffort;
 *     policy?: import('./policy.js').IoRollbackPolicy;
 * }} [options]
 * @returns {Promise<IoRollbackSidecar>}
 */
export async function persistRollbackSidecar(content, options = {}) {
    const payload = toOwnedBuffer(content);
    const actualHash = sha256(payload);
    if (options.contentHash !== undefined && options.contentHash !== actualHash) {
        const error = new Error(
            `Hash divergente ao persistir sidecar de rollback: esperado=${options.contentHash}, atual=${actualHash}.`,
        );
        /** @type {{ code?: string }} */ (error).code = 'EROLLBACKSIDECARHASH';
        throw error;
    }
    const writer = await createRollbackSidecarWriter(options);
    try {
        await writer.write(payload);
        return await writer.commit({
            contentHash: actualHash,
            bytes: payload.byteLength,
        });
    } catch (error) {
        await writer.abort();
        throw error;
    }
}

/**
 * Lê e valida um sidecar sem seguir symlinks nem aceitar paths fora do diretório configurado.
 *
 * @param {IoRollbackSidecar} descriptor
 * @param {{ directory?: string; nowMs?: number; allowExpired?: boolean; policy?: import('./policy.js').IoRollbackPolicy }} [options]
 * @returns {Promise<Buffer>}
 */
export async function readVerifiedRollbackSidecar(descriptor, options = {}) {
    const policy = options.policy ?? createDefaultIoRollbackPolicy();
    const directory = path.resolve(options.directory ?? policy.directory);
    const candidate = path.resolve(String(descriptor?.path ?? ''));
    if (path.dirname(candidate) !== directory) {
        const error = new Error('Sidecar de rollback fora do diretório permitido.');
        /** @type {{ code?: string }} */ (error).code = 'EROLLBACKSIDECARPATH';
        throw error;
    }
    const match = SIDECAR_FILE_PATTERN.exec(path.basename(candidate));
    if (
        !match ||
        Number(match[1]) !== descriptor.expiresAtMs ||
        match[2] !== descriptor.contentHash ||
        descriptor.version !== 1
    ) {
        const error = new Error('Descriptor de sidecar não corresponde ao nome persistido.');
        /** @type {{ code?: string }} */ (error).code = 'EROLLBACKSIDECARDESCRIPTOR';
        throw error;
    }
    if (!options.allowExpired && descriptor.expiresAtMs <= Math.trunc(options.nowMs ?? Date.now())) {
        const error = new Error('Sidecar de rollback expirado.');
        /** @type {{ code?: string }} */ (error).code = 'EROLLBACKSIDECAR_EXPIRED';
        throw error;
    }

    const handle = await fs.open(candidate, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    try {
        const stats = await handle.stat();
        if (!stats.isFile() || stats.size !== descriptor.bytes) {
            const error = new Error('Tamanho ou tipo do sidecar de rollback diverge do descriptor.');
            /** @type {{ code?: string }} */ (error).code = 'EROLLBACKSIDECARSIZE';
            throw error;
        }
        const payload = await handle.readFile();
        if (sha256(payload) !== descriptor.contentHash) {
            const error = new Error('Hash do sidecar de rollback diverge do descriptor.');
            /** @type {{ code?: string }} */ (error).code = 'EROLLBACKSIDECARHASH';
            throw error;
        }
        return payload;
    } finally {
        await handle.close();
    }
}
