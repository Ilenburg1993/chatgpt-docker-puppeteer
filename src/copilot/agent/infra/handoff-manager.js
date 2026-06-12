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
import { log } from '../ports/logging/index.js';

/**
 * @typedef {Object} HandoffRequest
 * @property {string} id - ID único do handoff
 * @property {string} fromAgent - Nome do agente fonte
 * @property {string} toAgent - Nome do agente destino
 * @property {string} [reason] - Motivo do handoff
 * @property {Record<string, unknown>} [context] - Contexto a transferir
 * @property {number} receivedAt - Timestamp de recebimento
 * @property {number} expiresAt - Timestamp limite para decisão
 * @property {number} [completedAt] - Timestamp de conclusão/expiração
 * @property {string} [expirationReason] - Motivo canônico da expiração
 * @property {'pending' | 'accepted' | 'rejected' | 'expired' | 'completed' | 'failed'} status
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

    /** @type {number} */
    #pendingTtlMs;

    /** @type {() => number} */
    #now;

    /**
     * @param {{ maxHistory?: number; pendingTtlMs?: number; now?: () => number }} [options]
     */
    constructor(options = {}) {
        super();
        this.#maxHistory = options.maxHistory ?? 50;
        this.#pendingTtlMs = normalizePendingTtlMs(
            options.pendingTtlMs ?? Number(process.env['COPILOT_HANDOFF_PENDING_TTL_MS']),
        );
        this.#now = typeof options.now === 'function' ? options.now : Date.now;
    }

    /**
     * Registra um novo handoff recebido do SDK.
     *
     * @param {{ fromAgent?: string; toAgent?: string; reason?: string; context?: Record<string, unknown> }} data
     * @returns {HandoffRequest}
     */
    receive(data) {
        this.pruneExpired();
        const nowMs = this.#now();
        const id = `handoff-${nowMs}-${globalThis.crypto.randomUUID().slice(-8)}`;
        /** @type {HandoffRequest} */
        const request = {
            id,
            fromAgent: data.fromAgent ?? 'unknown',
            toAgent: data.toAgent ?? 'self',
            reason: data.reason ?? '',
            context: data.context ?? {},
            receivedAt: nowMs,
            expiresAt: nowMs + this.#pendingTtlMs,
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
        this.pruneExpired();
        const request = this.#pending.get(handoffId);
        if (!request) {
            return { accepted: false, error: `Handoff ${handoffId} não encontrado`, completedAt: this.#now() };
        }

        request.status = 'accepted';
        request.completedAt = this.#now();
        this.#pending.delete(handoffId);
        this.#addToHistory(request);
        this.emit(EMITTER_HANDOFF_ACCEPTED, request);
        log('INFO', `[HandoffManager] Handoff aceito: ${handoffId}`);

        return { accepted: true, completedAt: request.completedAt };
    }

    /**
     * Rejeita um handoff pendente.
     *
     * @param {string} handoffId
     * @param {string} [reason]
     * @returns {HandoffResult}
     */
    reject(handoffId, reason) {
        this.pruneExpired();
        const request = this.#pending.get(handoffId);
        if (!request) {
            return { accepted: false, error: `Handoff ${handoffId} não encontrado`, completedAt: this.#now() };
        }

        request.status = 'rejected';
        request.completedAt = this.#now();
        this.#pending.delete(handoffId);
        this.#addToHistory(request);
        this.emit(EMITTER_HANDOFF_REJECTED, { ...request, rejectReason: reason });
        log('INFO', `[HandoffManager] Handoff rejeitado: ${handoffId} (${reason ?? 'sem motivo'})`);

        return { accepted: false, error: reason ?? 'rejected', completedAt: request.completedAt };
    }

    /**
     * Retorna handoffs pendentes.
     *
     * @returns {HandoffRequest[]}
     */
    getPending() {
        this.pruneExpired();
        return [...this.#pending.values()];
    }

    /**
     * Retorna o histórico de handoffs.
     *
     * @returns {HandoffRequest[]}
     */
    getHistory() {
        this.pruneExpired();
        return [...this.#history];
    }

    /**
     * Materializa handoffs vencidos no histórico e emite o evento de rejeição já consumido pelas fronteiras atuais.
     *
     * @returns {number}
     */
    pruneExpired() {
        const nowMs = this.#now();
        let expired = 0;
        for (const [handoffId, request] of this.#pending) {
            if (request.expiresAt > nowMs) continue;
            request.status = 'expired';
            request.completedAt = nowMs;
            request.expirationReason = 'pending-ttl-exceeded';
            this.#pending.delete(handoffId);
            this.#addToHistory(request);
            this.emit(EMITTER_HANDOFF_REJECTED, {
                ...request,
                rejectReason: request.expirationReason,
            });
            log('WARN', `[HandoffManager] Handoff expirado: ${handoffId}`);
            expired += 1;
        }
        return expired;
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

/**
 * @param {unknown} value
 * @returns {number}
 */
function normalizePendingTtlMs(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return 5 * 60 * 1000;
    return Math.min(24 * 60 * 60 * 1000, Math.max(1000, Math.round(numeric)));
}
