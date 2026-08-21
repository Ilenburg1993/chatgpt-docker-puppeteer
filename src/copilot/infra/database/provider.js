// @ts-check
/**
 * Instance-local SQLite provider binding.
 *
 * Database lifecycle, schema and migrations remain owned by the caller. Composition roots create isolated bindings.
 *
 * @module copilot/infra/database/provider
 */

/** @typedef {() => import('better-sqlite3').Database} InfraSqliteProvider */

/** @param {InfraSqliteProvider | null} [initialProvider=null] */
export function createInfraSqliteProviderBinding(initialProvider = null) {
    /** @type {InfraSqliteProvider | null} */
    let provider = null;
    let revision = 0;

    /** @param {InfraSqliteProvider} nextProvider */
    function configure(nextProvider) {
        if (typeof nextProvider !== 'function') throw new TypeError('SQLite provider binding requires a function');
        if (provider === nextProvider) return revision;
        provider = nextProvider;
        revision += 1;
        return revision;
    }
    function get() {
        if (!provider) {
            const error = new Error('Infra SQLite provider is not configured by the runtime composition root.');
            Object.assign(error, { code: 'ERR_INFRA_SQLITE_PROVIDER_UNCONFIGURED' });
            throw error;
        }
        return provider();
    }
    function status() {
        return Object.freeze({ configured: provider !== null, revision });
    }
    function reset() {
        provider = null;
        revision += 1;
        return revision;
    }
    if (initialProvider !== null) configure(initialProvider);
    return Object.freeze({ configure, get, reset, status });
}
