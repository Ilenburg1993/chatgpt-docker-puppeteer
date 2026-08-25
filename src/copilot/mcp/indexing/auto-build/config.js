// @ts-check
/** Immutable process-scoped policy for MCP index startup auto-build. */

export const MCP_INDEX_AUTO_BUILD_CONFIG_SCHEMA_VERSION = 2;
export const MCP_INDEX_AUTO_BUILD_CONFIG_KIND = 'copilot-mcp-index-auto-build-config';
export const DEFAULT_AUTO_BUILD_PATH = 'src/copilot';
export const DEFAULT_AUTO_BUILD_MAX_FILES = 5000;
export const DEFAULT_AUTO_BUILD_DEPTH = 20;
export const DEFAULT_AUTO_BUILD_CONCURRENCY = 4;
export const DEFAULT_FULL_RECONCILE_INTERVAL_MS = 30 * 60 * 1000;
export const DEFAULT_JOURNAL_REPLAY_MAX_ROWS = 2048;
export const DEFAULT_HASH_VERIFY_SAMPLE_FILES = 8;
export const DEFAULT_NO_CHANGE_SLO_MS = 1_000;

/**
 * @typedef {Readonly<{
 *     schemaVersion: 2;
 *     kind: 'copilot-mcp-index-auto-build-config';
 *     generationKey: string;
 *     enabled: boolean;
 *     path: string;
 *     maxFiles: number;
 *     depth: number;
 *     concurrency: number;
 *     respectGitignore: boolean;
 *     fullReconcileIntervalMs: number;
 *     journalReplayMaxRows: number;
 *     hashVerifySampleFiles: number;
 *     noChangeSloMs: number;
 * }>} McpIndexAutoBuildConfig
 */

/** @param {unknown} value */
function envBool(value) {
    const normalized = String(value ?? '')
        .trim()
        .toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

/** @param {unknown} value @param {boolean} fallback */
function envBoolWithDefault(value, fallback) {
    const normalized = String(value ?? '')
        .trim()
        .toLowerCase();
    if (!normalized) return fallback;
    if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') return false;
    return envBool(normalized);
}

/** @param {unknown} value @param {number} fallback @param {{ min: number; max: number }} range */
function envInt(value, fallback, range) {
    const normalized = String(value ?? '').trim();
    if (!normalized) return fallback;
    const parsed = Number(normalized);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(range.max, Math.max(range.min, Math.round(parsed)));
}

/** @param {NodeJS.ProcessEnv | Record<string, string | undefined>} env @returns {McpIndexAutoBuildConfig} */
export function readMcpIndexAutoBuildConfig(env) {
    if (!env) throw new TypeError('MCP index auto-build config requires an explicit environment.');
    const enabled = envBoolWithDefault(env['COPILOT_MCP_INDEX_AUTO_BUILD'], true);
    const path =
        String(env['COPILOT_MCP_INDEX_AUTO_BUILD_PATH'] ?? DEFAULT_AUTO_BUILD_PATH).trim() || DEFAULT_AUTO_BUILD_PATH;
    const maxFiles = envInt(env['COPILOT_MCP_INDEX_AUTO_BUILD_MAX_FILES'], DEFAULT_AUTO_BUILD_MAX_FILES, {
        min: 1,
        max: 25_000,
    });
    const depth = envInt(env['COPILOT_MCP_INDEX_AUTO_BUILD_DEPTH'], DEFAULT_AUTO_BUILD_DEPTH, { min: 1, max: 50 });
    const concurrency = envInt(env['COPILOT_MCP_INDEX_AUTO_BUILD_CONCURRENCY'], DEFAULT_AUTO_BUILD_CONCURRENCY, {
        min: 1,
        max: 32,
    });
    const respectGitignore = !envBool(env['COPILOT_MCP_INDEX_AUTO_BUILD_IGNORE_GITIGNORE']);
    const fullReconcileIntervalMs = envInt(
        env['COPILOT_MCP_INDEX_FULL_RECONCILE_INTERVAL_MS'],
        DEFAULT_FULL_RECONCILE_INTERVAL_MS,
        { min: 60_000, max: 24 * 60 * 60 * 1000 },
    );
    const journalReplayMaxRows = envInt(
        env['COPILOT_MCP_INDEX_JOURNAL_REPLAY_MAX_ROWS'],
        DEFAULT_JOURNAL_REPLAY_MAX_ROWS,
        { min: 64, max: 10_000 },
    );
    const hashVerifySampleFiles = envInt(
        env['COPILOT_MCP_INDEX_HASH_VERIFY_SAMPLE_FILES'],
        DEFAULT_HASH_VERIFY_SAMPLE_FILES,
        { min: 1, max: 128 },
    );
    const noChangeSloMs = envInt(env['COPILOT_MCP_INDEX_NO_CHANGE_SLO_MS'], DEFAULT_NO_CHANGE_SLO_MS, {
        min: 50,
        max: 60_000,
    });
    const generationKey = [
        'v2',
        enabled ? '1' : '0',
        path,
        maxFiles,
        depth,
        concurrency,
        respectGitignore ? '1' : '0',
        fullReconcileIntervalMs,
        journalReplayMaxRows,
        hashVerifySampleFiles,
        noChangeSloMs,
    ].join(':');
    return Object.freeze({
        schemaVersion: MCP_INDEX_AUTO_BUILD_CONFIG_SCHEMA_VERSION,
        kind: MCP_INDEX_AUTO_BUILD_CONFIG_KIND,
        generationKey,
        enabled,
        path,
        maxFiles,
        depth,
        concurrency,
        respectGitignore,
        fullReconcileIntervalMs,
        journalReplayMaxRows,
        hashVerifySampleFiles,
        noChangeSloMs,
    });
}
