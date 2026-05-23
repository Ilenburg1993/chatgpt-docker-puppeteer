// @ts-check
/**
 * Optional MCP HTTP boot-time IO index auto-build.
 *
 * @module copilot/mcp/control-plane/index-auto-build
 */

import { buildIoIndexForDirectory, getIoIndexStats } from '#copilot/infra/public/indexing';
import { WORKSPACE_ROOT } from '#copilot/tools';
import { resolveReadPath } from './paths.js';

/**
 * @typedef {object} McpIndexAutoBuildConfig
 * @property {boolean} enabled
 * @property {string} path
 * @property {number} maxFiles
 * @property {number} depth
 * @property {number} concurrency
 * @property {boolean} respectGitignore
 */

/**
 * @typedef {object} McpIndexAutoBuildState
 * @property {'never-started' | 'disabled' | 'running' | 'completed' | 'failed' | 'skipped'} status
 * @property {string | null} startedAt
 * @property {string | null} completedAt
 * @property {string | null} reason
 * @property {Record<string, unknown> | null} result
 * @property {Record<string, unknown> | null} error
 * @property {McpIndexAutoBuildConfig} config
 * @property {Record<string, unknown>} stats
 */

const DEFAULT_AUTO_BUILD_PATH = 'src/copilot';
const DEFAULT_AUTO_BUILD_MAX_FILES = 5000;
const DEFAULT_AUTO_BUILD_DEPTH = 20;
const DEFAULT_AUTO_BUILD_CONCURRENCY = 4;

/** @type {McpIndexAutoBuildState | null} */
let autoBuildState = null;
/** @type {Promise<McpIndexAutoBuildState> | null} */
let autoBuildPromise = null;

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function envBool(value) {
    const normalized = String(value ?? '')
        .trim()
        .toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

/**
 * @param {unknown} value
 * @param {number} fallback
 * @param {{ min: number; max: number }} range
 * @returns {number}
 */
function envInt(value, fallback, range) {
    const normalized = String(value ?? '').trim();
    if (!normalized) return fallback;
    const parsed = Number(normalized);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(range.max, Math.max(range.min, Math.round(parsed)));
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {McpIndexAutoBuildConfig}
 */
export function readMcpIndexAutoBuildConfig(env = process.env) {
    return {
        enabled: envBool(env['COPILOT_MCP_INDEX_AUTO_BUILD']),
        path:
            String(env['COPILOT_MCP_INDEX_AUTO_BUILD_PATH'] ?? DEFAULT_AUTO_BUILD_PATH).trim() ||
            DEFAULT_AUTO_BUILD_PATH,
        maxFiles: envInt(env['COPILOT_MCP_INDEX_AUTO_BUILD_MAX_FILES'], DEFAULT_AUTO_BUILD_MAX_FILES, {
            min: 1,
            max: 25_000,
        }),
        depth: envInt(env['COPILOT_MCP_INDEX_AUTO_BUILD_DEPTH'], DEFAULT_AUTO_BUILD_DEPTH, { min: 1, max: 50 }),
        concurrency: envInt(env['COPILOT_MCP_INDEX_AUTO_BUILD_CONCURRENCY'], DEFAULT_AUTO_BUILD_CONCURRENCY, {
            min: 1,
            max: 32,
        }),
        respectGitignore: !envBool(env['COPILOT_MCP_INDEX_AUTO_BUILD_IGNORE_GITIGNORE']),
    };
}

/**
 * @param {{
 *     status: McpIndexAutoBuildState['status'];
 *     reason?: string | null;
 *     result?: Record<string, unknown> | null;
 *     error?: Record<string, unknown> | null;
 *     config?: McpIndexAutoBuildConfig;
 * }} input
 * @returns {McpIndexAutoBuildState}
 */
function makeState(input) {
    const previousStartedAt = autoBuildState?.startedAt ?? null;
    return {
        status: input.status,
        startedAt: input.status === 'running' ? new Date().toISOString() : previousStartedAt,
        completedAt:
            input.status === 'completed' || input.status === 'failed' || input.status === 'skipped'
                ? new Date().toISOString()
                : null,
        reason: input.reason ?? null,
        result: input.result ?? null,
        error: input.error ?? null,
        config: input.config ?? readMcpIndexAutoBuildConfig(),
        stats: /** @type {Record<string, unknown>} */ (getIoIndexStats()),
    };
}

/**
 * @returns {McpIndexAutoBuildState}
 */
export function readMcpIndexAutoBuildState() {
    if (autoBuildState) {
        return {
            ...autoBuildState,
            config: { ...autoBuildState.config },
            stats: /** @type {Record<string, unknown>} */ (getIoIndexStats()),
            result: autoBuildState.result ? { ...autoBuildState.result } : null,
            error: autoBuildState.error ? { ...autoBuildState.error } : null,
        };
    }
    const config = readMcpIndexAutoBuildConfig();
    return makeState({
        status: config.enabled ? 'never-started' : 'disabled',
        reason: config.enabled ? 'auto-build-enabled-but-not-started' : 'auto-build-disabled',
        config,
    });
}

/**
 * @param {{ reason?: string }} [options]
 * @returns {Promise<McpIndexAutoBuildState>}
 */
export async function maybeStartMcpIndexAutoBuild(options = {}) {
    const config = readMcpIndexAutoBuildConfig();
    if (!config.enabled) {
        autoBuildState = makeState({ status: 'disabled', reason: 'auto-build-disabled', config });
        return readMcpIndexAutoBuildState();
    }
    if (autoBuildPromise) return await autoBuildPromise;
    if (autoBuildState?.status === 'completed' || autoBuildState?.status === 'running') {
        return readMcpIndexAutoBuildState();
    }

    autoBuildState = makeState({ status: 'running', reason: options.reason ?? 'mcp-http-start', config });
    autoBuildPromise = runIndexAutoBuild(config)
        .then((state) => {
            autoBuildState = state;
            return readMcpIndexAutoBuildState();
        })
        .finally(() => {
            autoBuildPromise = null;
        });
    return await autoBuildPromise;
}

/**
 * @param {{ reason?: string }} [options]
 * @returns {void}
 */
export function startMcpIndexAutoBuildInBackground(options = {}) {
    void maybeStartMcpIndexAutoBuild(options);
}

/**
 * @param {McpIndexAutoBuildConfig} config
 * @returns {Promise<McpIndexAutoBuildState>}
 */
async function runIndexAutoBuild(config) {
    try {
        const resolved = await resolveReadPath(config.path);
        if (!resolved.ok) {
            return makeState({
                status: 'failed',
                reason: 'path-resolution-failed',
                error: { code: resolved.code, message: resolved.reason, hint: resolved.hint },
                config,
            });
        }
        const result = await buildIoIndexForDirectory(resolved.resolved, {
            workspaceRoot: WORKSPACE_ROOT,
            recursive: true,
            depth: config.depth,
            respectGitignore: config.respectGitignore,
            maxFiles: config.maxFiles,
            concurrency: config.concurrency,
        });
        return makeState({
            status: result.available === false ? 'failed' : 'completed',
            reason: result.available === false ? 'index-unavailable' : 'completed',
            result: /** @type {Record<string, unknown>} */ (result),
            config,
        });
    } catch (error) {
        return makeState({
            status: 'failed',
            reason: 'exception',
            error: { message: error instanceof Error ? error.message : String(error) },
            config,
        });
    }
}

/**
 * @returns {void}
 */
export function resetMcpIndexAutoBuildStateForTests() {
    autoBuildState = null;
    autoBuildPromise = null;
}
