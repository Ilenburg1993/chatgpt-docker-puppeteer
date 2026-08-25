// @ts-check
/** Process-scoped configuration for persistent OAuth replay protection. */

const DEFAULT_MAX_ENTRIES_PER_NAMESPACE = 10_000;
const MIN_MAX_ENTRIES_PER_NAMESPACE = 100;
const MAX_MAX_ENTRIES_PER_NAMESPACE = 100_000;

/** @typedef {Readonly<{ maxEntriesPerNamespace: number }>} OAuthReplayStoreConfig */

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {OAuthReplayStoreConfig}
 */
export function readOAuthReplayStoreConfig(env = process.env) {
    return Object.freeze({
        maxEntriesPerNamespace: normalizeMaxEntries(env['COPILOT_MCP_OAUTH_REPLAY_MAX_ENTRIES_PER_NAMESPACE']),
    });
}

/** @param {unknown} value */
function normalizeMaxEntries(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < MIN_MAX_ENTRIES_PER_NAMESPACE) {
        return DEFAULT_MAX_ENTRIES_PER_NAMESPACE;
    }
    return Math.min(MAX_MAX_ENTRIES_PER_NAMESPACE, Math.round(numeric));
}
