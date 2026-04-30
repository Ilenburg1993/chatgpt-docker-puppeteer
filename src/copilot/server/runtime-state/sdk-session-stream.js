// @ts-check
/**
 * @module copilot/server/runtime-state/sdk-session-stream
 * @file Registry explícito do estado SSE runtime-aware de `/api/sdk/sessions/:id/stream`.
 */

/** @type {Map<string, unknown>} */
const _sdkSessionStreamStates = new Map();

/**
 * @param {string | null | undefined} runtimeId
 * @param {string} sessionId
 * @returns {string}
 */
export function buildSdkSessionStreamKey(runtimeId, sessionId) {
    return `${runtimeId || 'default'}:${sessionId}`;
}

/**
 * @template T
 * @param {string} key
 * @returns {T | undefined}
 */
export function getSdkSessionStreamState(key) {
    return /** @type {T | undefined} */ (_sdkSessionStreamStates.get(key));
}

/**
 * @param {string} key
 * @param {unknown} state
 * @returns {void}
 */
export function setSdkSessionStreamState(key, state) {
    _sdkSessionStreamStates.set(key, state);
}

/**
 * @param {string} key
 * @returns {boolean}
 */
export function deleteSdkSessionStreamState(key) {
    return _sdkSessionStreamStates.delete(key);
}

/**
 * @returns {string[]}
 */
export function listSdkSessionStreamKeys() {
    return [..._sdkSessionStreamStates.keys()].sort();
}
