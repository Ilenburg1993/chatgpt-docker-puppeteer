// @ts-check
/**
 * src/copilot/events/local-emitter.js
 *
 * Factory e base class para emissores locais. Use apenas quando um emitter local for mais adequado que o EventBus
 * cross-module.
 *
 * @module copilot/events/local-emitter
 */

import { EventEmitter as NodeEventEmitter } from 'node:events';

/**
 * Cria um novo emitter local.
 *
 * @returns {import('node:events').EventEmitter}
 */
export function createEmitter() {
    return new NodeEventEmitter();
}

/**
 * Classe base para módulos que precisam de capacidades locais de emissão.
 */
export const BaseEmitter = NodeEventEmitter;
