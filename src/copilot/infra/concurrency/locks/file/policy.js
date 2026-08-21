// @ts-check
/** Configuration and deterministic path policy for multiprocess resource locks. */

import { normalizePathResourceKey } from '#copilot/infra/internal/policy';
import { createHash } from 'node:crypto';
import path from 'node:path';

/** @typedef {import('./types.js').FileResourceLockProfile} FileResourceLockProfile */

const DEFAULT_STALE_MS = 10 * 60 * 1000;
const DEFAULT_ACQUIRE_TIMEOUT_MS = 30_000;
export const DEFAULT_FILE_RESOURCE_LOCK_POLL_MS = 25;
export const MIN_FILE_RESOURCE_LOCK_HEARTBEAT_MS = 10;
export const MAX_FILE_RESOURCE_LOCK_HEARTBEAT_MS = 30_000;
export const FILE_RESOURCE_LOCK_SCHEMA_VERSION = 1;

/** @param {unknown} value @returns {FileResourceLockProfile} */
export function normalizeFileResourceLockProfile(value) {
    const normalized = String(value ?? '')
        .trim()
        .toLowerCase();
    if (!normalized || /^(0|false|no|off)$/.test(normalized)) return 'off';
    if (/^(1|true|yes|on)$/.test(normalized)) return 'all';
    if (normalized === 'high-risk' || normalized === 'mutations' || normalized === 'all') return normalized;
    const error = /** @type {Error & { code?: string }} */ (
        new Error(`COPILOT_IO_FILE_LOCKS_ENABLED inválido "${normalized}". Valores: off, high-risk, mutations, all.`)
    );
    error.code = 'ERR_IO_FILE_LOCK_PROFILE';
    throw error;
}

export function getFileResourceLockProfile() {
    return normalizeFileResourceLockProfile(process.env['COPILOT_IO_FILE_LOCKS_ENABLED']);
}

export function isFileResourceLockEnabledByEnv() {
    return getFileResourceLockProfile() !== 'off';
}

/** @param {{ explicit?: boolean; riskClass?: import('#copilot/core/io-contracts').IoRiskClass }} [options] */
export function shouldAcquireFileResourceLock(options = {}) {
    if (options.explicit === true) return true;
    const profile = getFileResourceLockProfile();
    if (profile === 'off') return false;
    if (profile === 'all') return true;
    if (profile === 'high-risk') return options.riskClass === 'high' || options.riskClass === 'critical';
    return options.riskClass === 'medium' || options.riskClass === 'high' || options.riskClass === 'critical';
}

export function defaultFileResourceLockStaleMs() {
    const raw = Number(process.env['COPILOT_IO_FILE_LOCK_STALE_MS']);
    return Number.isFinite(raw) && raw >= 1 ? raw : DEFAULT_STALE_MS;
}

export function defaultFileResourceLockAcquireTimeoutMs() {
    const raw = Number(process.env['COPILOT_IO_FILE_LOCK_TIMEOUT_MS']);
    return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_ACQUIRE_TIMEOUT_MS;
}

export function getFileResourceLockDir() {
    const raw = String(process.env['COPILOT_IO_FILE_LOCK_DIR'] ?? '').trim();
    return raw ? path.resolve(raw) : path.join(process.cwd(), 'src', 'copilot', '.ai', 'locks');
}

/** @param {string} resourceKey */
export function hashFileResourceLockKey(resourceKey) {
    return createHash('sha256').update(normalizePathResourceKey(resourceKey)).digest('hex');
}

/** @param {string} resourceKey @param {string} [lockDir] */
export function getFileResourceLockPath(resourceKey, lockDir = getFileResourceLockDir()) {
    return path.join(lockDir, `${hashFileResourceLockKey(resourceKey)}.lock`);
}
