// @ts-check
/**
 * Sidecars duráveis para snapshots de rollback que excedem o orçamento em memória.
 *
 * @module copilot/infra/io/fs/rollback-sidecar
 */

import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { acquireIoResourceLock } from '../../io-locks.js';
import { toOwnedBuffer } from '../../shared/buffer.js';
import { sha256 } from '../../shared/hash.js';
import { assertSuccessfulSync, syncParentDirectoryBestEffort } from './durability.js';

const DEFAULT_ROLLBACK_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_CLEANUP_MAX_ENTRIES = 512;
const SIDECAR_FILE_PATTERN = /^(\d+)-([a-f0-9]{64})-([0-9a-f-]{36})\.rollback$/;
const PENDING_FILE_PATTERN = /^\.pending-(\d+)-(\d+)-([0-9a-f-]{36})$/;

/**
 * @typedef {object} IoRollbackSidecar
 * @property {1} version
 * @property {string} path
 * @property {string} contentHash
 * @property {number} bytes
 * @property {number} createdAtMs
 * @property {number} expiresAtMs
 */

/**
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function positiveIntegerOr(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}

/**
 * @returns {string}
 */
export function getRollbackSidecarDirectory() {
    const configured = String(process.env['COPILOT_IO_ROLLBACK_DIR'] ?? '').trim();
    return configured ? path.resolve(configured) : path.join(process.cwd(), 'src', 'copilot', '.ai', 'rollback');
}

/**
 * @returns {number}
 */
export function getRollbackSidecarTtlMs() {
    return positiveIntegerOr(process.env['COPILOT_IO_ROLLBACK_TTL_MS'], DEFAULT_ROLLBACK_TTL_MS);
}

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
 * @param {{ directory?: string; ttlMs?: number; nowMs?: number }} [options]
 */
export async function createRollbackSidecarWriter(options = {}) {
    const directory = path.resolve(options.directory ?? getRollbackSidecarDirectory());
    const createdAtMs = Math.trunc(options.nowMs ?? Date.now());
    const ttlMs = positiveIntegerOr(options.ttlMs, getRollbackSidecarTtlMs());
    const expiresAtMs = createdAtMs + ttlMs;
    const tempPath = path.join(directory, `.pending-${expiresAtMs}-${process.pid}-${randomUUID()}`);
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
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
            const buffer = toOwnedBuffer(chunk);
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
            const directorySync = await syncParentDirectoryBestEffort(finalPath);
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
            await cleanupExpiredRollbackSidecars({ directory, nowMs: createdAtMs }).catch(() => undefined);
            return descriptor;
        },

        async abort() {
            if (!closed) {
                closed = true;
                await handle.close().catch(() => undefined);
            }
            await fs.unlink(publishedPath ?? tempPath).catch(() => undefined);
        },
    };
}

/**
 * Persiste um Buffer já materializado como sidecar durável.
 *
 * @param {Buffer | Uint8Array} content
 * @param {{ contentHash?: string; directory?: string; ttlMs?: number; nowMs?: number }} [options]
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
 * Remove apenas sidecars expirados cujo nome obedece ao schema, sob lock intra e multiprocess.
 *
 * @param {{ directory?: string; nowMs?: number; maxEntries?: number }} [options]
 * @returns {Promise<{ scanned: number; removed: number; failed: number; limited: boolean }>}
 */
export async function cleanupExpiredRollbackSidecars(options = {}) {
    const directory = path.resolve(options.directory ?? getRollbackSidecarDirectory());
    const nowMs = Math.trunc(options.nowMs ?? Date.now());
    const maxEntries = positiveIntegerOr(options.maxEntries, DEFAULT_CLEANUP_MAX_ENTRIES);
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const lease = await acquireIoResourceLock(path.join(directory, '.cleanup'), {
        fileLock: true,
        fileLockDir: path.join(directory, '.locks'),
        operation: 'rollback-sidecar.cleanup',
        target: directory,
    });
    try {
        return await lease.run(async () => {
            const entries = await fs.readdir(directory, { withFileTypes: true });
            let scanned = 0;
            let removed = 0;
            let failed = 0;
            let candidates = 0;

            for (const entry of entries) {
                if (!entry.isFile()) continue;
                const match = SIDECAR_FILE_PATTERN.exec(entry.name) ?? PENDING_FILE_PATTERN.exec(entry.name);
                if (!match) continue;
                candidates += 1;
                if (scanned >= maxEntries) continue;
                scanned += 1;
                const expiresAtMs = Number(match[1]);
                if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs > nowMs) continue;
                try {
                    await fs.unlink(path.join(directory, entry.name));
                    removed += 1;
                } catch {
                    failed += 1;
                }
            }

            if (removed > 0) {
                const directorySync = await syncParentDirectoryBestEffort(path.join(directory, '.cleanup'));
                assertSuccessfulSync(directorySync, {
                    code: 'EDIRECTORYSYNC',
                    message: `Falha ao sincronizar cleanup de sidecars de rollback: ${directory}`,
                });
            }
            return { scanned, removed, failed, limited: candidates > scanned };
        });
    } finally {
        await lease.releaseAsync();
    }
}
