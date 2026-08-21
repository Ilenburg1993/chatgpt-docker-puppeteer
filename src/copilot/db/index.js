// @ts-check
/**
 * Barrel — Database (SQLite).
 *
 * @module copilot/db
 * @see EventBus
 */

export { IO_INDEX_SCHEMA_VERSION, ensureIoIndexSchema } from './io-index-schema.js';
export { COPILOT_MIGRATIONS } from './migrations.js';
export { closeCopilotDb, ensureCopilotDbDir, getCopilotDb, resolveCopilotDbPath, setDbLogger } from './sqlite.js';
