// @ts-check
/**
 * src/copilot/core/shared-state.js
 *
 * Estado mínimo compartilhado entre módulos de camadas diferentes de `src/copilot`.
 *
 * Propósito: evitar que módulos de camada inferior (ex: `agent/`) importem de camadas superiores (ex: `terminal/`)
 * apenas para ler estado global.
 *
 * Regras:
 *
 * - Apenas estado inerte (getters/setters de primitivos)
 * - Sem EventEmitter sofisticado — use `presentation/runtime-ui-state-store.js` para reatividade compartilhada
 * - `presentation/runtime-ui-state-store.js` sincroniza este módulo como SSOT cross-layer mínimo
 *
 * @module copilot/core/shared-state
 * @see EventBus
 */

// ─── Hub Session ID ───────────────────────────────────────────────────────────

/** @type {string | null} */
let _hubSessionId = null;

/** @type {string | null} */
let _sdkSessionId = null;

/**
 * Retorna o ID da hub session permanente, se disponível.
 *
 * @returns {string | null}
 */
export function getHubSessionId() {
    return _hubSessionId;
}

/**
 * Define o ID da hub session permanente. Deve ser chamado pela store compartilhada quando o hubSessionId mudar.
 *
 * @param {string | null} id
 * @returns {void}
 */
export function setSharedHubSessionId(id) {
    _hubSessionId = id;
}

/**
 * Retorna o ID da sessão SDK ativa, se disponível.
 *
 * @returns {string | null}
 */
export function getSharedSdkSessionId() {
    return _sdkSessionId;
}

/**
 * Define o ID da sessão SDK ativa no estado compartilhado cross-layer.
 *
 * @param {string | null} id
 * @returns {void}
 */
export function setSharedSdkSessionId(id) {
    _sdkSessionId = id;
}

/**
 * Retorna o vínculo compartilhado atual entre sessão conversacional (`hub`) e sessão SDK.
 *
 * @returns {{ hubSessionId: string | null; sdkSessionId: string | null }}
 */
export function getSharedSessionBinding() {
    return {
        hubSessionId: _hubSessionId,
        sdkSessionId: _sdkSessionId,
    };
}

/**
 * Limpa o vínculo compartilhado entre hub e SDK.
 *
 * @returns {void}
 */
export function clearSharedSessionBinding() {
    _hubSessionId = null;
    _sdkSessionId = null;
}
