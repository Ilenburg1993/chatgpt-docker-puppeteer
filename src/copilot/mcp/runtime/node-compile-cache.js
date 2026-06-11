// @ts-check
/**
 * Node 24 compile-cache bootstrap helpers for MCP startup and validator jobs.
 *
 * Node compile cache is a startup/job optimization. It does not change tool semantics.
 *
 * @module copilot/mcp/runtime/node-compile-cache
 */

import { constants as moduleConstants, enableCompileCache, getCompileCacheDir } from 'node:module';
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
 */

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean}
 */
function readBooleanEnv(env = process.env, name = '', fallback = false) {
    const raw = String(env[name] ?? '').trim().toLowerCase();
    if (!raw) return fallback;
    if (raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on') return true;
    if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'off') return false;
    return fallback;
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
function readCompileCacheDirectory(env = process.env) {
    return String(env['NODE_COMPILE_CACHE'] ?? env['COPILOT_NODE_COMPILE_CACHE_DIR'] ?? DEFAULT_NODE_COMPILE_CACHE_DIR).trim();
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean}
 */
function readCompileCachePortable(env = process.env) {
    return readBooleanEnv(env, 'NODE_COMPILE_CACHE_PORTABLE', readBooleanEnv(env, 'COPILOT_NODE_COMPILE_CACHE_PORTABLE', true));
}

/**
 * @param {unknown} status
 * @returns {string}
 */
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
        return {
            enabled: false,
            attempted: false,
            status: 'disabled-by-env',
            statusName: 'DISABLED_BY_ENV',
            directory: null,
            portable: readCompileCachePortable(env),
            nodeVersion: process.version,
            error: null,
        };
    }
    const directory = readCompileCacheDirectory(env);
    const portable = readCompileCachePortable(env);
    try {
        const result = enableCompileCache({ directory, portable });
        const summary = summarizeCompileCacheResult(result, directory, portable, env);
        if (summary.enabled || !portable) return summary;

        const fallbackResult = enableCompileCache(directory);
        const fallbackSummary = summarizeCompileCacheResult(fallbackResult, directory, false, env);
        if (fallbackSummary.enabled) {
            return {
                ...fallbackSummary,
                portable: false,
                error: summary.error ? `portable-attempt-failed: ${summary.error}` : 'portable-attempt-failed',
            };
        }
        return summary;
    } catch (error) {
        return {
            enabled: false,
            attempted: true,
            status: 'failed',
            statusName: 'FAILED_EXCEPTION',
            directory,
            portable,
            nodeVersion: process.version,
            error: error instanceof Error ? error.message : String(error),
        };
    }
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
