// @ts-check
/**
 * @module copilot/sdk/models/session-resolution-adapter
 * @file Adapter de resolução automática de modelo para ciclo de sessão.
 *
 *   Mantém o domínio de catálogo/model metadata em `sdk/models/*` e fornece uma interface injetável para
 *   `sdk/session/lifecycle`, evitando acoplamento direto ao barrel `models/index.js`.
 */

import { listModels, resolveModelIdAuto } from './helpers.js';

/**
 * @typedef {(fallback: string) => Promise<string>} SessionAutoModelResolver
 */

/**
 * Cria um resolver de `model="auto"` com dependências injetáveis.
 *
 * @param {{
 *     listModelsFn?: () => Promise<import('@github/copilot-sdk').ModelInfo[]>;
 *     resolveModelIdAutoFn?: (
 *         models: import('@github/copilot-sdk').ModelInfo[],
 *         preferred?: string,
 *         fallback?: string,
 *     ) => Promise<string>;
 * }} [deps]
 * @returns {SessionAutoModelResolver}
 */
export function createSessionAutoModelResolver(deps = {}) {
    const listModelsFn = deps.listModelsFn ?? listModels;
    const resolveModelIdAutoFn = deps.resolveModelIdAutoFn ?? resolveModelIdAuto;
    return async (fallback) => {
        if (fallback === 'auto') {
            return 'auto';
        }
        const availableModels = await listModelsFn();
        return resolveModelIdAutoFn(availableModels, 'auto', fallback);
    };
}

/**
 * Resolver padrão baseado no catálogo de modelos atual.
 *
 * @param {string} fallback
 * @returns {Promise<string>}
 */
export async function resolveSessionAutoModelFromCatalog(fallback) {
    return createSessionAutoModelResolver()(fallback);
}
