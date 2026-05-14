// @ts-check
/**
 * src/copilot/agent/session/wiring/event-wirer.js
 *
 * Orquestrador de event handlers SDK — delega para módulos em `event-handlers/`.
 *
 * F62: Refatorado de 591L monolítico para orquestrador fino (~90L) + 8 handler files.
 *
 * @module copilot/agent/session/event-wirer
 * @see EventBus
 */

import {
    wireCatchAll,
    wireCompactionEvents,
    wireInteractionEvents,
    wireMcpEvents,
    wireModeAndToolEvents,
    wireSdkResponseEvents,
    wireSessionLifecycleEvents,
    wireStreamingEvents,
    wireSystemNotificationEvents,
    wireTokenBudgetEvents,
    wireToolLifecycleEvents,
    wireUsageEvent,
} from '#copilot/event-handlers';

// Re-exportar KNOWN_SDK_EVENTS para consumidores existentes
export { KNOWN_SDK_EVENTS } from '#copilot/event-handlers';

/** @typedef {import('#copilot/event-handlers/contracts').CopilotSessionLike} CopilotSessionLike */
/** @typedef {import('#copilot/sdk/types').CopilotSession} CopilotSession */
/** @typedef {import('#copilot/event-handlers/contracts').SessionWirerCallbacks} SessionWirerCallbacks */

/**
 * Registra todos os listeners de eventos da sessão SDK.
 *
 * @param {CopilotSession} session
 * @param {boolean} isResumed
 * @param {SessionWirerCallbacks} callbacks
 * @returns {(() => void)[]}
 */
export function wireSessionEvents(session, isResumed, callbacks) {
    return [
        ...wireCompactionEvents(session, callbacks),
        ...wireStreamingEvents(session, callbacks),
        ...wireTokenBudgetEvents(session, isResumed, callbacks),
        ...wireModeAndToolEvents(session, callbacks),
        ...wireSystemNotificationEvents(session, callbacks),
        ...wireSdkResponseEvents(session, callbacks),
        ...wireSessionLifecycleEvents(session, callbacks),
        ...wireMcpEvents(session, callbacks),
        ...wireToolLifecycleEvents(session, callbacks),
        ...wireInteractionEvents(session, callbacks),
        wireUsageEvent(session, callbacks),
        wireCatchAll(session),
    ];
}
