// @ts-check
/**
 * @module copilot/server/runtime-state/copilot-api-dialog
 * @file Registry explícito do estado vivo de concorrência do dialog HTTP por runtime.
 *
 *   Gate 2.0-D: este módulo existe para impedir mutex process-wide implícito dentro da rota. A rota continua owner da
 *   política de concorrência; o estado vivo passa a morar em registry nomeado.
 */

/** @type {Map<string, true>} */
const _turnInFlightByRuntime = new Map();

/**
 * @param {string | null | undefined} runtimeId
 * @returns {string}
 */
function normalizeRuntimeKey(runtimeId) {
    return runtimeId || 'default';
}

/**
 * @param {string | null | undefined} runtimeId
 * @returns {boolean}
 */
export function hasDialogTurnInFlight(runtimeId) {
    return _turnInFlightByRuntime.has(normalizeRuntimeKey(runtimeId));
}

/**
 * @param {string | null | undefined} runtimeId
 * @returns {void}
 */
export function markDialogTurnInFlight(runtimeId) {
    _turnInFlightByRuntime.set(normalizeRuntimeKey(runtimeId), true);
}

/**
 * @param {string | null | undefined} runtimeId
 * @returns {void}
 */
export function clearDialogTurnInFlight(runtimeId) {
    _turnInFlightByRuntime.delete(normalizeRuntimeKey(runtimeId));
}

/**
 * @returns {string[]}
 */
export function listDialogTurnRuntimeKeys() {
    return [..._turnInFlightByRuntime.keys()].sort();
}
