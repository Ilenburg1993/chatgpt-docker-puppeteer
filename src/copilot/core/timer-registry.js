// @ts-check
/**
 * src/copilot/core/timer-registry.js
 *
 * Registro centralizado de timers (setTimeout/setInterval) com cleanup automático via shutdown handler. Evita memory
 * leaks de timers órfãos.
 *
 * @module copilot/core/timer-registry
 * @see EventBus
 */

import { SHUTDOWN_PRIORITY } from './shutdown-priorities.js';
import { registerShutdownHandler } from './shutdown.js';

/**
 * @typedef {'timeout' | 'interval'} TimerType
 */

/**
 * @typedef {object} TimerEntry
 * @property {string} id - Identificador do timer
 * @property {TimerType} type - Tipo: timeout ou interval
 * @property {ReturnType<typeof setTimeout>} handle - Handle nativo do timer
 * @property {number} registeredAt - Timestamp de registro
 *
 * @typedef {object} TimerSnapshot
 * @property {string} id
 * @property {TimerType} type
 * @property {number} registeredAt
 * @property {number} ageMs
 */

/** @type {Map<string, TimerEntry>} */
const timers = new Map();

/** @type {boolean} */
let shutdownRegistered = false;

/** @type {number} */
let sleepSequence = 0;

/**
 * Registra um timer no registry. Se já existir um timer com o mesmo `id`, o anterior é cancelado automaticamente antes
 * do novo ser registrado.
 *
 * @param {string} id - Identificador único do timer
 * @param {TimerType} type - 'timeout' ou 'interval'
 * @param {ReturnType<typeof setTimeout>} handle - Handle retornado por setTimeout/setInterval
 * @returns {ReturnType<typeof setTimeout>} O mesmo handle passado (para conveniência)
 */
export function registerTimer(id, type, handle) {
    ensureShutdownRegistered();
    cancel(id);
    timers.set(id, { id, type, handle, registeredAt: Date.now() });
    return handle;
}

/**
 * Cria e registra um intervalo canônico no timer-registry.
 *
 * @param {string} id
 * @param {Parameters<typeof setInterval>[0]} callback
 * @param {Parameters<typeof setInterval>[1]} delay
 * @param {...any[]} args
 * @returns {ReturnType<typeof setInterval>}
 */
export function registerInterval(id, callback, delay, ...args) {
    return /** @type {ReturnType<typeof setInterval>} */ (
        registerTimer(id, 'interval', setInterval(callback, delay, ...args))
    );
}

/**
 * Cria e registra um timeout canônico no timer-registry.
 *
 * @param {string} id
 * @param {Parameters<typeof setTimeout>[0]} callback
 * @param {Parameters<typeof setTimeout>[1]} delay
 * @param {...any[]} args
 * @returns {ReturnType<typeof setTimeout>}
 */
export function registerTimeout(id, callback, delay, ...args) {
    return /** @type {ReturnType<typeof setTimeout>} */ (
        registerTimer(id, 'timeout', setTimeout(callback, delay, ...args))
    );
}

/**
 * Aguarda um atraso em ms usando timeout registrado no timer-registry.
 *
 * @param {number} delayMs
 * @param {{ id?: string; unref?: boolean }} [options]
 * @returns {Promise<void>}
 */
export async function sleepMs(delayMs, options = {}) {
    const delay = Math.max(0, Number.isFinite(delayMs) ? Math.floor(delayMs) : 0);
    if (delay === 0) return;
    const baseId = options.id ?? 'core.sleep';
    // IDs de sleep precisam ser sempre únicos para evitar cancelamento cruzado entre waits concorrentes.
    const id = `${baseId}:${Date.now()}:${++sleepSequence}`;
    await new Promise((resolve) => {
        const handle = registerTimeout(
            id,
            () => {
                cancel(id);
                resolve(undefined);
            },
            delay,
        );
        if (options.unref !== false) handle.unref?.();
    });
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
 * Retorna um snapshot estável dos timers ativos para health/diagnose. O handle nativo nunca é exposto.
 *
 * @param {number} [now=Date.now()] Default is `Date.now()`
 * @returns {TimerSnapshot[]}
 */
export function listActiveTimers(now = Date.now()) {
    return Array.from(timers.values())
        .map((entry) => ({
            id: entry.id,
            type: entry.type,
            registeredAt: entry.registeredAt,
            ageMs: Math.max(0, now - entry.registeredAt),
        }))
        .sort((a, b) => b.ageMs - a.ageMs || a.id.localeCompare(b.id));
}

/**
 * Remove todos os timers e reseta estado interno (apenas para testes).
 */
export function _resetForTesting() {
    cancelAll();
    shutdownRegistered = false;
    sleepSequence = 0;
}

/**
 * Garante que o shutdown handler é registrado apenas uma vez.
 */
function ensureShutdownRegistered() {
    if (shutdownRegistered) return;
    shutdownRegistered = true;
    registerShutdownHandler(
        'timers.cancelAll',
        async () => {
            cancelAll();
        },
        SHUTDOWN_PRIORITY.TIMERS_EARLY,
    );
}
