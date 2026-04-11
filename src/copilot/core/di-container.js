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
