// @ts-check
/**
 * Composition port for SQLite-backed infra capabilities.
 *
 * Infra owns cache/index/journal behavior but not the process-wide database lifecycle. A composition root provides the
 * database accessor explicitly; schema and migrations remain owned by `src/copilot/db`.
 *
 * Test-only lifecycle controls intentionally do not belong to this runtime entrypoint. They are exposed only through
 * `#copilot/infra/internal/testing`.
 *
 * @module copilot/infra/database
 */

export { configureInfraSqliteProvider, getInfraSqliteDatabase, getInfraSqliteProviderStatus } from './provider.js';
