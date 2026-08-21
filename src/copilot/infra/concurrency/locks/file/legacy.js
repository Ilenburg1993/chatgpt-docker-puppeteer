// @ts-check
/**
 * Facade de compatibilidade para o lockfile L1 canônico.
 *
 * @module copilot/infra/concurrency/locks/file/legacy
 */

import { existsSync, lstatSync, readFileSync, unlinkSync } from 'node:fs';
import { lstat, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { acquireFileResourceLock } from './resource-lock.js';

/** @type {Map<string, Awaited<ReturnType<typeof acquireFileResourceLock>>>} */
const legacyLeases = new Map();

/**
 * Tenta adquirir o lock físico informado sem aguardar.
 *
 * @param {string} lockPath
 * @returns {Promise<boolean>}
 */
export async function acquireLock(lockPath) {
    const normalizedPath = path.resolve(lockPath);
    if (legacyLeases.has(normalizedPath)) return false;
    try {
        const lease = await acquireFileResourceLock(normalizedPath, {
            lockPath: normalizedPath,
            timeoutMs: 0,
            operation: 'legacy.acquireLock',
            target: normalizedPath,
        });
        legacyLeases.set(normalizedPath, lease);
        return true;
    } catch (error) {
        const code = /** @type {{ code?: unknown }} */ (error)?.code;
        if (code === 'ETIMEDOUT') return false;
        throw error;
    }
}

/**
 * Libera de forma síncrona para preservar o contrato legado.
 *
 * @param {string} lockPath
 * @returns {void}
 */
export function releaseLock(lockPath) {
    const normalizedPath = path.resolve(lockPath);
    const lease = legacyLeases.get(normalizedPath);
    try {
        if (!existsSync(normalizedPath)) return;
        if (lstatSync(normalizedPath).isSymbolicLink()) return;
        const pid = readLockOwnerPid(readFileSync(normalizedPath, 'utf8'));
        if (pid === process.pid) unlinkSync(normalizedPath);
    } catch {
        // compatibilidade best-effort
    } finally {
        if (lease) {
            legacyLeases.delete(normalizedPath);
            void lease.release().catch(() => undefined);
        }
    }
}

/**
 * Libera o lease canônico e aguarda remoção do lock físico.
 *
 * @param {string} lockPath
 * @returns {Promise<void>}
 */
export async function releaseLockAsync(lockPath) {
    const normalizedPath = path.resolve(lockPath);
    const lease = legacyLeases.get(normalizedPath);
    if (lease) {
        legacyLeases.delete(normalizedPath);
        await lease.release().catch(() => undefined);
        return;
    }

    try {
        const stats = await lstat(normalizedPath).catch((error) => {
            const code = /** @type {{ code?: unknown }} */ (error)?.code;
            if (code === 'ENOENT') return null;
            throw error;
        });
        if (!stats || stats.isSymbolicLink()) return;
        const pid = readLockOwnerPid(await readFile(normalizedPath, 'utf8'));
        if (pid === process.pid) {
            await unlink(normalizedPath).catch((error) => {
                const code = /** @type {{ code?: unknown }} */ (error)?.code;
                if (code !== 'ENOENT') throw error;
            });
        }
    } catch {
        // compatibilidade best-effort para locks criados por versões antigas
    }
}

/**
 * @param {string} raw
 * @returns {number | null}
 */
function readLockOwnerPid(raw) {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    try {
        const parsed = JSON.parse(trimmed);
        const pid = Number(parsed?.pid);
        return Number.isInteger(pid) && pid > 0 ? pid : null;
    } catch {
        const pid = Number.parseInt(trimmed, 10);
        return Number.isInteger(pid) && pid > 0 ? pid : null;
    }
}
