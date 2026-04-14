// @ts-check
/**
 * src/copilot/sdk/events.js
 *
 * Faixa 10 — Typed Event System para os 74 session events do SDK. Abstrai `session.on(type, handler)` com funções
 * desacopladas, facilitando composição e testing.
 *
 * Tipos de referência do SDK:
 *
 * - `SessionEvent`: union discriminada por `.type`
 * - `SessionEventType`: `SessionEvent["type"]` (string literal union)
 * - `SessionEventPayload<T>`: `Extract<SessionEvent, { type: T }>`
 * - `TypedSessionEventHandler<T>`: `(event: SessionEventPayload<T>) => void`
 * - `SessionEventHandler`: `(event: SessionEvent) => void`
 *
 * @module copilot/sdk/events
 * @see EventBus
 */

import { SESSION_EVENTS } from '../constants.js';

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * @typedef {import('@github/copilot-sdk').CopilotSession} CopilotSession
 */

/**
 * @typedef {import('@github/copilot-sdk').SessionEvent} SessionEvent
 */

/**
 * @typedef {SessionEvent['type']} SessionEventType
 */

/**
 * @template {SessionEventType} T
 * @typedef {Extract<SessionEvent, { type: T }>} SessionEventPayload
 */

/**
 * @typedef {(event: SessionEvent) => void} SessionEventHandler
 */

/**
 * @typedef {{ type: SessionEventType; handler: () => void; unsubscribe: () => void }} EventSubscription
 */

// ─── Internal Helpers ─────────────────────────────────────────────────────────

/**
 * Asserts that a session object is valid (not null/undefined and has `.on` method).
 *
 * @param {unknown} session
 * @returns {asserts session is CopilotSession}
 */
function assertSession(session) {
    if (!session || typeof session !== 'object') {
        throw new Error('[sdk/events] session is required');
    }
    if (typeof (/** @type {Record<string, unknown>} */ (session).on) !== 'function') {
        throw new Error('[sdk/events] session must have an .on() method');
    }
}

/**
 * Validates that an event type string is a known SESSION_EVENTS value.
 *
 * @param {string} eventType
 * @returns {boolean}
 */
function isKnownEventType(eventType) {
    return EVENT_TYPE_SET.has(eventType);
}

/** @type {ReadonlySet<string>} */
const EVENT_TYPE_SET = new Set(Object.values(SESSION_EVENTS));

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Lista de todos os event types conhecidos do SDK.
 *
 * @type {readonly string[]}
 */
export const ALL_EVENT_TYPES = Object.freeze(Object.values(SESSION_EVENTS));

/**
 * Verifica se um event type é conhecido (pertence ao mapa SESSION_EVENTS).
 *
 * @param {string} eventType — tipo de evento a verificar
 * @returns {boolean} true se é um event type reconhecido
 */
export { isKnownEventType };

/**
 * Subscreve a um evento tipado específico da sessão.
 *
 * Wrapper sobre `session.on(eventType, handler)` que:
 *
 * 1. Valida a session e o event type
 * 2. Retorna uma função de unsubscribe
 *
 * @example
 *     ```js
 *     const unsub = onSessionEvent(session, SESSION_EVENTS.ASSISTANT_MESSAGE, (evt) => {
 *         console.log('Mensagem:', evt.data.content);
 *     });
 *     // Parar de ouvir:
 *     unsub();
 *     ```;
 *
 * @param {CopilotSession} session — sessão ativa do SDK
 * @param {string} eventType — tipo de evento (e.g., 'assistant.message')
 * @param {(event: SessionEvent) => void} handler — callback para o evento
 * @returns {() => void} função unsubscribe
 */
export function onSessionEvent(session, eventType, handler) {
    assertSession(session);
    if (typeof eventType !== 'string' || eventType.length === 0) {
        throw new Error('[sdk/events] eventType must be a non-empty string');
    }
    if (typeof handler !== 'function') {
        throw new Error('[sdk/events] handler must be a function');
    }
    return /** @type {import('../types.js').SessionEventSubscriber} */ (/** @type {unknown} */ (session)).on(
        eventType,
        handler,
    );
}

