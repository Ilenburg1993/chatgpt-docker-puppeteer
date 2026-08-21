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

// File locks coordinate the physical process and peer processes, not one InfraRuntime. Capture their environment once
// when this process loads the capability; per-operation overrides remain explicit through lock options. An invalid
// profile is fail-safe: automatic file locking is disabled, while diagnostics preserve the configuration error.
const PROCESS_FILE_RESOURCE_LOCK_STATE = (() => {
    try {
        return Object.freeze({ policy: readFileResourceLockPolicy(process.env), configurationError: null });
    } catch (error) {
        return Object.freeze({
            policy: readFileResourceLockPolicy({
                ...process.env,
                COPILOT_IO_FILE_LOCKS_ENABLED: 'off',
            }),
            configurationError: error instanceof Error ? error : new Error(String(error)),
        });
    }
})();
const PROCESS_FILE_RESOURCE_LOCK_POLICY = PROCESS_FILE_RESOURCE_LOCK_STATE.policy;

export function getFileResourceLockProfile() {
    if (PROCESS_FILE_RESOURCE_LOCK_STATE.configurationError) throw PROCESS_FILE_RESOURCE_LOCK_STATE.configurationError;
    return PROCESS_FILE_RESOURCE_LOCK_POLICY.profile;
}

export function getFileResourceLockConfigurationError() {
    return PROCESS_FILE_RESOURCE_LOCK_STATE.configurationError;
}

export function isFileResourceLockEnabled() {
    return (
        PROCESS_FILE_RESOURCE_LOCK_STATE.configurationError === null &&
        PROCESS_FILE_RESOURCE_LOCK_POLICY.profile !== 'off'
    );
}

/**
 * @param {{ explicit?: boolean; riskClass?: import('#copilot/core/io-contracts').IoRiskClass }} [options]
 * @param {ReturnType<typeof readFileResourceLockPolicy>} [policy]
 */
export function shouldAcquireFileResourceLock(options = {}, policy = PROCESS_FILE_RESOURCE_LOCK_POLICY) {
    if (options.explicit === true) return true;
    if (policy === PROCESS_FILE_RESOURCE_LOCK_POLICY && PROCESS_FILE_RESOURCE_LOCK_STATE.configurationError)
        return false;
    const profile = policy.profile;
    if (profile === 'off') return false;
    if (profile === 'all') return true;
    if (profile === 'high-risk') return options.riskClass === 'high' || options.riskClass === 'critical';
    return options.riskClass === 'medium' || options.riskClass === 'high' || options.riskClass === 'critical';
}

export function defaultFileResourceLockStaleMs() {
    return PROCESS_FILE_RESOURCE_LOCK_POLICY.staleMs;
}

export function defaultFileResourceLockAcquireTimeoutMs() {
    return PROCESS_FILE_RESOURCE_LOCK_POLICY.acquireTimeoutMs;
}

export function getFileResourceLockDir() {
    return PROCESS_FILE_RESOURCE_LOCK_POLICY.lockDir;
}

/** @param {string} resourceKey */
export function hashFileResourceLockKey(resourceKey) {
    return createHash('sha256').update(normalizePathResourceKey(resourceKey)).digest('hex');
}

/** @param {string} resourceKey @param {string} [lockDir] */
export function getFileResourceLockPath(resourceKey, lockDir = getFileResourceLockDir()) {
    return path.join(lockDir, `${hashFileResourceLockKey(resourceKey)}.lock`);
}
