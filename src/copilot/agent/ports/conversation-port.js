// @ts-check
/**
 * src/copilot/agent/ports/conversation-port.js
 *
 * Porta compatível entre o runtime do agent e `conversation-hub/`.
 *
 * O agent só deve atravessar esta porta quando precisa sincronizar recuperação/histórico com o store conversacional.
 * Regras de memória, sessões do hub e projections de UI continuam pertencendo a `conversation-hub/` e `presentation/`.
 *
 * @module copilot/agent/ports/conversation-port
 * @internal
 */

import { CONVERSATION_STORE } from '#copilot/conversation-hub';

/**
 * Resolve o store conversacional via DI sem expor o token para módulos de lifecycle/session.
 *
 * Retorna `null` para preservar compatibilidade com testes e boots parciais que não registram Conversation Hub.
 *
 * @param {import('../../core/di.js').Container} container
 * @returns {import('../../conversation-hub/store.js').ConversationStore | null}
 */
export function resolveConversationStore(container) {
    return /** @type {import('../../conversation-hub/store.js').ConversationStore | null} */ (
        container.resolve(CONVERSATION_STORE) ?? null
    );
}
