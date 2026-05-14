// @ts-check
/**
 * @module copilot/sdk/models/client-provider
 * @file Porta interna para o provider de client usado por `sdk/models`.
 *
 *   Models nao devem importar `session/client.js` diretamente: isso reabre ciclo estatico model/session. O provider e
 *   registrado por `session/client.js` quando o runtime SDK e carregado pelo barrel publico.
 */

/**
 * @typedef {(
 *     overrides?: object,
 * ) => Promise<{ listModels: () => Promise<import('@github/copilot-sdk').ModelInfo[]> }>} ModelListClientProvider
 */

/** @type {ModelListClientProvider | null} */
let provider = null;

/**
 * @param {ModelListClientProvider | null | undefined} nextProvider
 * @returns {void}
 */
export function setModelListClientProvider(nextProvider) {
    provider = typeof nextProvider === 'function' ? nextProvider : null;
}

/**
 * @param {object} [overrides]
 * @returns {Promise<{ listModels: () => Promise<import('@github/copilot-sdk').ModelInfo[]> }>}
 */
export async function getModelListClient(overrides = {}) {
    if (provider === null) {
        throw new Error('[sdk/models] Model list client provider não inicializado; carregue #copilot/sdk/session.');
    }
    return provider(overrides);
}
