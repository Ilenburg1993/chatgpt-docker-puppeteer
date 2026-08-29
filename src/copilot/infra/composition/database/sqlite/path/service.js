// @ts-check
/** Canonical application SQLite path resolution owned by Infra composition. */

import { isAbsolute, resolve } from 'node:path';

/**
 * Resolve the application SQLite target from the process-owned configuration generation.
 * Relative configured paths are anchored to the explicit workspace root; directory-shaped targets receive
 * `copilot.sqlite`. `:memory:` is preserved verbatim.
 *
 * @param {NodeJS.ProcessEnv} env
 * @param {string} workspaceRoot
 * @returns {string}
 */
export function resolveApplicationSqlitePath(env, workspaceRoot) {
    if (!env || typeof env !== 'object') throw new TypeError('Application SQLite path resolution requires env.');
    const root = String(workspaceRoot ?? '').trim();
    if (!root) throw new TypeError('Application SQLite path resolution requires an explicit workspace root.');

    const configured = String(env['COPILOT_DB_PATH'] ?? '').trim();
    if (configured === ':memory:') return configured;

    const raw = configured || 'data/copilot.sqlite';
    const anchored = isAbsolute(raw) ? raw : resolve(root, raw);
    const looksLikeDirectory = /[\\/]$/u.test(raw);
    return resolve(looksLikeDirectory ? resolve(anchored, 'copilot.sqlite') : anchored);
}
