// @ts-check
/**
 * src/copilot/core/timer-registry.js
 *
 * Registro centralizado de timers (setTimeout/setInterval) com cleanup
 * automático via shutdown handler. Evita memory leaks de timers órfãos.
 *
 * @module copilot/core/timer-registry
 */

import { registerShutdownHandler } from './shutdown.js';

/**
 * @typedef {'timeout'|'interval'} TimerType
 */

/**
 * @typedef {object} TimerEntry
 * @property {string} id - Identificador do timer
 * @property {TimerType} type - Tipo: timeout ou interval
 * @property {ReturnType<typeof setTimeout>} handle - Handle nativo do timer
 */

/** @type {Map<string, TimerEntry>} */
const timers = new Map();

/** @type {boolean} */
let shutdownRegistered = false;

/**
 * Registra um timer no registry. Se já existir um timer com o mesmo `id`,
 * o anterior é cancelado automaticamente antes do novo ser registrado.
 *
 * @param {string} id - Identificador único do timer
 * @param {TimerType} type - 'timeout' ou 'interval'
 * @param {ReturnType<typeof setTimeout>} handle - Handle retornado por setTimeout/setInterval
 * @returns {ReturnType<typeof setTimeout>} O mesmo handle passado (para conveniência)
 */
export function registerTimer(id, type, handle) {
    ensureShutdownRegistered();
    cancel(id);
    timers.set(id, { id, type, handle });
    return handle;
}

/**
 * Cancela e remove um timer específico pelo ID.
 *
 * @param {string} id - Identificador do timer a cancelar
 * @returns {boolean} true se o timer existia e foi cancelado
 */
export function cancel(id) {
    const entry = timers.get(id);
    if (!entry) return false;
    if (entry.type === 'interval') {
        clearInterval(entry.handle);
    } else {
        clearTimeout(entry.handle);
    }
    timers.delete(id);
    return true;
}

/**
 * Cancela e remove todos os timers registrados.
 *
 * @returns {number} Quantidade de timers cancelados
 */
export function cancelAll() {
    const count = timers.size;
    for (const entry of timers.values()) {
        if (entry.type === 'interval') {
            clearInterval(entry.handle);
        } else {
            clearTimeout(entry.handle);
        }
    }
    timers.clear();
    return count;
}

/**
 * Retorna a quantidade de timers ativos.
 *
 * @returns {number}
 */
export function activeCount() {
    return timers.size;
}

/**
 * Remove todos os timers e reseta estado interno (apenas para testes).
 */
export function _resetForTesting() {
    cancelAll();
    shutdownRegistered = false;
}

/**
 * Garante que o shutdown handler é registrado apenas uma vez.
 */
function ensureShutdownRegistered() {
    if (shutdownRegistered) return;
    shutdownRegistered = true;
    registerShutdownHandler('timers.cancelAll', async () => { cancelAll(); }, 5);
}
