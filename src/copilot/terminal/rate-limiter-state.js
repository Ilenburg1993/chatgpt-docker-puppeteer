// @ts-check
/**
 * src/copilot/terminal/rate-limiter-state.js
 *
 * Módulo neutro de bridge para reset de rate limiters — evita dependência circular entre `server.js` (que cria os rate
 * limiters) e `handlers-system.js` (que precisa resetá-los).
 *
 * Padrão: `server.js` registra a função de limpeza via `registerClearRateLimiters()`; `handlers-system.js` chama
 * `clearRateLimiters()` sem conhecer `server.js`.
 *
 * @module copilot/terminal/rate-limiter-state
 * @see EventBus
 */

/** @type {() => void} */
let _clearFn = () => {};

/**
 * Registra a função de limpeza dos rate limiters. Chamado por `server.js` na inicialização.
 *
 * @param {() => void} fn
 * @returns {void}
 */
export function registerClearRateLimiters(fn) {
    _clearFn = fn;
}

/**
 * Limpa todos os rate limiters registrados. Exposto para `handlers-system.js`.
 *
 * @returns {void}
 */
export function clearRateLimiters() {
    _clearFn();
}
