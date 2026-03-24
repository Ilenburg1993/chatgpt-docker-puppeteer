// @ts-check
/**
 * src/copilot/conversation-hub/hub.js
 *
 * ConversationHub — singleton que compõe ConversationStore + HubOrchestrator + Namespace Socket.io.
 *
 * É o ponto de entrada único para o ambiente permanente LLM-A ↔ LLM-B ↔ Usuário. Deve ser inicializado via
 * conversationHub.init({ io, nerv }) na FASE 10 do boot do main-server.
 *
 * @module copilot/conversation-hub/hub
 */

import { log } from '#core/logger';
import { HubOrchestrator } from './orchestrator.js';
import { mountCopilotNamespace } from './socket-ns.js';
import { conversationStore } from './store.js';

// ─── ConversationHub ──────────────────────────────────────────────────────────

/**
 * @typedef {Object} HubInitOpts
 * @property {any} io - Instância Socket.io Server (obrigatório)
 * @property {any} [nerv] - Instância NERV bus (opcional, para forwarding de eventos)
 */

/**
 * ConversationHub — ambiente permanente LLM-A ↔ LLM-B ↔ Usuário.
 *
 * Compõe:
 *
 * - ConversationStore (SQLite, persistência)
 * - HubOrchestrator (lógica de diálogo)
 * - Namespace /copilot (Socket.io, tempo real)
 */
export class ConversationHub {
    /** @type {HubOrchestrator | null} */
    #orchestrator = null;

    /** @type {boolean} */
    #initialized = false;

    // ─── Inicialização ─────────────────────────────────────────────────────────

    /**
     * Inicializa todos os componentes do hub. É idempotente: chamadas adicionais são no-op.
     *
     * @param {HubInitOpts} opts
     * @returns {Promise<void>}
     */
    async init(opts) {
        if (this.#initialized) {
            log('WARN', '[ConversationHub] já inicializado, ignorando re-init.');
            return;
        }

        // 1. Inicializar store (DDL idempotente)
        conversationStore.init();

        // 2. Criar orquestrador
        this.#orchestrator = new HubOrchestrator(conversationStore);
        this.#orchestrator.init();

        // 3. Montar namespace Socket.io /copilot
        mountCopilotNamespace(opts.io, this.#orchestrator, conversationStore);

        // 4. (Opcional) Encaminhar eventos para NERV bus
        if (opts.nerv) {
            this.#bridgeToNerv(opts.nerv);
        }

        this.#initialized = true;
        log('INFO', '[ConversationHub] Ambiente permanente LLM-A ↔ LLM-B ↔ Usuário inicializado.');
    }

    // ─── Acesso ao orquestrador ────────────────────────────────────────────────

    /**
     * Retorna o HubOrchestrator. Lança erro se o hub não foi inicializado.
     *
     * @returns {HubOrchestrator}
     * @throws {Error} Se hub não inicializado
     */
    get orchestrator() {
        if (!this.#orchestrator) {
            throw new Error('[ConversationHub] Não inicializado. Chame init() primeiro.');
        }
        return this.#orchestrator;
    }

    /**
     * Retorna o ConversationStore.
     *
     * @returns {import('./store.js').ConversationStore}
     */
    get store() {
        return conversationStore;
    }

    /**
     * Se o hub está inicializado e pronto.
     *
     * @returns {boolean}
     */
    get isReady() {
        return this.#initialized;
    }

    // ─── Atalhos de API ────────────────────────────────────────────────────────

    /**
     * Cria uma nova hub_session de conversa.
     *
     * @param {{ title?: string; metadata?: object }} [opts]
     * @returns {string} hubSessionId
     */
    createSession(opts = {}) {
        return this.orchestrator.createSession(opts);
    }

    /**
     * LLM-A envia mensagem para LLM-B via hub.
     *
     * @param {string} hubSessionId
     * @param {string | object} message
     * @param {import('./orchestrator.js').SendToLlmBOpts} [opts]
     * @returns {Promise<import('./orchestrator.js').OrchestratorResult>}
     */
    sendToLlmB(hubSessionId, message, opts = {}) {
        return this.orchestrator.sendToLlmB(hubSessionId, message, opts);
    }

    /**
     * Injeta mensagem do usuário na conversa.
     *
     * @param {string} hubSessionId
     * @param {string} content
     * @param {{ metadata?: object }} [opts]
     * @returns {number} turnId
     */
    injectUserMessage(hubSessionId, content, opts = {}) {
        return this.orchestrator.injectUserMessage(hubSessionId, content, opts);
    }

    /**
     * LLM-A verifica mensagens pendentes do usuário.
     *
     * @param {string} hubSessionId
     * @returns {import('./store.js').ConversationTurn[]}
     */
    pollUserMessages(hubSessionId) {
        return this.orchestrator.pollUserMessages(hubSessionId);
    }

    // ─── Encerramento ──────────────────────────────────────────────────────────

    /**
     * Para o hub e libera recursos.
     *
     * @returns {void}
     */
    stop() {
        if (this.#orchestrator) {
            this.#orchestrator.destroy();
            this.#orchestrator = null;
        }
        this.#initialized = false;
        log('INFO', '[ConversationHub] Parado.');
    }

    // ─── Integração NERV ───────────────────────────────────────────────────────

    /**
     * Encaminha eventos do HubOrchestrator para o NERV bus.
     *
     * @param {any} nerv
     * @returns {void}
     */
    #bridgeToNerv(nerv) {
        if (!this.#orchestrator) return;

        /** @param {string} actionCode @param {any} payload */
        const emit = (actionCode, payload) => {
            try {
                nerv.emitEvent?.({
                    source: 'copilot-hub',
                    actionCode,
                    payload,
                    ts: Date.now(),
                });
            } catch (/** @type {any} */ _err) {
                // NERV indisponível — ignorar silenciosamente
            }
        };

        this.#orchestrator.on('session:created', (d) => emit('copilot.hub.session.created', d));
        this.#orchestrator.on('session:closed', (d) => emit('copilot.hub.session.closed', d));
        this.#orchestrator.on('turn:sent', (d) => emit('copilot.hub.turn.sent', d));
        this.#orchestrator.on('turn:complete', (d) => emit('copilot.hub.turn.complete', d));
        this.#orchestrator.on('user:injected', (d) => emit('copilot.hub.user.injected', d));
        this.#orchestrator.on('error', (d) => emit('copilot.hub.error', d));

        log('DEBUG', '[ConversationHub] Bridge NERV vinculado.');
    }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

/**
 * Instância singleton do ConversationHub. Inicialize com `conversationHub.init({ io, nerv })` no boot do server.
 *
 * @type {ConversationHub}
 */
export const conversationHub = new ConversationHub();
