// @ts-check
/**
 * @module copilot/server/runtime-state/copilot-api-stream
 * @file Registry explícito do estado SSE runtime-aware de `/copilot-api/stream*`.
 */

/** @type {Map<string, unknown>} */
const _copilotApiStreamStates = new Map();

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
export function getCopilotApiStreamState(runtimeId) {
    return /** @type {T | undefined} */ (_copilotApiStreamStates.get(normalizeRuntimeKey(runtimeId)));
}

/**
 * @param {string | null | undefined} runtimeId
 * @param {unknown} state
 * @returns {void}
 */
export function setCopilotApiStreamState(runtimeId, state) {
    _copilotApiStreamStates.set(normalizeRuntimeKey(runtimeId), state);
}

/**
 * @param {string | null | undefined} runtimeId
 * @returns {boolean}
 */
export function deleteCopilotApiStreamState(runtimeId) {
    return _copilotApiStreamStates.delete(normalizeRuntimeKey(runtimeId));
}

/**
 * @returns {string[]}
 */
export function listCopilotApiStreamRuntimeKeys() {
    return [..._copilotApiStreamStates.keys()].sort();
}
