// @ts-check
/** Configuration/admission/path policy for the SQLite L2 cache. */
import path from 'node:path';

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 100_000;
const DEFAULT_MIN_BYTES = 0;
const MIN_TOUCH_INTERVAL_MS = 1_000;
const MAX_TOUCH_INTERVAL_MS = 30_000;
const DEFAULT_SET_BATCH_WINDOW_MS = 25;
const DEFAULT_SET_BATCH_MAX_ENTRIES = 256;

/** @param {string} filePath */
export function normalizeL2Path(filePath) {
    return path.resolve(filePath).replace(/\\/g, '/');
}
/** @param {unknown} value @returns {number | null} */
export function normalizeL2TimestampMs(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.round(numeric) : null;
}
/**
 * @param {{ttlMs?:number;maxEntries?:number;minBytes?:number;touchIntervalMs?:number;setBatchWindowMs?:number;setBatchMaxEntries?:number;now?:()=>number}} options
 */
export function resolveIoL2CachePolicy(options) {
    const ttlMs = Number.isFinite(options.ttlMs) && Number(options.ttlMs) > 0 ? Number(options.ttlMs) : DEFAULT_TTL_MS;
    return {
        ttlMs,
        maxEntries:
            Number.isFinite(options.maxEntries) && Number(options.maxEntries) > 0
                ? Number(options.maxEntries)
                : DEFAULT_MAX_ENTRIES,
        minBytes:
            Number.isFinite(options.minBytes) && Number(options.minBytes) >= 0
                ? Number(options.minBytes)
                : DEFAULT_MIN_BYTES,
        touchIntervalMs:
            Number.isFinite(options.touchIntervalMs) && Number(options.touchIntervalMs) >= 0
                ? Number(options.touchIntervalMs)
                : Math.min(MAX_TOUCH_INTERVAL_MS, Math.max(MIN_TOUCH_INTERVAL_MS, Math.floor(ttlMs / 4))),
        setBatchWindowMs:
            Number.isFinite(options.setBatchWindowMs) && Number(options.setBatchWindowMs) >= 0
                ? Number(options.setBatchWindowMs)
                : DEFAULT_SET_BATCH_WINDOW_MS,
        setBatchMaxEntries:
            Number.isInteger(options.setBatchMaxEntries) && Number(options.setBatchMaxEntries) > 0
                ? Number(options.setBatchMaxEntries)
                : DEFAULT_SET_BATCH_MAX_ENTRIES,
        now: typeof options.now === 'function' ? options.now : Date.now,
    };
}
