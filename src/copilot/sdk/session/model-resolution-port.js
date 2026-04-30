// @ts-check
/**
 * @module copilot/sdk/session/model-resolution-port
 * @file Porta de resolução de `model="auto"` para lifecycle de sessão.
 */

/**
 * @typedef {(fallback: string) => Promise<string>} SessionAutoModelResolver
 */

/**
 * Resolver default carregado de forma lazy para evitar acoplamento estático entre lifecycle de sessão e catálogo de
 * modelos.
 *
 * @param {string} fallback
 * @returns {Promise<string>}
 */
async function defaultSessionAutoModelResolver(fallback) {
    const { resolveSessionAutoModelFromCatalog } = await import('../models/session-resolution-adapter.js');
    return resolveSessionAutoModelFromCatalog(fallback);
}

/** @type {SessionAutoModelResolver} */
let sessionAutoModelResolver = defaultSessionAutoModelResolver;

/**
 * Injeta um resolver de modelo automático. Útil para testes e runtimes com estratégia dedicada de seleção.
 *
 * @param {SessionAutoModelResolver | null | undefined} resolver
 * @returns {void}
 */
export function setSessionAutoModelResolver(resolver) {
    sessionAutoModelResolver = typeof resolver === 'function' ? resolver : defaultSessionAutoModelResolver;
}

/**
 * Resolve `model="auto"` via resolver atualmente configurado.
 *
 * @param {string} [fallback='gpt-5-mini'] Default is `'gpt-5-mini'`
 * @returns {Promise<string>}
 */
export async function resolveSessionAutoModel(fallback = 'gpt-5-mini') {
    return sessionAutoModelResolver(fallback);
}
