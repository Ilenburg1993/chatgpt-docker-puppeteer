// @ts-check
/**
 * Pure coercion helpers for bounded runtime configuration values.
 *
 * This module does not read process.env; environment lookup belongs to `env.js`. Keeping coercion separate lets option
 * objects, persisted settings and env-backed configuration share identical semantics without duplicating parsers.
 *
 * @module copilot/infra/platform/config-values
 */

/**
 * @param {unknown} value
 * @param {boolean} fallback
 * @returns {boolean}
 */
export function booleanValueOr(value, fallback) {
    const normalized = String(value ?? '')
        .trim()
        .toLowerCase();
    if (!normalized) return fallback;
    if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') return true;
    if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') return false;
    return fallback;
}

/**
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
export function positiveIntegerOr(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}

/**
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
export function nonNegativeIntegerOr(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : fallback;
}

/**
 * @param {unknown} value
 * @param {number} fallback
 * @param {number} minimum
 * @param {number} maximum
 * @returns {number}
 */
export function boundedIntegerOr(value, fallback, minimum, maximum) {
    const parsed = Number(value ?? fallback);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(maximum, Math.max(minimum, Math.floor(parsed)));
}
