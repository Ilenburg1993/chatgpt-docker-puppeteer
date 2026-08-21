// @ts-check
/** Lockfile metadata parsing, observation, stale recovery, heartbeat and owned release. */

import { shouldSyncDirectory, syncParentDirectoryBestEffort } from '#copilot/infra/internal/platform/node/filesystem';
import * as fs from 'node:fs/promises';
import { hostname } from 'node:os';
import {
    FILE_RESOURCE_LOCK_SCHEMA_VERSION,
    MAX_FILE_RESOURCE_LOCK_HEARTBEAT_MS,
    MIN_FILE_RESOURCE_LOCK_HEARTBEAT_MS,
} from './policy.js';
import { recordFileLockHeartbeatFailure, recordFileLockStaleRecovery } from './state.js';
import { fileLockErrorCode } from './wait.js';

/** @typedef {import('./types.js').FileResourceLockMetadata} FileResourceLockMetadata */
/** @typedef {import('./types.js').FileResourceLockObservation} FileResourceLockObservation */

/** @param {number} pid */
function isProcessAlive(pid) {
    if (!Number.isInteger(pid) || pid <= 0) return false;
    if (pid === process.pid) return true;
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return fileLockErrorCode(error) === 'EPERM';
    }
}

/** @param {unknown} value @returns {FileResourceLockMetadata | null} */
function parseLockMetadata(value) {
    if (!value || typeof value !== 'object') return null;
    const item = /** @type {Record<string, unknown>} */ (value);
    if (item['schemaVersion'] !== FILE_RESOURCE_LOCK_SCHEMA_VERSION) return null;
    if (typeof item['token'] !== 'string' || item['token'].length === 0) return null;
    if (!Number.isInteger(item['pid'])) return null;
    if (
        typeof item['hostname'] !== 'string' ||
        typeof item['resourceKey'] !== 'string' ||
        typeof item['resourceHash'] !== 'string'
    )
        return null;
    if (typeof item['startedAt'] !== 'string' || typeof item['startedAtMs'] !== 'number') return null;
    return /** @type {FileResourceLockMetadata} */ (value);
}

/** @param {string} lockPath */
export async function readFileLockMetadata(lockPath) {
    try {
        return parseLockMetadata(JSON.parse(await fs.readFile(lockPath, 'utf8')));
    } catch {
        return null;
    }
}

/** @param {string} lockPath @returns {Promise<FileResourceLockObservation>} */
export async function observeFileLock(lockPath) {
    const [metadataResult, statResult] = await Promise.allSettled([readFileLockMetadata(lockPath), fs.stat(lockPath)]);
    const stats = statResult.status === 'fulfilled' ? statResult.value : null;
    return {
        metadata: metadataResult.status === 'fulfilled' ? metadataResult.value : null,
        dev: stats ? Number(stats.dev) : null,
        ino: stats ? Number(stats.ino) : null,
        mtimeMs: stats ? Number(stats.mtimeMs) : null,
        size: stats ? Number(stats.size) : null,
    };
}

/** @param {string} lockPath */
export async function assertFileLockPathIsNotSymlink(lockPath) {
    try {
        const stats = await fs.lstat(lockPath);
        if (stats.isSymbolicLink()) {
            const error = new Error(`Lock path inválido (symlink detectado): ${lockPath}`);
            /** @type {{code?:string}} */ (error).code = 'ERR_LOCKFILE_SYMLINK';
            throw error;
        }
    } catch (error) {
        if (fileLockErrorCode(error) === 'ENOENT') return;
        throw error;
    }
}

/** @param {FileResourceLockObservation} left @param {FileResourceLockObservation} right */
function sameObservedFileLock(left, right) {
    if (left.metadata?.token || right.metadata?.token)
        return Boolean(left.metadata?.token && left.metadata.token === right.metadata?.token);
    return (
        left.dev !== null &&
        left.dev === right.dev &&
        left.ino !== null &&
        left.ino === right.ino &&
        left.mtimeMs !== null &&
        left.mtimeMs === right.mtimeMs &&
        left.size !== null &&
        left.size === right.size
    );
}

/** @param {FileResourceLockObservation} observation @param {number} nowMs @param {number} staleMs */
export function isStaleFileLock(observation, nowMs, staleMs) {
    const metadata = observation.metadata;
    const observedAtMs = observation.mtimeMs ?? metadata?.startedAtMs ?? nowMs;
    const ageMs = Math.max(0, nowMs - observedAtMs);
    if (!metadata) return ageMs >= staleMs;
    if (metadata.hostname === hostname()) return !isProcessAlive(metadata.pid);
    return ageMs >= staleMs;
}

/** @param {string} lockPath @param {FileResourceLockObservation} expected @param {import('#copilot/infra/internal/platform/node/filesystem').IoDurabilityMode} durability */
export async function reclaimStaleFileLock(lockPath, expected, durability) {
    await assertFileLockPathIsNotSymlink(lockPath);
    if (!sameObservedFileLock(expected, await observeFileLock(lockPath))) return false;
    await fs.unlink(lockPath).catch((error) => {
        if (fileLockErrorCode(error) !== 'ENOENT') throw error;
    });
    if (shouldSyncDirectory(durability)) await syncParentDirectoryBestEffort(lockPath);
    recordFileLockStaleRecovery();
    return true;
}

/** @param {import('node:fs/promises').FileHandle} handle @param {number} staleMs */
export function startFileLockHeartbeat(handle, staleMs) {
    const heartbeatMs = Math.max(
        MIN_FILE_RESOURCE_LOCK_HEARTBEAT_MS,
        Math.min(MAX_FILE_RESOURCE_LOCK_HEARTBEAT_MS, Math.floor(staleMs / 3)),
    );
    const timer = setInterval(() => {
        const now = new Date();
        void handle.utimes(now, now).catch(() => recordFileLockHeartbeatFailure());
    }, heartbeatMs);
    timer.unref?.();
    return timer;
}

/** @param {import('node:fs/promises').FileHandle} handle @param {FileResourceLockMetadata} metadata @param {import('#copilot/infra/internal/platform/node/filesystem').IoDurabilityMode} durability */
export async function writeFileLockMetadata(handle, metadata, durability) {
    await handle.writeFile(`${JSON.stringify(metadata)}\n`, 'utf8');
    if (durability !== 'none') await handle.sync();
}

/** @param {string} lockPath @param {string} token @param {import('#copilot/infra/internal/platform/node/filesystem').IoDurabilityMode} durability */
export async function releaseOwnedFileLock(lockPath, token, durability) {
    const current = await readFileLockMetadata(lockPath);
    if (current?.token !== token) return;
    await fs.unlink(lockPath).catch((error) => {
        if (fileLockErrorCode(error) !== 'ENOENT') throw error;
    });
    if (shouldSyncDirectory(durability)) await syncParentDirectoryBestEffort(lockPath);
}
