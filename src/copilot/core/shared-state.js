// @ts-check
/**
 * src/copilot/core/shared-state.js
 *
 * Estado mínimo compartilhado entre módulos de camadas diferentes de `src/copilot`.
 *
 * Propósito: evitar que módulos de camada inferior (ex: `agent/`) importem de camadas
 * superiores (ex: `terminal/`) apenas para ler estado global.
 *
 * Regras:
 * - Apenas estado inerte (getters/setters de primitivos)
 * - Sem EventEmitter sofisticado — use `terminal/state.js` para reatividade do terminal
 * - O módulo de nível superior (`terminal/state.js`) DELEGA para este módulo como SSOT
 *
 * @module copilot/core/shared-state
 */

// ─── Hub Session ID ───────────────────────────────────────────────────────────

/** @type {string | null} */
let _hubSessionId = null;

/**
 * Retorna o ID da hub session permanente, se disponível.
 *
 * @returns {string | null}
 */
export function getHubSessionId() {
    return _hubSessionId;
}

/**
 * Define o ID da hub session permanente.
 * Deve ser chamado por `terminal/state.js` ao mudar o hubSessionId.
 *
 * @param {string | null} id
 * @returns {void}
 */
export function setSharedHubSessionId(id) {
    _hubSessionId = id;
}
