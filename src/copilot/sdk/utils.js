// @ts-check
/**
 * src/copilot/lib/utils.js
 *
 * Utilitários gerais de uso interno. Não possui dependências externas.
 *
 * @module copilot/lib/utils
 */

/**
 * Retorna um novo objeto contendo apenas as propriedades do objeto de entrada cujos valores são **diferentes de
 * `undefined`**.
 *
 * Substitui o padrão verboso:
 *
 * ```js
 * { ...(x !== undefined ? { key: x } : {}) }
 * ```
 *
 * por:
 *
 * ```js
 * pickDefined({ key: x });
 * ```
 *
 * @template {Record<string, unknown>} T
 * @param {T} obj
 * @returns {Partial<T>}
 */
export function pickDefined(obj) {
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const [key, value] of Object.entries(obj)) {
        if (value !== undefined) out[key] = value;
    }
    return /** @type {Partial<T>} */ (out);
}
