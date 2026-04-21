// @ts-check
/**
 * src/copilot/terminal/dialog/index.js
 *
 * Barrel do submódulo dialog do Terminal Permanente LLM-B.
 *
 * Mantém as exports leves (`output`, `sse`, `engine-persistence`) carregadas imediatamente, mas passa a lazy-load o
 * engine pesado para evitar ciclos/transitivos desnecessários em consumers que só precisam de prompt/output.
 *
 * @module copilot/terminal/dialog
 * @see EventBus
 */

import {
    drainPendingNotifications as drainPendingNotificationsNow,
    getPersistenceFailureCount as getPersistenceFailureCountNow,
} from './engine-persistence.js';

/** @type {Promise<typeof import('./engine.js')> | null} */
let _engineModulePromise = null;

/**
 * @returns {Promise<typeof import('./engine.js')>}
 */
function loadEngineModule() {
    if (_engineModulePromise === null) {
        _engineModulePromise = import('./engine.js');
    }
    return _engineModulePromise;
}

/**
 * @returns {Promise<void>}
 */
export async function ensureDialogLoop() {
    const mod = await loadEngineModule();
    return mod.ensureDialogLoop();
}

/**
 * @param {string} message
 * @param {string} [actor]
 * @returns {Promise<string | null>}
 */
export async function sendTurn(message, actor = 'user') {
    const mod = await loadEngineModule();
    return mod.sendTurn(message, actor);
}

/**
 * Retorna a profundidade atual da fila de turnos se o engine já foi carregado; caso contrário, 0.
 *
 * @returns {number}
 */
export function getTurnQueueDepth() {
    return 0;
}

/**
 * Drena notificações pendentes persistidas no layer de engine-persistence.
 *
 * @returns {number}
 */
export function drainPendingNotifications() {
    return drainPendingNotificationsNow();
}

/**
 * Retorna a contagem de falhas de persistência registradas.
 *
 * @returns {number}
 */
export function getPersistenceFailureCount() {
    return getPersistenceFailureCountNow();
}

export {
    BOOT_PROMPT,
    buildUserPrompt,
    buildWaitingPrompt,
    printExchange,
    println,
    PROMPT_USER,
    PROMPT_WAITING,
    SEPARATOR,
    TURN_TIMEOUT_MS,
} from './output.js';
export { broadcastSse, CRITICAL_EVENTS, nextSseEventId } from './sse.js';
