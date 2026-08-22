// @ts-check
/** Bounded configuration policy for the best-effort external filesystem watcher. */
import { readEnvNonNegativeInt, readEnvPositiveInt } from '#copilot/infra/internal/platform';

const DEFAULT_DEBOUNCE_MS = 125;
const DEFAULT_MAX_BATCH = 256;
const DEFAULT_MAX_PENDING = 4096;
export const HARD_MAX_BATCH = 1024;
export const HARD_MAX_PENDING = 20_000;

/** @param {NodeJS.ProcessEnv | Record<string,string|undefined>} [env] */
export function readIoExternalWatchConfig(env = {}) {
    const testRuntime = env['VITEST'] === 'true' || env['NODE_ENV'] === 'test' || env['NODE_ENV'] === 'testing';
    const enabledRaw = String(env['IO_EXTERNAL_WATCH_ENABLED'] ?? (testRuntime ? '0' : '1'))
        .trim()
        .toLowerCase();
    return Object.freeze({
        enabled: !['0', 'false', 'off', 'no'].includes(enabledRaw),
        debounceMs: Math.min(2_000, readEnvNonNegativeInt('IO_EXTERNAL_WATCH_DEBOUNCE_MS', DEFAULT_DEBOUNCE_MS, env)),
        maxBatch: Math.min(HARD_MAX_BATCH, readEnvPositiveInt('IO_EXTERNAL_WATCH_MAX_BATCH', DEFAULT_MAX_BATCH, env)),
        maxPending: Math.min(
            HARD_MAX_PENDING,
            readEnvPositiveInt('IO_EXTERNAL_WATCH_MAX_PENDING', DEFAULT_MAX_PENDING, env),
        ),
    });
}

/** @param {unknown} value @param {number} fallback @param {number} maximum */
function clampPositive(value, fallback, maximum) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? Math.min(maximum, Math.floor(numeric)) : fallback;
}

/** @param {unknown} value @param {number} fallback @param {number} maximum */
function clampNonNegative(value, fallback, maximum) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= 0 ? Math.min(maximum, Math.floor(numeric)) : fallback;
}

/**
 * @param {{ enabled?: boolean; debounceMs?: number; maxBatch?: number; maxPending?: number }} options
 * @param {ReturnType<typeof readIoExternalWatchConfig>} [base]
 */
export function resolveIoExternalWatchRuntimeConfig(options = {}, base = readIoExternalWatchConfig({})) {
    return Object.freeze({
        enabled: options.enabled ?? base.enabled,
        debounceMs: clampNonNegative(options.debounceMs, base.debounceMs, 2_000),
        maxBatch: clampPositive(options.maxBatch, base.maxBatch, HARD_MAX_BATCH),
        maxPending: clampPositive(options.maxPending, base.maxPending, HARD_MAX_PENDING),
    });
}
