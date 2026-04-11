// @ts-check
/**
 * src/copilot/core/di-container.js — [L0] Global DI container singleton.
 *
 * Exporta o container raiz do sistema copilot. Módulos de camada superior registram suas factories no bootstrap;
 * módulos consumidores resolvem dependências via `container.resolve(TOKEN)`.
 *
 * Alternativa moderna aos setters manuais (`setSdkLogger`, `setBridgeAgent`, etc.), mantendo backward compat total.
 *
 * @module copilot/core/di-container
 */

import { createContainer } from './di.js';

/**
 * Container DI raiz (singleton de processo). Todos os tokens são registrados aqui durante o bootstrap, e resolvidos sob
 * demanda.
 *
 * @type {import('./di.js').Container}
 */
export const container = createContainer();

/**
 * K-5: Mapeamento centralizado de DI tokens → setters legados.
 *
 * Permite que o bootstrap chame `wireLegacySetters(container, mapping)` para resolver tokens e
 * invocar os setters correspondentes, eliminando scatter de setter calls pelo codebase.
 *
 * @param {import('./di.js').Container} c - Container com tokens já registrados.
 * @param {Array<{ token: import('./di.js').Token<any>; setter: (value: any) => void }>} mapping
 * @returns {number} Quantidade de setters invocados.
 */
export function wireLegacySetters(c, mapping) {
    let count = 0;
    for (const { token, setter } of mapping) {
        try {
            const value = c.resolve(token);
            if (value !== undefined) {
                setter(value);
                count++;
            }
        } catch {
            // Token não registrado — skip silenciosamente
        }
    }
    return count;
}
