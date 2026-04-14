// @ts-check
/**
 * src/copilot/events/create-emitter.js
 *
 * Factory e base class para emissores de eventos locais. Substitui instanciação e herança direta do emitter nativo para
 * desacoplar módulos do import concreto de `node:events`.
 *
 * @module copilot/events/create-emitter
 * @see EventBus
 */

import { EventEmitter as NodeEventEmitter } from 'node:events';

/**
 * Cria um novo emitter local (façade sobre EventEmitter nativo).
 *
 * @deprecated Faixa 3.4 (D3-02): use `new EventEmitter()` de `'node:events'` diretamente.
 *   Será removido numa próxima faixa de cleanup.
 * @returns {import('node:events').EventEmitter}
 */
export function createEmitter() {
    return new NodeEventEmitter();
}

/**
 * Classe base para módulos que precisam de capacidades de emissão.
 *
 * @deprecated Faixa 3.4 (D3-02): use `import { EventEmitter } from 'node:events'` diretamente.
 *   Será removido numa próxima faixa de cleanup.
 */
export const BaseEmitter = NodeEventEmitter;
