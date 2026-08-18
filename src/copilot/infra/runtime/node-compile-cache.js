// @ts-check
/**
 * Node 24 module compile-cache foundation shared by MCP, terminal/LLM-B and child-process launchers.
 *
 * Compile cache is strictly an optimization: enable/flush failures never affect runtime correctness.
 *
 * @module copilot/infra/runtime/node-compile-cache
 */

import {
    constants as moduleConstants,
    enableCompileCache,
    flushCompileCache,
    getCompileCacheDir,
} from 'node:module';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_NODE_COMPILE_CACHE_DIR = path.join(os.homedir(), '.cache', 'node-compile-cache');
const COMPILE_CACHE_STATUS = moduleConstants.compileCacheStatus ?? {};

/**
 * @typedef {{
 *     enabled: boolean;
 *     attempted: boolean;
 *     status: string;
 *     statusName: string;
 *     directory: string | null;
 *     portable: boolean;
 *     nodeVersion: string;
 *     error: string | null;
 * }} NodeCompileCacheSummary
 *
 * @typedef {{
 *     attempted: boolean;
 *     flushed: boolean;
 *     durationMs: number;
 *     error: string | null;
 * }} NodeCompileCacheFlushSummary
 */

/** @type {NodeCompileCacheSummary | null} */
let lastEnableSummary = null;
/** @type {NodeCompileCacheFlushSummary | null} */
let lastFlushSummary = null;

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @param {string} [name]
 * @param {boolean} [fallback]
 */
function readBooleanEnv(env = process.env, name = '', fallback = false) {
    const raw = String(env[name] ?? '').trim().toLowerCase();
    if (!raw) return fallback;
    if (raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on') return true;
    if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'off') return false;
    return fallback;
}

/** @param {NodeJS.ProcessEnv} [env] */
function readCompileCacheDirectory(env = process.env) {
    return String(env['NODE_COMPILE_CACHE'] ?? env['COPILOT_NODE_COMPILE_CACHE_DIR'] ?? DEFAULT_NODE_COMPILE_CACHE_DIR).trim();
}

/** @param {NodeJS.ProcessEnv} [env] */
function readCompileCachePortable(env = process.env) {
    return readBooleanEnv(
        env,
        'NODE_COMPILE_CACHE_PORTABLE',
        readBooleanEnv(env, 'COPILOT_NODE_COMPILE_CACHE_PORTABLE', true),
    );
}

/** @param {unknown} status */
function readCompileCacheStatusName(status) {
    for (const [name, value] of Object.entries(COMPILE_CACHE_STATUS)) {
        if (value === status) return name;
    }
    return String(status);
}

/**
 * @param {{ status: unknown; message?: string; directory?: string }} result
 * @param {string} directory
 * @param {boolean} portable
 * @param {NodeJS.ProcessEnv} env
 * @returns {NodeCompileCacheSummary}
 */
