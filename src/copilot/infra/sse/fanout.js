// @ts-check
/**
 * src/copilot/infra/sse/fanout.js
 *
 * FASE-15.2: Abstração de fanout para propagação de eventos entre processos.
 *
 * No modo single-process (padrão), opera como pass-through sem overhead. Em cenários multi-processo (PM2 cluster,
 * worker_threads), pode ser substituído por implementação Redis PubSub ou BroadcastChannel.
 *
 * @module copilot/api/event-fanout
 * @see EventBus
 */

import { EventEmitter } from 'node:events';

/**
 * @typedef {Object} FanoutEvent
 * @property {string} channel - Canal/namespace do evento (ex: 'terminal', 'bridge', 'hooks')
 * @property {string} event - Nome do evento (AGENT_EVENTS name)
 * @property {object} data - Payload do evento
 * @property {number} ts - Timestamp de emissão
 * @property {string} [origin] - Identificador do processo de origem (para evitar eco)
 */

/**
 * @typedef {(evt: FanoutEvent) => void} FanoutHandler
 */

/**
 * EventFanout — distribui eventos entre processos via barramento plugável.
 *
 * Implementação padrão: in-process EventEmitter (zero overhead de rede). Para multi-processo, instanciar com transport
 * customizado.
 */
export class EventFanout {
    /** @type {import('node:events').EventEmitter} */
    #emitter;
    /** @type {string} */
    #processId;

    /**
     * @param {{ processId?: string }} [opts]
     */
    constructor(opts = {}) {
        this.#emitter = new EventEmitter();
        this.#emitter.setMaxListeners(100);
        this.#processId = opts.processId ?? `pid-${process.pid}`;
    }

    /**
     * Publica um evento no barramento de fanout.
     *
     * @param {string} channel - Canal de publicação
     * @param {string} event - Nome do evento
     * @param {object} data - Payload
     * @returns {void}
     */
    publish(channel, event, data) {
        /** @type {FanoutEvent} */
        const fanoutEvt = { channel, event, data, ts: Date.now(), origin: this.#processId };
        this.#emitter.emit(channel, fanoutEvt);
        this.#emitter.emit('*', fanoutEvt);
    }

    /**
     * Subscreve a um canal específico.
     *
     * @param {string} channel - Canal para assinar ('*' para todos)
     * @param {FanoutHandler} handler
     * @returns {{ unsubscribe: () => void }}
     */
    subscribe(channel, handler) {
        this.#emitter.on(channel, handler);
        return {
            unsubscribe: () => {
                this.#emitter.off(channel, handler);
            },
        };
    }

    /**
     * Remove todos os listeners e libera recursos.
     *
     * @returns {void}
     */
    destroy() {
        this.#emitter.removeAllListeners();
    }
}

/**
 * Instância singleton do EventFanout para uso compartilhado. Em cenários multi-processo, substituir por instância com
 * transport Redis/BroadcastChannel.
 */
export const eventFanout = new EventFanout();
