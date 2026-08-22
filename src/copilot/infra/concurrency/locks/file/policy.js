// @ts-check
/** Configuration and deterministic path policy for multiprocess resource locks. */

import { normalizePathResourceKey } from '#copilot/infra/internal/policy';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { getActiveProcessLockConfig } from '../process-state/index.js';

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

/**
 * Resolve one immutable process-lock policy from an explicit environment snapshot.
 * @param {NodeJS.ProcessEnv | Record<string,string|undefined>} env
 * @param {string} [cwd]
 */
export function readFileResourceLockPolicy(env, cwd = process.cwd()) {
    const source = env ?? {};
    const staleRaw = Number(source['COPILOT_IO_FILE_LOCK_STALE_MS']);
    const timeoutRaw = Number(source['COPILOT_IO_FILE_LOCK_TIMEOUT_MS']);
    const configuredDir = String(source['COPILOT_IO_FILE_LOCK_DIR'] ?? '').trim();
    return Object.freeze({
        profile: normalizeFileResourceLockProfile(source['COPILOT_IO_FILE_LOCKS_ENABLED']),
        staleMs: Number.isFinite(staleRaw) && staleRaw >= 1 ? staleRaw : DEFAULT_STALE_MS,
        acquireTimeoutMs: Number.isFinite(timeoutRaw) && timeoutRaw >= 0 ? timeoutRaw : DEFAULT_ACQUIRE_TIMEOUT_MS,
        lockDir: configuredDir
            ? path.resolve(configuredDir)
            : path.join(path.resolve(cwd), 'src', 'copilot', '.ai', 'locks'),
    });
}

/** @param {string} [cwd] */
function createDefaultFileResourceLockPolicy(cwd = process.cwd()) {
    return Object.freeze({
        profile: /** @type {FileResourceLockProfile} */ ('off'),
        staleMs: DEFAULT_STALE_MS,
        acquireTimeoutMs: DEFAULT_ACQUIRE_TIMEOUT_MS,
        lockDir: path.join(path.resolve(cwd), 'src', 'copilot', '.ai', 'locks'),
    });
}

function activeFileResourceLockPolicy() {
    return getActiveProcessLockConfig().file ?? createDefaultFileResourceLockPolicy();
}

export function getFileResourceLockProfile() {
    const configurationError = getFileResourceLockConfigurationError();
    if (configurationError) throw configurationError;
    return activeFileResourceLockPolicy().profile;
}

export function getFileResourceLockConfigurationError() {
    const message = getActiveProcessLockConfig().fileConfigurationError;
    if (!message) return null;
    const error = /** @type {Error & {code?:string}} */ (new Error(message));
    error.code = 'ERR_IO_FILE_LOCK_PROFILE';
    return error;
}

export function isFileResourceLockEnabled() {
    return getFileResourceLockConfigurationError() === null && activeFileResourceLockPolicy().profile !== 'off';
}

/**
 * @param {{ explicit?: boolean; riskClass?: import('#copilot/core/io-contracts').IoRiskClass }} [options]
 * @param {ReturnType<typeof readFileResourceLockPolicy>} [policy]
 */
export function shouldAcquireFileResourceLock(options = {}, policy = undefined) {
    if (options.explicit === true) return true;
    if (!policy && getFileResourceLockConfigurationError()) return false;
    const profile = (policy ?? activeFileResourceLockPolicy()).profile;
    if (profile === 'off') return false;
    if (profile === 'all') return true;
    if (profile === 'high-risk') return options.riskClass === 'high' || options.riskClass === 'critical';
    return options.riskClass === 'medium' || options.riskClass === 'high' || options.riskClass === 'critical';
}

export function defaultFileResourceLockStaleMs() {
    return activeFileResourceLockPolicy().staleMs;
}

export function defaultFileResourceLockAcquireTimeoutMs() {
    return activeFileResourceLockPolicy().acquireTimeoutMs;
}

export function getFileResourceLockDir() {
    return activeFileResourceLockPolicy().lockDir;
}

/** @param {string} resourceKey */
export function hashFileResourceLockKey(resourceKey) {
    return createHash('sha256').update(normalizePathResourceKey(resourceKey)).digest('hex');
}

/** @param {string} resourceKey @param {string} [lockDir] */
export function getFileResourceLockPath(resourceKey, lockDir = getFileResourceLockDir()) {
    return path.join(lockDir, `${hashFileResourceLockKey(resourceKey)}.lock`);
}
