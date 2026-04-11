// @ts-check
/**
 * Barrel — Database (SQLite).
 *
 * @module copilot/db
 * @see EventBus
 */

export { COPILOT_MIGRATIONS } from './migrations.js';
export { closeCopilotDb, getCopilotDb, resolveCopilotDbPath, setDbLogger } from './sqlite.js';
