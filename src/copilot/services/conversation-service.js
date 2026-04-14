// @ts-check
/**
 * src/copilot/services/conversation-service.js
 *
 * Fachada de alto nível para operações de conversação, consolidando conversation-hub + channel.
 *
 * @module copilot/services/conversation-service
 */

import { CONVERSATION_STORE, HUB } from '#copilot/conversation-hub';
import { container, EVENT_BUS } from '#copilot/core';
import { SERVICE_SESSION_MESSAGE } from '#copilot/events';
import { log } from '#copilot/observability';

/**
 * Fachada de conversação — consolida conversation-hub + channel.
 */
export class ConversationService {
    /** @type {import('../core/event-bus.js').EventBus | null} */
    #eventBus = null;

    /**
     * Obtém EventBus (lazy).
     *
     * @returns {import('../core/event-bus.js').EventBus | null}
     */
    #bus() {
        if (!this.#eventBus) {
            try {
                this.#eventBus = container.resolve(EVENT_BUS);
            } catch {
                // EventBus não registrado
            }
        }
        return this.#eventBus;
    }

    /**
     * Obtém o ConversationHub singleton.
     *
     * @returns {any}
     */
    getHub() {
        return container.resolve(HUB);
    }

    /**
     * Obtém o ConversationStore singleton.
     *
     * @returns {any}
     */
    getStore() {
        return container.resolve(CONVERSATION_STORE);
    }

    /**
     * Envia mensagem para LLM-B via hub.
     *
     * @param {string} hubSessionId
     * @param {string} message
     * @param {object} [options]
     * @returns {void}
     */
    sendToLlmB(hubSessionId, message, options) {
        log('DEBUG', `[ConversationService] enviando para LLM-B sessão ${hubSessionId}`);
        void container.resolve(HUB).sendToLlmB(hubSessionId, message, options);
        this.#bus()?.emit({ type: SERVICE_SESSION_MESSAGE });
    }

    /**
     * Cria sessão no hub.
     *
     * @param {object} [opts]
     * @returns {any}
     */
    createHubSession(opts) {
        return container.resolve(HUB).createSession(opts);
    }
}

/**
 * Cria instância de ConversationService.
 *
 * @returns {ConversationService}
 */
export function createConversationService() {
    return new ConversationService();
}
