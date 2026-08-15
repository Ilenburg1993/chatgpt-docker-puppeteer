// @ts-check
/**
 * Sidecars duráveis para snapshots de rollback que excedem o orçamento em memória.
 *
 * @module copilot/infra/io/fs/rollback-sidecar
 */

import { randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { acquireIoResourceLock } from '../../io-locks.js';
import { toOwnedBuffer } from '../../shared/buffer.js';
import { sha256 } from '../../shared/hash.js';
import { assertSuccessfulSync, syncParentDirectoryBestEffort } from './durability.js';

const DEFAULT_ROLLBACK_ENABLED = false;
const DEFAULT_ROLLBACK_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_ROLLBACK_MAX_ENTRIES = 32;
const DEFAULT_ROLLBACK_MAX_BYTES = 32 * 1024 * 1024;
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
 * @param {unknown} value
 * @param {boolean} fallback
 * @returns {boolean}
 */
function booleanOr(value, fallback) {
    const normalized = String(value ?? '')
        .trim()
        .toLowerCase();
    if (!normalized) return fallback;
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
}

/**
 * Rollback automático de I/O é opt-in. O default off evita materializar snapshots de arquivos grandes em cada mutação.
 * APIs explícitas de persistência/execução continuam disponíveis para fluxos que deliberadamente habilitem rollback.
 *
 * @returns {boolean}
 */
export function isIoRollbackEnabled() {
    return booleanOr(process.env['COPILOT_IO_ROLLBACK_ENABLED'], DEFAULT_ROLLBACK_ENABLED);
}

/**
 * @param {boolean} requested
 * @returns {boolean}
 */
export function shouldCaptureIoRollback(requested = true) {
    return requested === true && isIoRollbackEnabled();
}

/**
 * @returns {number}
 */
export function getRollbackSidecarMaxEntries() {
    return positiveIntegerOr(process.env['COPILOT_IO_ROLLBACK_MAX_ENTRIES'], DEFAULT_ROLLBACK_MAX_ENTRIES);
}

/**
 * @returns {number}
 */
export function getRollbackSidecarMaxBytes() {
    return positiveIntegerOr(process.env['COPILOT_IO_ROLLBACK_MAX_BYTES'], DEFAULT_ROLLBACK_MAX_BYTES);
}

/**
 * @returns {{ enabled: boolean; ttlMs: number; maxEntries: number; maxBytes: number }}
 */
export function getIoRollbackPolicy() {
    return {
        enabled: isIoRollbackEnabled(),
        ttlMs: getRollbackSidecarTtlMs(),
        maxEntries: getRollbackSidecarMaxEntries(),
        maxBytes: getRollbackSidecarMaxBytes(),
    };
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
            if (isIoRollbackEnabled()) {
                await cleanupRollbackSidecars({
                    directory,
                    nowMs: createdAtMs,
                    preservePath: finalPath,
                    enforceBudget: true,
                }).catch(() => undefined);
            } else {
                await cleanupExpiredRollbackSidecars({ directory, nowMs: createdAtMs }).catch(() => undefined);
            }
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
 * Lê e valida um sidecar sem seguir symlinks nem aceitar paths fora do diretório configurado.
 *
 * @param {IoRollbackSidecar} descriptor
 * @param {{ directory?: string; nowMs?: number; allowExpired?: boolean }} [options]
 * @returns {Promise<Buffer>}
 */
export async function readVerifiedRollbackSidecar(descriptor, options = {}) {
    const directory = path.resolve(options.directory ?? getRollbackSidecarDirectory());
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

/**
 * Lista apenas metadados derivados de nomes válidos; nunca retorna conteúdo nem path absoluto.
 *
 * @param {{ directory?: string; nowMs?: number; maxEntries?: number; verifyContent?: boolean }} [options]
 */
export async function listRollbackSidecars(options = {}) {
    const directory = path.resolve(options.directory ?? getRollbackSidecarDirectory());
    const nowMs = Math.trunc(options.nowMs ?? Date.now());
    const maxEntries = positiveIntegerOr(options.maxEntries, 100);
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const candidates = (await fs.readdir(directory, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && SIDECAR_FILE_PATTERN.test(entry.name))
        .sort((left, right) => left.name.localeCompare(right.name));
    const entries = candidates.slice(0, maxEntries);
    const sidecars = [];
    for (const entry of entries) {
        const match = SIDECAR_FILE_PATTERN.exec(entry.name);
        if (!match) continue;
        const candidate = path.join(directory, entry.name);
        const stats = await fs.lstat(candidate);
        const descriptor = {
            version: /** @type {const} */ (1),
            path: candidate,
            contentHash: String(match[2]),
            bytes: stats.size,
            createdAtMs: Math.trunc(stats.birthtimeMs || stats.ctimeMs),
            expiresAtMs: Number(match[1]),
        };
        let contentVerified = null;
        if (options.verifyContent) {
            contentVerified = await readVerifiedRollbackSidecar(descriptor, {
                directory,
                nowMs,
                allowExpired: true,
            })
                .then(() => true)
                .catch(() => false);
        }
        sidecars.push({
            id: entry.name,
            contentHash: descriptor.contentHash,
            bytes: descriptor.bytes,
            createdAtMs: descriptor.createdAtMs,
            expiresAtMs: descriptor.expiresAtMs,
            expired: descriptor.expiresAtMs <= nowMs,
            contentVerified,
        });
    }
    return {
        count: sidecars.length,
        limited: candidates.length > entries.length,
        policy: getIoRollbackPolicy(),
        sidecars,
    };
}

/**
 * Cleanup canônico de sidecars. Sempre remove expirados; opcionalmente purga todos os nomes válidos ou aplica budgets
 * de quantidade/bytes aos sidecars ainda ativos. Nomes desconhecidos permanecem intocados.
 *
 * @param {{
 *     directory?: string;
 *     nowMs?: number;
 *     scanLimit?: number;
 *     maxEntries?: number;
 *     maxBytes?: number;
 *     purgeAll?: boolean;
 *     enforceBudget?: boolean;
 *     preservePath?: string;
 * }} [options]
 * @returns {Promise<{
 *     scanned: number;
 *     removed: number;
 *     removedBytes: number;
 *     expiredRemoved: number;
 *     budgetRemoved: number;
 *     purged: number;
 *     failed: number;
 *     remainingCount: number;
 *     remainingBytes: number;
 *     limited: boolean;
 * }>}
 */
export async function cleanupRollbackSidecars(options = {}) {
    const directory = path.resolve(options.directory ?? getRollbackSidecarDirectory());
    const nowMs = Math.trunc(options.nowMs ?? Date.now());
    const scanLimit = positiveIntegerOr(options.scanLimit, DEFAULT_CLEANUP_MAX_ENTRIES);
    const maxEntries = positiveIntegerOr(options.maxEntries, getRollbackSidecarMaxEntries());
    const maxBytes = positiveIntegerOr(options.maxBytes, getRollbackSidecarMaxBytes());
    const purgeAll = options.purgeAll === true;
    const enforceBudget = options.enforceBudget !== false;
    const preservePath = options.preservePath ? path.resolve(options.preservePath) : null;
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
            const recognizedCount = entries.filter(
                (entry) => entry.isFile() && (SIDECAR_FILE_PATTERN.test(entry.name) || PENDING_FILE_PATTERN.test(entry.name)),
            ).length;
            const recognized = [];
            for (const entry of entries) {
                if (!entry.isFile() || recognized.length >= scanLimit) continue;
                const sidecarMatch = SIDECAR_FILE_PATTERN.exec(entry.name);
                const pendingMatch = sidecarMatch ? null : PENDING_FILE_PATTERN.exec(entry.name);
                const match = sidecarMatch ?? pendingMatch;
                if (!match) continue;
                const filePath = path.join(directory, entry.name);
                const stats = await fs.lstat(filePath).catch(() => null);
                if (!stats?.isFile()) continue;
                recognized.push({
                    name: entry.name,
                    path: filePath,
                    bytes: stats.size,
                    mtimeMs: stats.mtimeMs,
                    expiresAtMs: Number(match[1]),
                    sidecar: Boolean(sidecarMatch),
                });
            }

            const activeSidecars = recognized
                .filter((item) => item.sidecar && Number.isSafeInteger(item.expiresAtMs) && item.expiresAtMs > nowMs)
                .sort((left, right) => right.mtimeMs - left.mtimeMs || right.name.localeCompare(left.name));
            const retained = new Set();
            if (!purgeAll && enforceBudget) {
                let retainedCount = 0;
                let retainedBytes = 0;
                const preserved = preservePath
                    ? activeSidecars.find((item) => path.resolve(item.path) === preservePath) ?? null
                    : null;
                if (preserved) {
                    retained.add(preserved.path);
                    retainedCount = 1;
                    retainedBytes = preserved.bytes;
                }
                for (const item of activeSidecars) {
                    if (preserved && item.path === preserved.path) continue;
                    const fitsCount = retainedCount < maxEntries;
                    const fitsBytes = retainedBytes + item.bytes <= maxBytes || retainedCount === 0;
                    if (!fitsCount || !fitsBytes) continue;
                    retained.add(item.path);
                    retainedCount += 1;
                    retainedBytes += item.bytes;
                }
            }

            let removed = 0;
            let removedBytes = 0;
            let expiredRemoved = 0;
            let budgetRemoved = 0;
            let purged = 0;
            let failed = 0;
            const removedPaths = new Set();
            for (const item of recognized) {
                const expired = Number.isSafeInteger(item.expiresAtMs) && item.expiresAtMs <= nowMs;
                const overBudget = item.sidecar && enforceBudget && !purgeAll && !expired && !retained.has(item.path);
                if (!purgeAll && !expired && !overBudget) continue;
                try {
                    await fs.unlink(item.path);
                    removed += 1;
                    removedBytes += item.bytes;
                    removedPaths.add(item.path);
                    if (purgeAll) purged += 1;
                    else if (expired) expiredRemoved += 1;
                    else budgetRemoved += 1;
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
            const remaining = recognized.filter((item) => !removedPaths.has(item.path));
            return {
                scanned: recognized.length,
                removed,
                removedBytes,
                expiredRemoved,
                budgetRemoved,
                purged,
                failed,
                remainingCount: remaining.length,
                remainingBytes: remaining.reduce((sum, item) => sum + item.bytes, 0),
                limited: recognizedCount > recognized.length,
            };
        });
    } finally {
        await lease.releaseAsync();
    }
}

/**
 * Compatibilidade: cleanup estritamente por expiração, sem aplicar budgets aos sidecars ativos.
 *
 * @param {{ directory?: string; nowMs?: number; maxEntries?: number }} [options]
 */
export async function cleanupExpiredRollbackSidecars(options = {}) {
    return cleanupRollbackSidecars({
        ...(options.directory === undefined ? {} : { directory: options.directory }),
        ...(options.nowMs === undefined ? {} : { nowMs: options.nowMs }),
        scanLimit: positiveIntegerOr(options.maxEntries, DEFAULT_CLEANUP_MAX_ENTRIES),
        enforceBudget: false,
    });
}
