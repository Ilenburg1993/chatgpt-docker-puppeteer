// @ts-check
/**
 * Lockfile multiprocess opcional para recursos de I/O.
 *
 * L0 continua sendo o lock assíncrono em memória. Este módulo fornece L1 opt-in por env/option para mutações
 * sensíveis, usando criação exclusiva de arquivo (`open(lock, 'wx')`) e metadata JSON para diagnóstico/recovery.
 *
 * @module copilot/infra/locks/file-resource-lock
 */

import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { hostname } from 'node:os';
import path from 'node:path';
import { normalizeIoDurability, shouldSyncDirectory, syncParentDirectoryBestEffort } from '../io/fs/durability.js';
import { normalizePathResourceKey } from '../policy/path-resource.js';

const DEFAULT_STALE_MS = 10 * 60 * 1000;
const DEFAULT_ACQUIRE_TIMEOUT_MS = 30_000;
const DEFAULT_POLL_MS = 25;
const LOCK_SCHEMA_VERSION = 1;

/** @typedef {'none' | 'file' | 'file-and-directory'} IoDurabilityMode */

/**
 * @typedef {object} FileResourceLockMetadata
 * @property {1} schemaVersion
 * @property {string} token
 * @property {number} pid
 * @property {string} hostname
 * @property {string} resourceKey
 * @property {string} resourceHash
 * @property {string | null} operation
 * @property {string | null} target
 * @property {string} startedAt
 * @property {number} startedAtMs
 */

/**
 * @typedef {object} FileResourceLockLease
 * @property {string} resourceKey
 * @property {string} lockPath
 * @property {string} token
 * @property {number} waitMs
 * @property {boolean} staleRecovered
 * @property {() => Promise<void>} release
 */

/** @type {Set<string>} */
const activeFileLockPaths = new Set();

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isTruthyEnv(value) {
    return /^(1|true|yes|on)$/i.test(String(value ?? '').trim());
}

/**
 * @returns {boolean}
 */
export function isFileResourceLockEnabledByEnv() {
    return isTruthyEnv(process.env['COPILOT_IO_FILE_LOCKS_ENABLED']);
}

/**
 * @returns {number}
 */
function defaultStaleMs() {
    const raw = Number(process.env['COPILOT_IO_FILE_LOCK_STALE_MS']);
    return Number.isFinite(raw) && raw >= 1 ? raw : DEFAULT_STALE_MS;
}

/**
 * @returns {number}
 */
function defaultAcquireTimeoutMs() {
    const raw = Number(process.env['COPILOT_IO_FILE_LOCK_TIMEOUT_MS']);
    return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_ACQUIRE_TIMEOUT_MS;
}

/**
 * @returns {string}
 */
export function getFileResourceLockDir() {
    const raw = String(process.env['COPILOT_IO_FILE_LOCK_DIR'] ?? '').trim();
    return raw ? path.resolve(raw) : path.join(process.cwd(), 'src', 'copilot', '.ai', 'locks');
}

/**
 * @param {string} resourceKey
 * @returns {string}
 */
export function hashFileResourceLockKey(resourceKey) {
    return createHash('sha256').update(normalizePathResourceKey(resourceKey)).digest('hex');
}

/**
 * @param {string} resourceKey
 * @param {string} [lockDir]
 * @returns {string}
 */
export function getFileResourceLockPath(resourceKey, lockDir = getFileResourceLockDir()) {
    return path.join(lockDir, `${hashFileResourceLockKey(resourceKey)}.lock`);
}

/**
 * @returns {{ enabledByEnv: boolean; activeLeases: number; lockDir: string }}
 */
export function getFileResourceLockStats() {
    return {
        enabledByEnv: isFileResourceLockEnabledByEnv(),
        activeLeases: activeFileLockPaths.size,
        lockDir: getFileResourceLockDir(),
    };
}

/**
 * @param {number} ms
 * @param {AbortSignal | undefined} signal
 */
function sleep(ms, signal) {
    if (signal?.aborted) return Promise.reject(createAbortError());
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(resolve, Math.max(0, ms));
        timeout.unref?.();
        const cleanup = () => {
            clearTimeout(timeout);
            signal?.removeEventListener('abort', onAbort);
        };
        const onAbort = () => {
            cleanup();
            reject(createAbortError());
        };
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}

/** @returns {Error & { code?: string }} */
function createAbortError() {
    const error = /** @type {Error & { code?: string }} */ (new Error('Lockfile abortado antes de adquirir recurso.'));
    error.name = 'AbortError';
    error.code = 'ABORT_ERR';
    return error;
}

/**
 * @param {string} lockPath
 * @returns {Error & { code?: string; lockPath?: string }}
 */
function createTimeoutError(lockPath) {
    const error = /** @type {Error & { code?: string; lockPath?: string }} */ (
        new Error(`Timeout ao aguardar lockfile: ${lockPath}`)
    );
    error.name = 'TimeoutError';
    error.code = 'ETIMEDOUT';
    error.lockPath = lockPath;
    return error;
}

/**
 * @param {unknown} error
 * @returns {string | null}
 */
function errorCode(error) {
    const code = /** @type {{ code?: unknown }} */ (error)?.code;
    return typeof code === 'string' ? code : null;
}

/**
 * @param {number} pid
 * @returns {boolean}
 */
function isProcessAlive(pid) {
    if (!Number.isInteger(pid) || pid <= 0) return false;
    if (pid === process.pid) return true;
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return errorCode(error) === 'EPERM';
    }
}

/**
 * @param {unknown} value
 * @returns {FileResourceLockMetadata | null}
 */
