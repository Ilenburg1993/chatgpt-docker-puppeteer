// @ts-check
/**
 * Process-local provider state for SQLite-backed infra capabilities.
 *
 * This leaf owns only composition state. Database lifecycle, schema and migrations remain outside infra.
 *
 * @module copilot/infra/database/provider
 */

/** @typedef {() => import('better-sqlite3').Database} InfraSqliteProvider */

/** @type {InfraSqliteProvider | null} */
let _provider = null;
let _revision = 0;

/** @param {InfraSqliteProvider} provider */
export function configureInfraSqliteProvider(provider) {
    if (typeof provider !== 'function') throw new TypeError('configureInfraSqliteProvider requires a function');
    if (_provider === provider) return;
    _provider = provider;
    _revision += 1;
}

/** @returns {import('better-sqlite3').Database} */
export function getInfraSqliteDatabase() {
    if (!_provider) {
        const error = new Error('Infra SQLite provider is not configured by the runtime composition root.');
        Object.assign(error, { code: 'ERR_INFRA_SQLITE_PROVIDER_UNCONFIGURED' });
        throw error;
    }
    return _provider();
}

export function getInfraSqliteProviderStatus() {
    return Object.freeze({ configured: _provider !== null, revision: _revision });
}

/** Test-only reset. Capability registries must be reset before replacing an already-materialized database. */
export function resetInfraSqliteProviderForTest() {
    _provider = null;
    _revision += 1;
}
