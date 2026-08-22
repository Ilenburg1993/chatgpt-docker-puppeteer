// @ts-check
/**
 * Node 24 module compile-cache foundation shared by MCP, terminal/LLM-B and child-process launchers.
 *
 * Compile cache is strictly an optimization: enable/flush failures never affect runtime correctness. Ambient process
 * configuration is deliberately kept outside this module: launchers project one explicit environment snapshot through
 * readCopilotNodeCompileCacheConfig() and every later operation uses that immutable value.
 *
 * @module copilot/infra/platform/node/compile-cache
 */

import { readEnvBoolean } from '#copilot/infra/internal/platform';
import { enableCompileCache, flushCompileCache, getCompileCacheDir, constants as moduleConstants } from 'node:module';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_NODE_COMPILE_CACHE_DIR = path.join(os.homedir(), '.cache', 'node-compile-cache');
const COMPILE_CACHE_STATUS = moduleConstants.compileCacheStatus ?? {};

/**
 * @typedef {Readonly<{
 *     disabled: boolean;
 *     directory: string;
 *     portable: boolean;
 * }>} NodeCompileCacheConfig
 *
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
 *
 * @typedef {'adopted-early'|'not-activated'} NodeCompileCacheOwnerAdoption
 * @typedef {{token:object;processId:string;config:NodeCompileCacheConfig;adoption:NodeCompileCacheOwnerAdoption}} NodeCompileCacheOwner
 */

const DEFAULT_NODE_COMPILE_CACHE_CONFIG = Object.freeze({
    disabled: false,
    directory: DEFAULT_NODE_COMPILE_CACHE_DIR,
    portable: true,
});

/** @type {NodeCompileCacheSummary | null} */
let lastEnableSummary = null;
/** @type {NodeCompileCacheFlushSummary | null} */
let lastFlushSummary = null;
/** @type {NodeCompileCacheConfig | null} */
let lastConfig = null;
/** @type {NodeCompileCacheOwner | null} */
let activeOwner = null;

/** @param {NodeCompileCacheConfig} left @param {NodeCompileCacheConfig} right */
function sameCompileCacheConfig(left, right) {
    return left.disabled === right.disabled && left.directory === right.directory && left.portable === right.portable;
}

/**
 * Claim the process-global compile-cache policy for one ProcessInfra generation.
 *
 * The launcher may enable the cache before the heavy composition graph exists. ProcessInfra later adopts that exact
 * configuration. A mismatch is a configuration split-brain and is rejected; absence of an early activation is allowed
 * for standalone/test ProcessInfra instances and does not enable the optimization late.
 *
 * @param {{token:object;processId:string;config:NodeCompileCacheConfig}} options
 * @returns {() => void}
 */
export function activateCopilotNodeCompileCacheProcessOwner(options) {
    if (!options?.token || typeof options.token !== 'object') {
        throw new TypeError('Compile-cache process ownership requires an opaque token.');
    }
    const processId = String(options.processId ?? '').trim();
    if (!processId) throw new TypeError('Compile-cache process ownership requires processId.');
    if (activeOwner && activeOwner.token !== options.token) {
        throw Object.assign(new Error(`Node compile-cache policy is already owned by ${activeOwner.processId}.`), {
            code: 'ERR_NODE_COMPILE_CACHE_OWNER_ACTIVE',
        });
    }
    if (lastConfig && !sameCompileCacheConfig(lastConfig, options.config)) {
        throw Object.assign(
            new Error('Early Node compile-cache configuration does not match ProcessInfraConfig.compileCache.'),
            { code: 'ERR_NODE_COMPILE_CACHE_CONFIG_MISMATCH' },
        );
    }
    const owner = {
        token: options.token,
        processId,
        config: Object.freeze({ ...options.config }),
        adoption: /** @type {NodeCompileCacheOwnerAdoption} */ (lastConfig ? 'adopted-early' : 'not-activated'),
    };
    activeOwner = owner;
    return () => {
        if (activeOwner?.token === options.token) activeOwner = null;
    };
}

/**
 * Project one immutable compile-cache policy from an explicit environment snapshot.
 * @param {NodeJS.ProcessEnv | Record<string,string|undefined>} env
 * @returns {NodeCompileCacheConfig}
 */