function parseLockMetadata(value) {
    if (!value || typeof value !== 'object') return null;
    const item = /** @type {Record<string, unknown>} */ (value);
    if (item['schemaVersion'] !== LOCK_SCHEMA_VERSION) return null;
    if (typeof item['token'] !== 'string' || item['token'].length === 0) return null;
    if (!Number.isInteger(item['pid'])) return null;
    if (typeof item['hostname'] !== 'string') return null;
    if (typeof item['resourceKey'] !== 'string') return null;
    if (typeof item['resourceHash'] !== 'string') return null;
    if (typeof item['startedAt'] !== 'string') return null;
    if (typeof item['startedAtMs'] !== 'number') return null;
    return /** @type {FileResourceLockMetadata} */ (value);
}

/**
 * @param {string} lockPath
 * @returns {Promise<FileResourceLockMetadata | null>}
 */
async function readLockMetadata(lockPath) {
    try {
        const raw = await fs.readFile(lockPath, 'utf8');
        return parseLockMetadata(JSON.parse(raw));
    } catch {
        return null;
    }
}

/**
 * @param {FileResourceLockMetadata | null} metadata
 * @param {number} nowMs
 * @param {number} staleMs
 * @returns {boolean}
 */
function isStaleLock(metadata, nowMs, staleMs) {
    if (!metadata) return true;
    const ageMs = Math.max(0, nowMs - metadata.startedAtMs);
    if (ageMs >= staleMs) return true;
    return !isProcessAlive(metadata.pid);
}

/**
 * @param {string} lockPath
 * @param {FileResourceLockMetadata | null} expectedMetadata
 * @param {import('../io/fs/durability.js').IoDurabilityMode} durability
 * @returns {Promise<boolean>}
 */
async function reclaimStaleLock(lockPath, expectedMetadata, durability) {
    const observed = await readLockMetadata(lockPath);
    if (expectedMetadata?.token && observed?.token !== expectedMetadata.token) return false;
    await fs.unlink(lockPath).catch((error) => {
        if (errorCode(error) !== 'ENOENT') throw error;
    });
    if (shouldSyncDirectory(durability)) await syncParentDirectoryBestEffort(lockPath);
    return true;
}

/**
 * @param {import('node:fs/promises').FileHandle} handle
 * @param {FileResourceLockMetadata} metadata
 * @param {import('../io/fs/durability.js').IoDurabilityMode} durability
 */
async function writeLockMetadata(handle, metadata, durability) {
    await handle.writeFile(`${JSON.stringify(metadata)}\n`, 'utf8');
    if (durability !== 'none') await handle.sync();
}

/**
 * @param {string} resourceKey
 * @param {{ operation?: string; target?: string; staleMs?: number; timeoutMs?: number; pollMs?: number; signal?: AbortSignal; durability?: IoDurabilityMode }} [options]
 * @returns {Promise<FileResourceLockLease>}
 */
export async function acquireFileResourceLock(resourceKey, options = {}) {
    const normalizedKey = normalizePathResourceKey(resourceKey);
    const lockDir = getFileResourceLockDir();
    const lockPath = getFileResourceLockPath(normalizedKey, lockDir);
    const timeoutMs = options.timeoutMs ?? defaultAcquireTimeoutMs();
    const staleMs = options.staleMs ?? defaultStaleMs();
    const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
    const durability = normalizeIoDurability(options.durability ?? 'file-and-directory');
    const startedWait = Date.now();
    let staleRecovered = false;

    await fs.mkdir(lockDir, { recursive: true });

    while (true) {
        if (options.signal?.aborted) throw createAbortError();
        /** @type {import('node:fs/promises').FileHandle | null} */
        let handle = null;
        const token = randomUUID();
        const now = Date.now();
        /** @type {FileResourceLockMetadata} */
        const metadata = {
            schemaVersion: LOCK_SCHEMA_VERSION,
            token,
            pid: process.pid,
            hostname: hostname(),
            resourceKey: normalizedKey,
            resourceHash: hashFileResourceLockKey(normalizedKey),
            operation: options.operation ?? null,
            target: options.target ?? null,
            startedAt: new Date(now).toISOString(),
            startedAtMs: now,
        };

        try {
            handle = await fs.open(lockPath, 'wx');
            await writeLockMetadata(handle, metadata, durability);
            await handle.close();
            handle = null;
            if (shouldSyncDirectory(durability)) await syncParentDirectoryBestEffort(lockPath);
            activeFileLockPaths.add(lockPath);
            return {
                resourceKey: normalizedKey,
                lockPath,
                token,
                waitMs: Date.now() - startedWait,
                staleRecovered,
                release: async () => {
                    const current = await readLockMetadata(lockPath);
                    if (current?.token !== token) return;
                    await fs.unlink(lockPath).catch((error) => {
                        if (errorCode(error) !== 'ENOENT') throw error;
                    });
                    activeFileLockPaths.delete(lockPath);
                    if (shouldSyncDirectory(durability)) await syncParentDirectoryBestEffort(lockPath);
                },
            };
        } catch (error) {
            if (handle) await handle.close().catch(() => undefined);
            if (errorCode(error) !== 'EEXIST') throw error;

            const existing = await readLockMetadata(lockPath);
            if (isStaleLock(existing, Date.now(), staleMs)) {
                const reclaimed = await reclaimStaleLock(lockPath, existing, durability);
                staleRecovered = staleRecovered || reclaimed;
                if (reclaimed) continue;
            }

            if (Date.now() - startedWait >= timeoutMs) throw createTimeoutError(lockPath);
            await sleep(Math.min(pollMs, Math.max(1, timeoutMs - (Date.now() - startedWait))), options.signal);
        }
    }
}
