// @ts-check
/**
 * Barrel — Database (SQLite).
 *
 * @module copilot/db
 */

export { COPILOT_MIGRATIONS } from './migrations.js';
export { closeCopilotDb, getCopilotDb, resolveCopilotDbPath, setDbLogger } from './sqlite.js';
