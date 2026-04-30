// @ts-check
/**
 * @module copilot/server/runtime-state/sdk-session-rate-limit
 * @file Registry explícito do estado de janela de rate limiting das rotas de sessão SDK.
 */

/** @type {Map<string, { count: number; bucketStart: number }>} */
const _sdkSessionRateLimitWindows = new Map();

/**
 * @returns {IterableIterator<[string, { count: number; bucketStart: number }]>}
 */
export function iterateSdkSessionRateLimitWindows() {
    return _sdkSessionRateLimitWindows.entries();
}

/**
 * @param {string} key
 * @returns {{ count: number; bucketStart: number } | undefined}
 */
export function getSdkSessionRateLimitWindow(key) {
    return _sdkSessionRateLimitWindows.get(key);
}

/**
 * @param {string} key
 * @param {{ count: number; bucketStart: number }} value
 * @returns {void}
 */
export function setSdkSessionRateLimitWindow(key, value) {
    _sdkSessionRateLimitWindows.set(key, value);
}

/**
 * @param {string} key
 * @returns {boolean}
 */
export function deleteSdkSessionRateLimitWindow(key) {
    return _sdkSessionRateLimitWindows.delete(key);
}

/**
 * @returns {number}
 */
export function countSdkSessionRateLimitWindows() {
    return _sdkSessionRateLimitWindows.size;
}
