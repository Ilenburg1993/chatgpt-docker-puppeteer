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
import { EMITTER_SESSION_ERROR } from '#copilot/events';
import { toError } from '#copilot/core';
import { log } from '#copilot/agent/ports/logging-port';

// Re-exportar KNOWN_SDK_EVENTS para consumidores existentes
export { KNOWN_SDK_EVENTS } from '#copilot/event-handlers';

/** @typedef {import('#copilot/event-handlers/contracts').CopilotSessionLike} CopilotSessionLike */
/** @typedef {import('#copilot/sdk/types').CopilotSession} CopilotSession */
/** @typedef {import('#copilot/event-handlers/contracts').SessionWirerCallbacks} SessionWirerCallbacks */

/**
 * O SDK também pode emitir o evento especial `error` do EventEmitter. Esse evento não é garantido pelo wildcard
 * `session.on(handler)` e, sem listener explícito, o Node o promove para uncaughtException.
 *
 * @param {CopilotSession} session
 * @param {Pick<SessionWirerCallbacks, 'emit'>} callbacks
 * @returns {() => void}
 */
function wireRawSessionErrorEvent(session, callbacks) {
    const candidate = /** @type {{ on?: (...args: unknown[]) => unknown; off?: (...args: unknown[]) => void }} */ (
        /** @type {unknown} */ (session)
    );
    if (typeof candidate.on !== 'function') {
        return () => {};
    }

    /** @param {unknown} rawError */
    const onRawError = (rawError) => {
        const error = toError(rawError);
        log('WARN', `[session-wiring] raw SDK error event: ${error.message}`);
        try {
            callbacks.emit(EMITTER_SESSION_ERROR, {
                errorType: 'raw_sdk_error',
                message: error.message,
                ts: Date.now(),
            });
        } catch (emitError) {
            log('WARN', `[session-wiring] raw SDK error emit falhou: ${toError(emitError).message}`);
        }
    };

    try {
        const maybeUnsubscribe = candidate.on.call(session, 'error', onRawError);
        if (typeof maybeUnsubscribe === 'function') {
            return /** @type {() => void} */ (maybeUnsubscribe);
        }
        return () => {
            try {
                candidate.off?.call(session, 'error', onRawError);
            } catch (error) {
                log('WARN', `[session-wiring] raw SDK error unsubscribe falhou: ${toError(error).message}`);
            }
        };
    } catch (error) {
        log('WARN', `[session-wiring] raw SDK error listener indisponível: ${toError(error).message}`);
        return () => {};
    }
}

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
        wireRawSessionErrorEvent(session, callbacks),
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
