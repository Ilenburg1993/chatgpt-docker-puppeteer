// @ts-check
/**
 * Pure projection of runtime-owned infrastructure configuration.
 *
 * This module owns no lifecycle and never reads process.env itself. The composition root supplies one environment
 * snapshot when an InfraRuntime is created; nested capability resolvers return frozen values.
 *
 * @module copilot/infra/composition/runtime/config
 */

import { readIoAdvisoryBudgetConfig } from '#copilot/infra/internal/telemetry';
import { getIoL2CacheConfiguration } from '../../cache/l2/index.js';
import { readIoL1CacheConfig } from '../../cache/memory/runtime/index.js';
import { readCrossProcessInvalidationConfig } from '../../filesystem/invalidation/cross-process/index.js';
import { readIoExternalWatchConfig } from '../../filesystem/invalidation/external-watch/index.js';
import { readIoReadRuntimeConfig } from '../../filesystem/read/runtime/index.js';
import { readIoCapacityPreflightConfig, readIoRollbackPolicy } from '../../filesystem/transaction/index.js';
import { readParserCacheRuntimeConfig } from '../../indexing/parser/cache/runtime/index.js';
import { readIoIndexRuntimeConfig } from '../../indexing/registry/instance/index.js';

/** @param {NodeJS.ProcessEnv | Record<string,string|undefined>} env */
function readInvalidationDebounceMs(env) {
    const isTestRuntime = env['VITEST'] === 'true' || env['NODE_ENV'] === 'test' || env['NODE_ENV'] === 'testing';
    const configured = Number(env['IO_INVALIDATION_DEBOUNCE_MS'] ?? (isTestRuntime ? 0 : 50));
    return Number.isFinite(configured) ? Math.max(0, Math.floor(configured)) : isTestRuntime ? 0 : 50;
}

/** @param {unknown} value */
function normalizeConfiguredPath(value) {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
}

/**
 * Project one immutable runtime configuration from an explicit environment snapshot.
 * @param {NodeJS.ProcessEnv | Record<string,string|undefined>} env
 * @param {{mutationAuditLogPath?:string|null}} [overrides]
 */
export function readInfraConfig(env, overrides = {}) {
    const mutationAuditLogPath =
        overrides.mutationAuditLogPath === undefined
            ? normalizeConfiguredPath(env['COPILOT_IO_MUTATION_AUDIT_LOG_PATH'])
            : normalizeConfiguredPath(overrides.mutationAuditLogPath);

    return Object.freeze({
        l1: readIoL1CacheConfig(env),
        l2: getIoL2CacheConfiguration(env),
        invalidation: Object.freeze({
            debounceMs: readInvalidationDebounceMs(env),
            crossProcess: readCrossProcessInvalidationConfig(env),
        }),
        read: readIoReadRuntimeConfig(env),
        parserCache: readParserCacheRuntimeConfig(env),
        externalWatch: readIoExternalWatchConfig(env),
        index: readIoIndexRuntimeConfig(env),
        telemetry: Object.freeze({ advisoryBudget: readIoAdvisoryBudgetConfig(env) }),
        mutationAudit: Object.freeze({ filePath: mutationAuditLogPath }),
        rollback: readIoRollbackPolicy(env),
        capacityPreflight: readIoCapacityPreflightConfig(env),
        debugIoL2: env['DEBUG_IO_L2'] === '1',
    });
}
