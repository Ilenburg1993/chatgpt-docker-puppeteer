// @ts-check
/**
 * src/copilot/agent/infra/handoff-manager.js
 *
 * F45 (GAP-SD-07): Handoff Manager — gerencia transferência de sessão entre agentes.
 *
 * Quando o SDK emite `session.handoff`, este módulo:
 *
 * 1. Salva snapshot da sessão atual
 * 2. Prepara o contexto para o agente destino
 * 3. Emite eventos de progresso
 * 4. Permite rejeitar/aceitar handoffs via API
 *
 * @module copilot/agent/infra/handoff-manager
 * @see EventBus
 */

import { EMITTER_HANDOFF_ACCEPTED, EMITTER_HANDOFF_RECEIVED, EMITTER_HANDOFF_REJECTED } from '#copilot/events';
import { EventEmitter } from 'node:events';
import { log } from '../ports/logging-port.js';

/**
 * @typedef {Object} HandoffRequest
 * @property {string} id - ID único do handoff
 * @property {string} fromAgent - Nome do agente fonte
 * @property {string} toAgent - Nome do agente destino
 * @property {string} [reason] - Motivo do handoff
 * @property {Record<string, unknown>} [context] - Contexto a transferir
 * @property {number} receivedAt - Timestamp de recebimento
 * @property {'pending' | 'accepted' | 'rejected' | 'completed' | 'failed'} status
 */

/**
 * @typedef {Object} HandoffResult
 * @property {boolean} accepted
 * @property {string} [error]
 * @property {number} completedAt
 */

/**
 * Gerencia handoffs de sessão entre agentes.
 *
 * @extends EventEmitter
 */
export class HandoffManager extends EventEmitter {
    /** @type {Map<string, HandoffRequest>} */
    #pending = new Map();

    /** @type {HandoffRequest[]} */
    #history = [];

    /** @type {number} */
    #maxHistory;

    /**
     * @param {{ maxHistory?: number }} [options]
     */
    constructor(options = {}) {
        super();
        this.#maxHistory = options.maxHistory ?? 50;
    }

    /**
     * Registra um novo handoff recebido do SDK.
     *
     * @param {{ fromAgent?: string; toAgent?: string; reason?: string; context?: Record<string, unknown> }} data
     * @returns {HandoffRequest}
     */
    receive(data) {
        const id = `handoff-${Date.now()}-${globalThis.crypto.randomUUID().slice(-8)}`;
        /** @type {HandoffRequest} */
        const request = {
            id,
            fromAgent: data.fromAgent ?? 'unknown',
            toAgent: data.toAgent ?? 'self',
            reason: data.reason ?? '',
            context: data.context ?? {},
            receivedAt: Date.now(),
            status: 'pending',
        };

        this.#pending.set(id, request);
        this.emit(EMITTER_HANDOFF_RECEIVED, request);
        log('INFO', `[HandoffManager] Handoff recebido: ${id} (${request.fromAgent} → ${request.toAgent})`);

        return request;
    }

    /**
     * Aceita um handoff pendente.
     *
     * @param {string} handoffId
     * @returns {HandoffResult}
     */
    accept(handoffId) {
        const request = this.#pending.get(handoffId);
        if (!request) {
            return { accepted: false, error: `Handoff ${handoffId} não encontrado`, completedAt: Date.now() };
        }

        request.status = 'accepted';
        this.#pending.delete(handoffId);
        this.#addToHistory(request);
        this.emit(EMITTER_HANDOFF_ACCEPTED, request);
        log('INFO', `[HandoffManager] Handoff aceito: ${handoffId}`);

        return { accepted: true, completedAt: Date.now() };
    }

    /**
     * Rejeita um handoff pendente.
     *
     * @param {string} handoffId
     * @param {string} [reason]
     * @returns {HandoffResult}
     */
    reject(handoffId, reason) {
        const request = this.#pending.get(handoffId);
        if (!request) {
            return { accepted: false, error: `Handoff ${handoffId} não encontrado`, completedAt: Date.now() };
        }

        request.status = 'rejected';
        this.#pending.delete(handoffId);
        this.#addToHistory(request);
        this.emit(EMITTER_HANDOFF_REJECTED, { ...request, rejectReason: reason });
        log('INFO', `[HandoffManager] Handoff rejeitado: ${handoffId} (${reason ?? 'sem motivo'})`);

        return { accepted: false, error: reason ?? 'rejected', completedAt: Date.now() };
    }

    /**
     * Retorna handoffs pendentes.
     *
     * @returns {HandoffRequest[]}
     */
    getPending() {
        return [...this.#pending.values()];
    }

    /**
     * Retorna o histórico de handoffs.
     *
     * @returns {HandoffRequest[]}
     */
    getHistory() {
        return [...this.#history];
    }

    /**
     * @param {HandoffRequest} request
     */
    #addToHistory(request) {
        this.#history.push(request);
        if (this.#history.length > this.#maxHistory) {
            this.#history.shift();
        }
    }
}
