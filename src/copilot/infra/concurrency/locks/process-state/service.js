// @ts-check
/**
 * Single active process-lock configuration registry.
 *
 * The registry owns no environment access and no lock policy derivation. One process composition owner may install an
 * already-resolved immutable config; lock kernels consult it synchronously. Standalone/test factories that do not
 * activate an owner observe the deterministic fallback instead of ambient process.env.
 *
 * @module copilot/infra/concurrency/locks/process-state/service
 */

const DEFAULT_PROCESS_LOCK_CONFIG = Object.freeze({
    file: null,
    fileConfigurationError: null,
    observability: Object.freeze({ activeLeaseWarnMs: 60_000 }),
});

/** @typedef {'off'|'high-risk'|'mutations'|'all'} ProcessFileLockProfile */
/** @typedef {Readonly<{profile:ProcessFileLockProfile;staleMs:number;acquireTimeoutMs:number;lockDir:string}>} ProcessFileLockPolicy */
/** @typedef {Readonly<{
 * file: ProcessFileLockPolicy | null;
 * fileConfigurationError: string | null;
 * observability: Readonly<{activeLeaseWarnMs:number}>;
 * }>} ProcessLockConfig
 */

/** @type {{token:object;processId:string;config:ProcessLockConfig} | null} */
let activeOwner = null;

/**
 * Install one explicit process owner. A different active owner is rejected rather than silently replacing policy.
 * @param {{token:object;processId:string;config:ProcessLockConfig}} owner
 * @returns {() => void}
 */
export function activateProcessLockConfig(owner) {
    if (!owner?.token || typeof owner.token !== 'object') throw new TypeError('Process lock owner requires token.');
    const processId = String(owner.processId ?? '').trim();
    if (!processId) throw new TypeError('Process lock owner requires processId.');
    if (activeOwner && activeOwner.token !== owner.token) {
        const error = /** @type {Error & {code?:string}} */ (
            new Error(`Process lock configuration is already owned by ${activeOwner.processId}.`)
        );
        error.code = 'ERR_PROCESS_LOCK_OWNER_ACTIVE';
        throw error;
    }
    activeOwner = Object.freeze({ token: owner.token, processId, config: owner.config });
    return () => {
        if (activeOwner?.token === owner.token) activeOwner = null;
    };
}

/** @returns {ProcessLockConfig} */
export function getActiveProcessLockConfig() {
    return activeOwner?.config ?? DEFAULT_PROCESS_LOCK_CONFIG;
}

export function getActiveProcessLockOwnerSnapshot() {
    return Object.freeze({
        active: activeOwner !== null,
        processId: activeOwner?.processId ?? null,
        fileProfile: activeOwner?.config.file?.profile ?? 'off',
        fileConfigurationError: activeOwner?.config.fileConfigurationError ?? null,
        activeLeaseWarnMs:
            activeOwner?.config.observability.activeLeaseWarnMs ??
            DEFAULT_PROCESS_LOCK_CONFIG.observability.activeLeaseWarnMs,
    });
}
