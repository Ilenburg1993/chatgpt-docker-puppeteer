// @ts-check
/**
 * @module copilot/server/runtime-state/sdk-agent-stream
 * @file Registry explícito do estado SSE runtime-aware de `/api/sdk/agent/stream`.
 */

/** @type {Map<string, unknown>} */
const _sdkAgentStreamStates = new Map();

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
export function getSdkAgentStreamState(runtimeId) {
    return /** @type {T | undefined} */ (_sdkAgentStreamStates.get(normalizeRuntimeKey(runtimeId)));
}

/**
 * @param {string | null | undefined} runtimeId
 * @param {unknown} state
 * @returns {void}
 */
export function setSdkAgentStreamState(runtimeId, state) {
    _sdkAgentStreamStates.set(normalizeRuntimeKey(runtimeId), state);
}

/**
 * @param {string | null | undefined} runtimeId
 * @returns {boolean}
 */
export function deleteSdkAgentStreamState(runtimeId) {
    return _sdkAgentStreamStates.delete(normalizeRuntimeKey(runtimeId));
}

/**
 * @returns {string[]}
 */
export function listSdkAgentStreamRuntimeKeys() {
    return [..._sdkAgentStreamStates.keys()].sort();
}