function summarizeCompileCacheResult(result, directory, portable, env) {
    if (!env['NODE_COMPILE_CACHE'] && result.directory) env['NODE_COMPILE_CACHE'] = result.directory;
    if (portable && !env['NODE_COMPILE_CACHE_PORTABLE']) env['NODE_COMPILE_CACHE_PORTABLE'] = '1';
    const statusName = readCompileCacheStatusName(result.status);
    const enabledStatuses = new Set(
        [COMPILE_CACHE_STATUS.ENABLED, COMPILE_CACHE_STATUS.ALREADY_ENABLED].filter((value) => value !== undefined),
    );
    return {
        enabled: enabledStatuses.has(/** @type {number} */ (result.status)) || statusName.toLowerCase().includes('enabled'),
        attempted: true,
        status: String(result.status),
        statusName,
        directory: result.directory ?? getCompileCacheDir?.() ?? directory,
        portable,
        nodeVersion: process.version,
        error: result.message ?? null,
    };
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {NodeCompileCacheSummary}
 */
export function enableCopilotNodeCompileCache(env = process.env) {
    if (readBooleanEnv(env, 'COPILOT_NODE_COMPILE_CACHE_DISABLED', false)) {
        lastEnableSummary = {
            enabled: false,
            attempted: false,
            status: 'disabled-by-env',
            statusName: 'DISABLED_BY_ENV',
            directory: null,
            portable: readCompileCachePortable(env),
            nodeVersion: process.version,
            error: null,
        };
        return lastEnableSummary;
    }
    const directory = readCompileCacheDirectory(env);
    const portable = readCompileCachePortable(env);
    try {
        const result = enableCompileCache({ directory, portable });
        const summary = summarizeCompileCacheResult(result, directory, portable, env);
        if (summary.enabled || !portable) {
            lastEnableSummary = summary;
            return summary;
        }

        const fallbackResult = enableCompileCache(directory);
        const fallbackSummary = summarizeCompileCacheResult(fallbackResult, directory, false, env);
        lastEnableSummary = fallbackSummary.enabled
            ? {
                  ...fallbackSummary,
                  portable: false,
                  error: summary.error ? `portable-attempt-failed: ${summary.error}` : 'portable-attempt-failed',
              }
            : summary;
        return lastEnableSummary;
    } catch (error) {
        lastEnableSummary = {
            enabled: false,
            attempted: true,
            status: 'failed',
            statusName: 'FAILED_EXCEPTION',
            directory,
            portable,
            nodeVersion: process.version,
            error: error instanceof Error ? error.message : String(error),
        };
        return lastEnableSummary;
    }
}

/**
 * Flush accumulated compile cache to disk so children spawned before parent exit can reuse it.
 * Failures are intentionally non-fatal, matching Node's compile-cache semantics.
 *
 * @returns {NodeCompileCacheFlushSummary}
 */
export function flushCopilotNodeCompileCache() {
    const startedAt = performance.now();
    try {
        flushCompileCache();
        lastFlushSummary = {
            attempted: true,
            flushed: true,
            durationMs: Math.max(0, performance.now() - startedAt),
            error: null,
        };
    } catch (error) {
        lastFlushSummary = {
            attempted: true,
            flushed: false,
            durationMs: Math.max(0, performance.now() - startedAt),
            error: error instanceof Error ? error.message : String(error),
        };
    }
    return lastFlushSummary;
}

/**
 * Propagate compile-cache env to child Node/npm/npx processes.
 *
 * @param {NodeJS.ProcessEnv} env
 * @returns {NodeJS.ProcessEnv}
 */
export function withCopilotNodeCompileCacheEnv(env) {
    if (readBooleanEnv(env, 'COPILOT_NODE_COMPILE_CACHE_DISABLED', false)) return env;
    const directory = readCompileCacheDirectory(env);
    const portable = readCompileCachePortable(env);
    return {
        ...env,
        NODE_COMPILE_CACHE: env['NODE_COMPILE_CACHE'] ?? directory,
        ...(portable ? { NODE_COMPILE_CACHE_PORTABLE: env['NODE_COMPILE_CACHE_PORTABLE'] ?? '1' } : {}),
    };
}

export function getCopilotNodeCompileCacheHealth() {
    const directory = getCompileCacheDir?.() ?? lastEnableSummary?.directory ?? null;
    return {
        enabled: Boolean(lastEnableSummary?.enabled || directory),
        attempted: lastEnableSummary?.attempted ?? false,
        statusName: lastEnableSummary?.statusName ?? (directory ? 'ENABLED_BY_ENV' : 'UNKNOWN'),
        portable: lastEnableSummary?.portable ?? readCompileCachePortable(process.env),
        nodeVersion: process.version,
        directoryKnown: Boolean(directory),
        enableError: lastEnableSummary?.error ?? null,
        lastFlush: lastFlushSummary,
    };
}

export function resetCopilotNodeCompileCacheHealthForTest() {
    lastEnableSummary = null;
    lastFlushSummary = null;
}
