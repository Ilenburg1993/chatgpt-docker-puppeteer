// @ts-check
/**
 * @module copilot/agent/facades/agent-sdk-runtime
 * @file Façade canônica para operações de sessão SDK ativa dentro do runtime do agent.
 *
 *   Esta camada evita que módulos quentes (`messaging`, `history-sync`, `keepalive`, `dialog/*`) precisem importar
 *   diretamente a superfície do SDK, mesmo quando o acesso é via barrel.
 *
 *   Importante para o contrato zero-PR: `sendAgentSdkSession*()` é o caminho direto do SDK e pode produzir eventos de
 *   usage/PR. A fila paralela zero-PR do produto é o mailbox do runtime, drenado em `ask_user(kind=question)` por
 *   `answerPendingQuestion`, não esta façade.
 */

import {
    onAllSessionEvents,
    onSessionEvent,
} from '#copilot/sdk/session';
import {
    getSessionMessages,
    sendSession,
    sendSessionAndWait,
} from '#copilot/sdk/session-runtime';
import {
    waitForEvent,
} from '#copilot/sdk/event-helpers';

/**
 * @param {import('#copilot/sdk/types').CopilotSession} session
 * @param {import('#copilot/sdk/types').MessageOptions} sendOpts
 * @returns {Promise<string | undefined>}
 */
export async function sendAgentSdkSession(session, sendOpts) {
    return sendSession(session, sendOpts);
}

/**
 * @param {import('#copilot/sdk/types').CopilotSession} session
 * @param {import('#copilot/sdk/types').MessageOptions} sendOpts
 * @param {number} [timeoutMs]
 * @returns {Promise<import('#copilot/sdk/types').AssistantMessageEvent | undefined>}
 */
export async function sendAgentSdkSessionAndWait(session, sendOpts, timeoutMs) {
    return sendSessionAndWait(session, sendOpts, timeoutMs);
}

/**
 * @template {import('#copilot/sdk/types').SessionEventType} T
 * @param {import('#copilot/sdk/types').CopilotSession} session
 * @param {T} eventType
 * @param {(event: import('#copilot/sdk/types').SessionEventPayload<T>) => void} handler
 * @returns {() => void}
 */
export function onAgentSdkSessionEvent(session, eventType, handler) {
    return onSessionEvent(session, eventType, handler);
}

/**
 * @param {import('#copilot/sdk/types').CopilotSession} session
 * @param {(event: import('#copilot/sdk/types').SessionEvent) => void} handler
 * @returns {() => void}
 */
export function onAllAgentSdkSessionEvents(session, handler) {
    return onAllSessionEvents(session, handler);
}

/**
 * Expõe de forma canônica se a sessão SDK ativa suporta leitura de histórico (`getEvents`).
 *
 * Regra arquitetural: módulos de `agent/session/*` não devem sondar `session.getEvents` diretamente; a capacidade
 * vanilla deve ser consultada por uma façade do runtime.
 *
 * @param {import('#copilot/sdk/types').CopilotSession} session
 * @returns {boolean}
 */
export function canReadAgentSdkSessionMessages(session) {
    const candidate = /** @type {{ getEvents?: unknown } | null} */ (/** @type {unknown} */ (session));
    return typeof candidate?.getEvents === 'function';
}

/**
 * Aguarda um evento arbitrário em qualquer EventEmitter/target compatível sem expor diretamente `#copilot/sdk`.
 *
 * @template T
 * @param {import('node:events').EventEmitter} target
 * @param {string} eventType
 * @param {{ timeoutMs?: number; timeoutError?: string; signal?: AbortSignal }} [options]
 * @returns {Promise<T>}
 */
export async function waitForAgentSdkEvent(target, eventType, options) {
    return /** @type {Promise<T>} */ (waitForEvent(target, eventType, options));
}

/**
 * @param {import('#copilot/sdk/types').CopilotSession} session
 * @returns {Promise<unknown[]>}
 */
export async function readAgentSdkSessionMessages(session) {
    return getSessionMessages(session);
}
