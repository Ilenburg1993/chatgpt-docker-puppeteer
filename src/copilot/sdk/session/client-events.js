// @ts-check
/**
 * src/copilot/sdk/client-events.js
 *
 * Faixa 11 - Session Lifecycle Events tipados. Abstrai `client.on(eventType, handler)` para os 5 lifecycle events do
 * CopilotClient.
 *
 * Lifecycle events (emitidos pelo CLIENT, não pela session):
 *
 * - `session.created` - nova sessão criada
 * - `session.deleted` - sessão removida
 * - `session.updated` - sessão atualizada (metadata changed)
 * - `session.foreground` - sessão movida para foreground (TUI+server mode)
 * - `session.background` - sessão movida para background
 *
 * @module copilot/sdk/client-events
 * @see EventBus
 */

import { getClientSnapshot } from './client.js';

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * @typedef {import('@github/copilot-sdk').CopilotClient} CopilotClient
 */

/**
 * @typedef {'session.created' | 'session.deleted' | 'session.updated' | 'session.foreground' | 'session.background'} LifecycleEventType
 */

/**
 * @typedef {object} LifecycleEvent
 * @property {LifecycleEventType} type - tipo do evento
 * @property {string} sessionId - ID da sessão relacionada
 * @property {{ startTime: string; modifiedTime: string; summary?: string }} [metadata] - metadados (ausente em deleted)
 */

/**
 * @typedef {(event: LifecycleEvent) => void} LifecycleHandler
 */

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Mapa dos 5 lifecycle event types do CopilotClient.
 *
 * @type {Readonly<{
 *     CREATED: 'session.created';
 *     DELETED: 'session.deleted';
 *     UPDATED: 'session.updated';
 *     FOREGROUND: 'session.foreground';
 *     BACKGROUND: 'session.background';
 * }>}
 */
export const LIFECYCLE_EVENTS = Object.freeze(
    /** @type {const} */ ({
        CREATED: 'session.created',
        DELETED: 'session.deleted',
        UPDATED: 'session.updated',
        FOREGROUND: 'session.foreground',
        BACKGROUND: 'session.background',
    }),
);

/**
 * Set de todos os lifecycle event types para validação rápida.
 *
 * @type {ReadonlySet<string>}
 */
const LIFECYCLE_TYPE_SET = new Set(Object.values(LIFECYCLE_EVENTS));

// ─── Internal Helpers ─────────────────────────────────────────────────────────

/**
 * Asserts que o client é válido e possui `.on()`.
 *
 * @param {unknown} client
 * @returns {asserts client is CopilotClient}
 */
