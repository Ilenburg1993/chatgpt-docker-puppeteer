/**
 * Barrel — Database (SQLite).
 *
 * @module copilot/db
 */

export { COPILOT_MIGRATIONS } from './migrations.js';
export { closeCopilotDb, getCopilotDb, resolveCopilotDbPath } from './sqlite.js';
