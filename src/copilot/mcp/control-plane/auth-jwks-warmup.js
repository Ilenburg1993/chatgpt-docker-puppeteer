// @ts-check
/**
 * Non-blocking remote JWKS warmup for MCP HTTP startup.
 *
 * @module copilot/mcp/control-plane/auth-jwks-warmup
 */

import { logMcp } from './audit.js';
import { warmMcpRemoteJwks } from './auth.js';

const DEFAULT_JWKS_WARMUP_DELAY_MS = 2_000;

/** @type {NodeJS.Timeout | null} */
let warmupTimer = null;
let warmupState = createInitialState();

/**
 * @typedef {Awaited<ReturnType<typeof warmMcpRemoteJwks>>} McpAuthJwksWarmupResult
 * @typedef {(level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR', message: string, fields?: Record<string, unknown>) => void} McpAuthJwksWarmupLogFn
 */

/**
 * @param {{
 *     delayMs?: number;
 *     enabled?: boolean;
 *     env?: NodeJS.ProcessEnv;
 *     setTimeoutFn?: typeof setTimeout;
 *     warmupRunner?: (options?: { env?: NodeJS.ProcessEnv }) => Promise<McpAuthJwksWarmupResult>;
 *     logFn?: McpAuthJwksWarmupLogFn;
 * }} [options]
 * @returns {boolean}
 */
export function scheduleMcpAuthJwksWarmup(options = {}) {
    if (warmupState.scheduled || warmupState.running || warmupState.completed) return false;
    const env = options.env ?? process.env;
    const defaultEnabled = env['NODE_ENV'] !== 'test' && !env['VITEST'];
    const enabled = options.enabled ?? readBooleanEnv(env, 'COPILOT_MCP_JWKS_WARMUP_ENABLED', defaultEnabled);
    if (!enabled) return false;

    const delayMs = normalizeDelay(
        options.delayMs ?? Number(env['COPILOT_MCP_JWKS_WARMUP_DELAY_MS']),
    );
    const setTimeoutFn = options.setTimeoutFn ?? setTimeout;
    const warmupRunner = options.warmupRunner ?? warmMcpRemoteJwks;
    const logFn = options.logFn ?? logMcp;
    warmupState = {
        ...warmupState,
        scheduled: true,
        scheduledAt: new Date().toISOString(),
        delayMs,
    };
    warmupTimer = setTimeoutFn(() => {
        warmupTimer = null;
        void runWarmup(warmupRunner, env, logFn);
    }, delayMs);
    warmupTimer?.unref?.();
    return true;
}

/**
 * @returns {typeof warmupState}
 */
export function readMcpAuthJwksWarmupState() {
    return { ...warmupState };
}

/**
 * @returns {void}
 */
export function resetMcpAuthJwksWarmupForTests() {
    if (warmupTimer) clearTimeout(warmupTimer);
    warmupTimer = null;
    warmupState = createInitialState();
}

/**
 * @param {(options?: { env?: NodeJS.ProcessEnv }) => Promise<McpAuthJwksWarmupResult>} warmupRunner
 * @param {NodeJS.ProcessEnv} env
 * @param {McpAuthJwksWarmupLogFn} logFn
 * @returns {Promise<void>}
 */
async function runWarmup(warmupRunner, env, logFn) {
    warmupState = {
        ...warmupState,
        scheduled: false,
        running: true,
        startedAt: new Date().toISOString(),
    };
    try {
        const result = await warmupRunner({ env });
        warmupState = {
            ...warmupState,
            running: false,
            completed: true,
            completedAt: new Date().toISOString(),
            success: result.ok,
            skipped: result.skipped,
            reason: result.reason,
            jwksUri: result.jwksUri,
            source: result.source,
            keyCount: result.keyCount,
            durationMs: result.durationMs,
            error: null,
        };
        logFn('DEBUG', 'MCP auth JWKS pre-warmed.', {
            success: result.ok,
            skipped: result.skipped,
            reason: result.reason,
            source: result.source,
            keyCount: result.keyCount,
            durationMs: result.durationMs,
        });
    } catch (error) {
        warmupState = {
            ...warmupState,
            running: false,
            completed: true,
            completedAt: new Date().toISOString(),
            success: false,
            error: error instanceof Error ? error.message : String(error),
        };
        logFn('WARN', 'MCP auth JWKS warmup failed without blocking startup.', {
            error: warmupState.error,
        });
    }
}

function createInitialState() {
    return {
        scheduled: false,
        running: false,
        completed: false,
        scheduledAt: /** @type {string | null} */ (null),
        startedAt: /** @type {string | null} */ (null),
        completedAt: /** @type {string | null} */ (null),
        success: /** @type {boolean | null} */ (null),
        skipped: false,
        reason: /** @type {string | null} */ (null),
        jwksUri: /** @type {string | null} */ (null),
        source: /** @type {'disabled' | 'cache' | 'remote' | null} */ (null),
        keyCount: /** @type {number | null} */ (null),
        durationMs: /** @type {number | null} */ (null),
        delayMs: /** @type {number | null} */ (null),
        error: /** @type {string | null} */ (null),
    };
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function normalizeDelay(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) return DEFAULT_JWKS_WARMUP_DELAY_MS;
    return Math.min(60_000, Math.round(numeric));
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @param {string} name
 * @param {boolean} fallback
 * @returns {boolean}
 */
function readBooleanEnv(env, name, fallback) {
    const value = String(env[name] ?? '')
        .trim()
        .toLowerCase();
    if (!value) return fallback;
    return ['1', 'true', 'yes', 'on'].includes(value);
}