/**
 * Subscreve a múltiplos eventos tipados de uma sessão de uma vez.
 *
 * @example
 *     ```js
 *     const unsub = onSessionEvents(session, {
 *         [SESSION_EVENTS.ASSISTANT_MESSAGE]: (evt) => console.log('msg', evt),
 *         [SESSION_EVENTS.SESSION_ERROR]: (evt) => console.error('err', evt),
 *         [SESSION_EVENTS.TOOL_EXECUTION_START]: (evt) => console.log('tool', evt),
 *     });
 *     // Parar de ouvir todos:
 *     unsub();
 *     ```;
 *
 * @param {CopilotSession} session — sessão ativa do SDK
 * @param {Record<string, (event: SessionEvent) => void>} handlerMap — mapa de eventType → handler
 * @returns {() => void} função que chama unsubscribe de todos os handlers
 */
export function onSessionEvents(session, handlerMap) {
    assertSession(session);
    if (!handlerMap || typeof handlerMap !== 'object') {
        throw new Error('[sdk/events] handlerMap must be a non-null object');
    }

    const entries = Object.entries(handlerMap);
    if (entries.length === 0) {
        throw new Error('[sdk/events] handlerMap must have at least one entry');
    }

    /** @type {(() => void)[]} */
    const unsubscribers = [];
    for (const [eventType, handler] of entries) {
        if (typeof handler !== 'function') {
            throw new Error(`[sdk/events] handler for '${eventType}' must be a function`);
        }
        const unsub = /** @type {import('../types.js').SessionEventSubscriber} */ (/** @type {unknown} */ (session)).on(
            eventType,
            handler,
        );
        unsubscribers.push(unsub);
    }

    return () => {
        for (const unsub of unsubscribers) {
            unsub();
        }
    };
}

/**
 * Subscreve a TODOS os eventos de uma sessão (wildcard).
 *
 * @example
 *     ```js
 *     const unsub = onAllSessionEvents(session, (evt) => {
 *     console.log(`[${evt.type}]`, evt.data);
 *     });
 *     ```
 *
 * @param {CopilotSession} session — sessão ativa do SDK
 * @param {SessionEventHandler} handler — callback para todos os eventos
 * @returns {() => void} função unsubscribe
 */
export function onAllSessionEvents(session, handler) {
    assertSession(session);
    if (typeof handler !== 'function') {
        throw new Error('[sdk/events] handler must be a function');
    }
    return /** @type {import('../types.js').SessionEventSubscriber} */ (/** @type {unknown} */ (session)).on(handler);
}

/**
 * Extrai o payload (`.data`) de um evento de sessão de forma tipada. Retorna `undefined` se o evento não tem `.data`.
 *
 * @example
 *     ```js
 *     onSessionEvent(session, SESSION_EVENTS.ASSISTANT_MESSAGE, (evt) => {
 *         const payload = getEventPayload(evt);
 *         console.log(payload?.content);
 *     });
 *     ```;
 *
 * @param {SessionEvent} event — evento de sessão
 * @returns {unknown} payload do evento (o campo `.data`)
 */
export function getEventPayload(event) {
    if (!event || typeof event !== 'object') {
        throw new Error('[sdk/events] event must be a non-null object');
    }
    return /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (event)).data;
}

/**
 * Extrai o tipo do evento.
 *
 * @param {SessionEvent} event — evento de sessão
 * @returns {string} tipo do evento
 */
export function getEventType(event) {
    if (!event || typeof event !== 'object') {
        throw new Error('[sdk/events] event must be a non-null object');
    }
    return /** @type {string} */ (/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (event)).type);
}

/**
 * Cria um filtro de eventos que aceita apenas os tipos especificados. Útil para compor com `onAllSessionEvents` para
 * filtering fino.
 *
 * @example
 *     ```js
 *     const filteredHandler = createEventFilter(
 *         [SESSION_EVENTS.ASSISTANT_MESSAGE, SESSION_EVENTS.SESSION_ERROR],
 *         (evt) => console.log(evt.type, evt.data)
 *     );
 *     const unsub = onAllSessionEvents(session, filteredHandler);
 *     ```;
 *
 * @param {readonly string[]} allowedTypes — tipos a aceitar
 * @param {SessionEventHandler} handler — callback para eventos aceitos
 * @returns {SessionEventHandler} handler filtrado
 */
export function createEventFilter(allowedTypes, handler) {
    if (!Array.isArray(allowedTypes) || allowedTypes.length === 0) {
        throw new Error('[sdk/events] allowedTypes must be a non-empty array');
    }
    if (typeof handler !== 'function') {
        throw new Error('[sdk/events] handler must be a function');
    }
    const allowSet = new Set(allowedTypes);
    return /** @param {SessionEvent} event */ (event) => {
        if (
            allowSet.has(
                /** @type {string} */ (/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (event)).type),
            )
        ) {
            handler(event);
        }
    };
}