function assertClient(client) {
    if (!client || typeof client !== 'object') {
        throw new Error('[sdk/client-events] client is required');
    }
    if (typeof (/** @type {Record<string, unknown>} */ (client)['on']) !== 'function') {
        throw new Error('[sdk/client-events] client must have an .on() method');
    }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Verifica se um event type é um lifecycle event válido.
 *
 * @param {string} eventType - tipo de evento a verificar
 * @returns {boolean}
 */
export function isLifecycleEventType(eventType) {
    return LIFECYCLE_TYPE_SET.has(eventType);
}

/**
 * Subscreve a um lifecycle event específico do CopilotClient.
 *
 * @example
 *     ```js
 *     const unsub = onLifecycleEvent(LIFECYCLE_EVENTS.CREATED, (evt) => {
 *         console.log('Nova sessão criada:', evt.sessionId);
 *     });
 *     unsub(); // parar de ouvir
 *     ```;
 *
 * @param {string} eventType - tipo de lifecycle event (e.g. 'session.created')
 * @param {LifecycleHandler} handler - callback
 * @param {CopilotClient} [client] - client opcional; se omitido, usa o client já inicializado/injetado.
 * @returns {() => void} função unsubscribe
 */
export function onLifecycleEvent(eventType, handler, client) {
    const c = client ?? getClientSnapshot();
    assertClient(c);
    if (typeof eventType !== 'string' || eventType.length === 0) {
        throw new Error('[sdk/client-events] eventType must be a non-empty string');
    }
    if (typeof handler !== 'function') {
        throw new Error('[sdk/client-events] handler must be a function');
    }
    return /** @type {import('../types.js').ClientEventSubscriber} */ (/** @type {unknown} */ (c)).on(
        eventType,
        handler,
    );
}

/**
 * Subscreve a TODOS os lifecycle events do CopilotClient (wildcard).
 *
 * @example
 *     ```js
 *     const unsub = onAllLifecycleEvents((evt) => {
 *     console.log(`[${evt.type}] session ${evt.sessionId}`);
 *     });
 *     ```
 *
 * @param {LifecycleHandler} handler - callback
 * @param {CopilotClient} [client] - client opcional; se omitido, usa o client já inicializado/injetado.
 * @returns {() => void} função unsubscribe
 */
export function onAllLifecycleEvents(handler, client) {
    const c = client ?? getClientSnapshot();
    assertClient(c);
    if (typeof handler !== 'function') {
        throw new Error('[sdk/client-events] handler must be a function');
    }
    return /** @type {import('../types.js').ClientEventSubscriber} */ (/** @type {unknown} */ (c)).on(handler);
}

/**
 * Subscreve a múltiplos lifecycle events de uma vez.
 *
 * @example
 *     ```js
 *     const unsub = onLifecycleEvents({
 *         [LIFECYCLE_EVENTS.CREATED]: (evt) => console.log('criada', evt.sessionId),
 *         [LIFECYCLE_EVENTS.DELETED]: (evt) => console.log('removida', evt.sessionId),
 *     });
 *     ```;
 *
 * @param {Record<string, LifecycleHandler>} handlerMap - mapa de eventType → handler
 * @param {CopilotClient} [client] - client opcional; se omitido, usa o client já inicializado/injetado.
 * @returns {() => void} função que chama unsubscribe de todos
 */
export function onLifecycleEvents(handlerMap, client) {
    const c = client ?? getClientSnapshot();
    assertClient(c);
    if (!handlerMap || typeof handlerMap !== 'object') {
        throw new Error('[sdk/client-events] handlerMap must be a non-null object');
    }
    const entries = Object.entries(handlerMap);
    if (entries.length === 0) {
        throw new Error('[sdk/client-events] handlerMap must have at least one entry');
    }

    /** @type {(() => void)[]} */
    const unsubscribers = [];
    for (const [eventType, handler] of entries) {
        if (typeof handler !== 'function') {
            throw new Error(`[sdk/client-events] handler for '${eventType}' must be a function`);
        }
        const unsub = /** @type {import('../types.js').ClientEventSubscriber} */ (/** @type {unknown} */ (c)).on(
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
 * Convenience: subscreve ao `session.created` event.
 *
 * @param {LifecycleHandler} handler
 * @param {CopilotClient} [client]
 * @returns {() => void}
 */
export function onSessionCreated(handler, client) {
    return onLifecycleEvent(LIFECYCLE_EVENTS.CREATED, handler, client);
}

/**
 * Convenience: subscreve ao `session.deleted` event.
 *
 * @param {LifecycleHandler} handler
 * @param {CopilotClient} [client]
 * @returns {() => void}
 */
export function onSessionDeleted(handler, client) {
    return onLifecycleEvent(LIFECYCLE_EVENTS.DELETED, handler, client);
}

/**
 * Convenience: subscreve ao `session.updated` event.
 *
 * @param {LifecycleHandler} handler
 * @param {CopilotClient} [client]
 * @returns {() => void}
 */
export function onSessionUpdated(handler, client) {
    return onLifecycleEvent(LIFECYCLE_EVENTS.UPDATED, handler, client);
}

/**
 * Convenience: subscreve ao `session.foreground` event.
 *
 * @param {LifecycleHandler} handler
 * @param {CopilotClient} [client]
 * @returns {() => void}
 */
export function onSessionForeground(handler, client) {
    return onLifecycleEvent(LIFECYCLE_EVENTS.FOREGROUND, handler, client);
}

/**
 * Convenience: subscreve ao `session.background` event.
 *
 * @param {LifecycleHandler} handler
 * @param {CopilotClient} [client]
 * @returns {() => void}
 */
export function onSessionBackground(handler, client) {
    return onLifecycleEvent(LIFECYCLE_EVENTS.BACKGROUND, handler, client);
}
