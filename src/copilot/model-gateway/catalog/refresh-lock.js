// @ts-check
/**
 * Process-local refresh locks.
 *
 * These locks protect one Node.js process from overlapping catalog refreshes for the same store/source key. They are a
 * pre-runtime coordination primitive; durable cross-process locks can be layered underneath the same contract later.
 *
 * @module copilot/model-gateway/catalog/refresh-lock
 */

/** @type {Map<string, symbol>} */
const ACTIVE_REFRESH_LOCKS = new Map();

export class ModelGatewayCatalogRefreshLockError extends Error {
    /**
     * @param {string} lockKey
     */
    constructor(lockKey) {
        super(`model-gateway catalog refresh already running for lock key: ${lockKey}`);
        this.name = 'ModelGatewayCatalogRefreshLockError';
        this.code = 'MODEL_GATEWAY_CATALOG_REFRESH_LOCKED';
        this.lockKey = lockKey;
    }
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function optionalString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * @param {unknown} store
 * @returns {string | null}
 */
export function resolveModelGatewayCatalogRefreshLockKey(store) {
    if (!store || typeof store !== 'object') return null;
    const record = /** @type {Record<string, unknown>} */ (store);
    return optionalString(record['filePath']) ?? optionalString(record['databasePath']) ?? null;
}

/**
 * @param {string} lockKey
 * @returns {boolean}
 */
export function isModelGatewayCatalogRefreshLocked(lockKey) {
    return ACTIVE_REFRESH_LOCKS.has(lockKey);
}

/**
 * @template T
 * @param {string} lockKey
 * @param {() => Promise<T>} operation
 * @returns {Promise<T>}
 */
export async function withModelGatewayCatalogRefreshLock(lockKey, operation) {
    const normalizedLockKey = optionalString(lockKey) ?? 'default';
    if (ACTIVE_REFRESH_LOCKS.has(normalizedLockKey)) throw new ModelGatewayCatalogRefreshLockError(normalizedLockKey);
    const token = Symbol(normalizedLockKey);
    ACTIVE_REFRESH_LOCKS.set(normalizedLockKey, token);
    try {
        return await operation();
    } finally {
        if (ACTIVE_REFRESH_LOCKS.get(normalizedLockKey) === token) ACTIVE_REFRESH_LOCKS.delete(normalizedLockKey);
    }
}
