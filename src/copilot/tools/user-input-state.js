// @ts-check
/**
 * Estado mínimo e canônico de `request_user_input`.
 *
 * Mantido fora de `hook-tools.js` para que a borda terminal consiga consultar/resolver pendências sem inicializar o
 * registry completo de tools. Isso reduz ciclos de boot e evita que uma resposta humana seja tratada como turno novo
 * enquanto uma Promise da tool está suspensa.
 *
 * @module copilot/tools/user-input-state
 */

/**
 * @type {Map<string, (answer: string) => void>}
 */
const _pendingInputResolvers = new Map();

/** @type {number} */
let _pendingInputSeq = 0;

/**
 * @returns {string}
 */
export function nextUserInputRequestId() {
    _pendingInputSeq += 1;
    return `input_${_pendingInputSeq}`;
}

/**
 * @param {string} requestId
 * @param {(answer: string) => void} resolver
 * @returns {void}
 */
export function registerPendingUserInputResolver(requestId, resolver) {
    _pendingInputResolvers.set(requestId, resolver);
}

/**
 * @param {string} requestId
 * @returns {boolean}
 */
export function deletePendingUserInputResolver(requestId) {
    return _pendingInputResolvers.delete(requestId);
}

/**
 * Resolve a Promise mais antiga por padrão, ou uma Promise específica quando `requestId` é informado.
 *
 * @param {string} answer
 * @param {string} [requestId]
 * @returns {boolean}
 */
export function resolvePendingUserInput(answer, requestId) {
    if (_pendingInputResolvers.size === 0) return false;
    const id = requestId ?? _pendingInputResolvers.keys().next().value;
    if (!id) return false;
    const fn = _pendingInputResolvers.get(id);
    if (!fn) return false;
    _pendingInputResolvers.delete(id);
    fn(answer);
    return true;
}

/**
 * @returns {string[]}
 */
export function getPendingUserInputIds() {
    return [..._pendingInputResolvers.keys()];
}

/**
 * @returns {number}
 */
export function getPendingUserInputCount() {
    return _pendingInputResolvers.size;
}

/**
 * @returns {boolean}
 */
export function hasPendingUserInputRequests() {
    return _pendingInputResolvers.size > 0;
}
