// @ts-check
/**
 * @module copilot/presentation/realtime
 * @file Superfície compartilhada de contratos de realtime consumidos por server e terminal.
 *
 *   Este módulo centraliza SSOT de borda para streaming SSE crítico e para o bridge de reset dos rate limiters. O
 *   objetivo é reduzir imports `server → terminal` sem alterar as costuras do runtime principal (`agent`,
 *   `conversation-hub`, `channel` e SDK).
 */

/** Eventos considerados críticos para streams e clientes em modo `critical`. */
export const CRITICAL_EVENTS = new Set(['dialog.stalled', 'fatal', 'system']);

/** @type {() => void} */
let _clearFn = () => {};

/**
 * Registra a função de limpeza dos rate limiters.
 *
 * @param {() => void} fn
 * @returns {void}
 */
export function registerClearRateLimiters(fn) {
    _clearFn = fn;
}

/**
 * Limpa todos os rate limiters registrados.
 *
 * @returns {void}
 */
export function clearRateLimiters() {
    _clearFn();
}

/**
 * Reseta o estado do rate limiter para isolamento de testes.
 *
 * @returns {void}
 */
export function resetRateLimiterStateForTests() {
    _clearFn = () => {};
}