export function readCopilotNodeCompileCacheConfig(env) {
    const source = env ?? {};
    const directory = String(
        source['NODE_COMPILE_CACHE'] ?? source['COPILOT_NODE_COMPILE_CACHE_DIR'] ?? DEFAULT_NODE_COMPILE_CACHE_DIR,
    ).trim();
    return Object.freeze({
        disabled: readEnvBoolean('COPILOT_NODE_COMPILE_CACHE_DISABLED', false, source),
        directory: directory || DEFAULT_NODE_COMPILE_CACHE_DIR,
        portable: readEnvBoolean(
            'NODE_COMPILE_CACHE_PORTABLE',
            readEnvBoolean('COPILOT_NODE_COMPILE_CACHE_PORTABLE', true, source),
            source,
        ),
    });
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
 * @param {NodeCompileCacheConfig} config
 * @returns {NodeCompileCacheSummary}
 */
function summarizeCompileCacheResult(result, config) {
    const statusName = readCompileCacheStatusName(result.status);
    const enabledStatuses = new Set(
        [COMPILE_CACHE_STATUS.ENABLED, COMPILE_CACHE_STATUS.ALREADY_ENABLED].filter((value) => value !== undefined),
    );
    return {
        enabled:
            enabledStatuses.has(/** @type {number} */ (result.status)) || statusName.toLowerCase().includes('enabled'),
        attempted: true,
        status: String(result.status),
        statusName,
        directory: result.directory ?? getCompileCacheDir?.() ?? config.directory,
        portable: config.portable,
        nodeVersion: process.version,
        error: result.message ?? null,
    };
}

/**
 * Enable Node's process compile cache using an already-resolved process policy.
 * @param {NodeCompileCacheConfig} [config]
 * @returns {NodeCompileCacheSummary}
 */
export function enableCopilotNodeCompileCache(config = DEFAULT_NODE_COMPILE_CACHE_CONFIG) {
    if (activeOwner && !sameCompileCacheConfig(activeOwner.config, config)) {
        throw Object.assign(
            new Error('Cannot enable Node compile cache with a policy different from the active ProcessInfra owner.'),
            {
                code: 'ERR_NODE_COMPILE_CACHE_CONFIG_MISMATCH',
            },
        );
    }
    lastConfig = Object.freeze({ ...config });
    if (lastConfig.disabled) {
        lastEnableSummary = {
            enabled: false,
            attempted: false,
            status: 'disabled-by-config',
            statusName: 'DISABLED_BY_CONFIG',
            directory: null,
            portable: lastConfig.portable,
            nodeVersion: process.version,
            error: null,
        };
        return lastEnableSummary;
    }
    try {
        const result = enableCompileCache({ directory: lastConfig.directory, portable: lastConfig.portable });
        const summary = summarizeCompileCacheResult(result, lastConfig);
        if (summary.enabled || !lastConfig.portable) {
            lastEnableSummary = summary;
            return summary;
        }

        const fallbackConfig = Object.freeze({ ...lastConfig, portable: false });
        const fallbackResult = enableCompileCache(fallbackConfig.directory);
        const fallbackSummary = summarizeCompileCacheResult(fallbackResult, fallbackConfig);
        lastEnableSummary = fallbackSummary.enabled
            ? {
                  ...fallbackSummary,
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
            directory: lastConfig.directory,
            portable: lastConfig.portable,
            nodeVersion: process.version,
            error: error instanceof Error ? error.message : String(error),
        };
        return lastEnableSummary;
    }
}

/**
 * Flush accumulated compile cache to disk so children spawned before parent exit can reuse it. Failures are
 * intentionally non-fatal, matching Node's compile-cache semantics.
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
 * Propagate one explicit compile-cache policy to a child Node/npm/npx environment without mutating the input.
 * If no config is supplied, it is projected from that same explicit child environment, never from process.env.
 *
 * @param {NodeJS.ProcessEnv} env
 * @param {NodeCompileCacheConfig} [config]
 * @returns {NodeJS.ProcessEnv}
 */
export function withCopilotNodeCompileCacheEnv(env, config = readCopilotNodeCompileCacheConfig(env)) {
    if (config.disabled) return env;
    return {
        ...env,
        NODE_COMPILE_CACHE: env['NODE_COMPILE_CACHE'] ?? config.directory,
        ...(config.portable ? { NODE_COMPILE_CACHE_PORTABLE: env['NODE_COMPILE_CACHE_PORTABLE'] ?? '1' } : {}),
    };
}

export function getCopilotNodeCompileCacheHealth() {
    const config = lastConfig ?? DEFAULT_NODE_COMPILE_CACHE_CONFIG;
    const directory = getCompileCacheDir?.() ?? lastEnableSummary?.directory ?? null;
    return {
        enabled: Boolean(lastEnableSummary?.enabled || directory),
        attempted: lastEnableSummary?.attempted ?? false,
        statusName: lastEnableSummary?.statusName ?? (directory ? 'ENABLED_EXTERNALLY' : 'UNKNOWN'),
        portable: lastEnableSummary?.portable ?? config.portable,
        nodeVersion: process.version,
        directoryKnown: Boolean(directory),
        enableError: lastEnableSummary?.error ?? null,
        config: Object.freeze({ ...config }),
        lastFlush: lastFlushSummary,
        owner: activeOwner
            ? Object.freeze({ active: true, processId: activeOwner.processId, adoption: activeOwner.adoption })
            : Object.freeze({ active: false, processId: null, adoption: null }),
    };
}

export function resetCopilotNodeCompileCacheHealthForTest() {
    lastEnableSummary = null;
    lastFlushSummary = null;
    lastConfig = null;
    activeOwner = null;
}
