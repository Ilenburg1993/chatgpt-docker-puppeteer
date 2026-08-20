// @ts-check
/**
 * Policies de budgets para operações de I/O com potencial de crescer em tempo, memória ou saída.
 *
 * @module copilot/infra/policy/budgets
 */

import { readEnvPositiveInt } from '../shared/env.js';

export const DEFAULT_IO_SEARCH_TIMEOUT_MS = 15_000;
export const DEFAULT_IO_SEARCH_MAX_BUFFER_BYTES = 16 * 1024 * 1024;
export const DEFAULT_PROCESS_TIMEOUT_MS = 60_000;
export const DEFAULT_PROCESS_MAX_BUFFER_BYTES = 10 * 1024 * 1024;
export const MIN_TIMEOUT_MS = 100;
export const MIN_BUFFER_BYTES = 1024;

/**
 * @param {number | undefined} value
 * @param {number} fallback
 * @param {{ min?: number; max?: number }} [limits]
 * @returns {number}
 */
export function normalizePositiveIntegerBudget(value, fallback, limits = {}) {
    const parsed = Number(value);
    const base = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
    const min = limits.min ?? 1;
    const withMin = Math.max(min, base);
    return Number.isFinite(limits.max) ? Math.min(Number(limits.max), withMin) : withMin;
}

/**
 * @param {string} key
 * @param {number} fallback
 * @param {{ min?: number; max?: number }} [limits]
 * @returns {number}
 */
export function readEnvPositiveIntegerBudget(key, fallback, limits = {}) {
    return normalizePositiveIntegerBudget(readEnvPositiveInt(key, fallback), fallback, limits);
}

/**
 * @param {{ timeoutMs?: number; maxBufferBytes?: number }} [overrides]
 * @returns {{ timeoutMs: number; maxBufferBytes: number }}
 */
export function resolveIoSearchBudget(overrides = {}) {
    return {
        timeoutMs: normalizePositiveIntegerBudget(
            overrides.timeoutMs ?? readEnvPositiveInt('IO_SEARCH_TIMEOUT_MS', DEFAULT_IO_SEARCH_TIMEOUT_MS),
            DEFAULT_IO_SEARCH_TIMEOUT_MS,
            { min: MIN_TIMEOUT_MS },
        ),
        maxBufferBytes: normalizePositiveIntegerBudget(
            overrides.maxBufferBytes ??
                readEnvPositiveInt('IO_SEARCH_MAX_BUFFER_BYTES', DEFAULT_IO_SEARCH_MAX_BUFFER_BYTES),
            DEFAULT_IO_SEARCH_MAX_BUFFER_BYTES,
            { min: MIN_BUFFER_BYTES },
        ),
    };
}

/**
 * @param {{
 *     timeoutMs?: number | null;
 *     maxBufferBytes?: number;
 *     defaultTimeoutMs?: number;
 *     defaultMaxBufferBytes?: number;
 * }} [options]
 * @returns {{ timeoutMs: number | null; maxBufferBytes: number }}
 */
export function resolveProcessExecutionBudget(options = {}) {
    const defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_PROCESS_TIMEOUT_MS;
    const defaultMaxBufferBytes = options.defaultMaxBufferBytes ?? DEFAULT_PROCESS_MAX_BUFFER_BYTES;
    return {
        timeoutMs:
            options.timeoutMs === null
                ? null
                : normalizePositiveIntegerBudget(options.timeoutMs ?? defaultTimeoutMs, defaultTimeoutMs, {
                      min: MIN_TIMEOUT_MS,
                  }),
        maxBufferBytes: normalizePositiveIntegerBudget(
            options.maxBufferBytes ?? defaultMaxBufferBytes,
            defaultMaxBufferBytes,
            {
                min: MIN_BUFFER_BYTES,
            },
        ),
    };
}
