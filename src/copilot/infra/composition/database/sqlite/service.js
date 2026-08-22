// @ts-check
/**
 * Application SQLite resource composition without exposing a concrete driver in the public surface.
 * The default driver stays lazy until the composition owner explicitly requests a resource.
 * @module copilot/infra/composition/database/sqlite/service
 */

/**
 * @param {{dbPath:string;log?:(level:string,message:string,meta?:Record<string,unknown>)=>void}} options
 */
export async function createApplicationSqliteRuntime(options) {
    const { createBetterSqliteApplicationRuntime } =
        await import('#copilot/infra/internal/database/sqlite/better-sqlite3');
    return createBetterSqliteApplicationRuntime(options);
}
