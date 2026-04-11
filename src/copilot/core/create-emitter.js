// @ts-check
/**
 * src/copilot/core/create-emitter.js
 *
 * Factory e base class para emissores de eventos locais.
 * Substitui instanciação e herança direta do emitter nativo
 * para desacoplar módulos do import concreto de `node:events`.
 *
 * @module copilot/core/create-emitter
 */

import { EventEmitter as NodeEventEmitter } from 'node:events';

/**
 * Cria um novo emitter local (façade sobre EventEmitter nativo).
 *
 * @returns {import('node:events').EventEmitter}
 */
export function createEmitter() {
    return new NodeEventEmitter();
}

/**
 * Classe base para módulos que precisam de capacidades de emissão.
 * Uso: `class Foo extends BaseEmitter { … }`
 */
export const BaseEmitter = NodeEventEmitter;
