// @ts-check
/**
 * @module copilot/server/runtime-state/sdk-hooks-stream
 * @file Registry explícito do estado SSE runtime-aware de `/api/sdk/hooks/events`.
 */

/** @type {Map<string, unknown>} */
const _sdkHooksRuntimeStates = new Map();

/**
 * @param {string | null | undefined} runtimeId
 * @returns {string}
 */
function normalizeRuntimeKey(runtimeId) {
    return runtimeId || 'default';
}

/**
 * @template T
 * @param {string | null | undefined} runtimeId
 * @returns {T | undefined}
 */
export function getSdkHooksRuntimeState(runtimeId) {
    return /** @type {T | undefined} */ (_sdkHooksRuntimeStates.get(normalizeRuntimeKey(runtimeId)));
}

/**
 * @param {string | null | undefined} runtimeId
 * @param {unknown} state
 * @returns {void}
 */
export function setSdkHooksRuntimeState(runtimeId, state) {
    _sdkHooksRuntimeStates.set(normalizeRuntimeKey(runtimeId), state);
}

/**
 * @param {string | null | undefined} runtimeId
 * @returns {boolean}
 */
export function deleteSdkHooksRuntimeState(runtimeId) {
    return _sdkHooksRuntimeStates.delete(normalizeRuntimeKey(runtimeId));
}

/**
 * @returns {string[]}
 */
export function listSdkHooksRuntimeKeys() {
    return [..._sdkHooksRuntimeStates.keys()].sort();
}
