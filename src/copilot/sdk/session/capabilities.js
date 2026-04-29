// @ts-check
/**
 * Helpers para observar capabilities de uma sessão Copilot SDK.
 *
 * @module copilot/sdk/session/capabilities
 */

import { SESSION_EVENTS } from '../constants.js';
import { onSessionEvent } from './events.js';

/**
 * @typedef {import('@github/copilot-sdk').CopilotSession} CopilotSession
 *
 * @typedef {import('@github/copilot-sdk').SessionCapabilities} SessionCapabilities
 *
 * @typedef {Extract<import('@github/copilot-sdk').SessionEvent, { type: 'capabilities.changed' }>} CapabilitiesChangedEvent
 */

/**
 * @param {unknown} session
 * @returns {asserts session is CopilotSession}
 */
function assertSession(session) {
    if (!session || typeof session !== 'object') {
        throw new TypeError('[sdk/capabilities] sessão inválida ou não fornecida');
    }
}

/**
 * Retorna snapshot defensivo das capabilities conhecidas da sessão.
 *
 * @param {CopilotSession} session
 * @returns {SessionCapabilities}
 */
export function getSessionCapabilities(session) {
    assertSession(session);
    return /** @type {SessionCapabilities} */ ({ ...(session.capabilities ?? {}) });
}

/**
 * Verifica se a sessão suporta elicitation UI.
 *
 * @param {CopilotSession} session
 * @returns {boolean}
 */
export function supportsElicitation(session) {
    return getSessionCapabilities(session).ui?.elicitation === true;
}

/**
 * Observa `capabilities.changed` e repassa o snapshot efetivo após cada mudança.
 *
 * @param {CopilotSession} session
 * @param {(capabilities: SessionCapabilities, event: CapabilitiesChangedEvent) => void} onChange
 * @returns {() => void}
 */
export function watchCapabilities(session, onChange) {
    assertSession(session);
    if (typeof onChange !== 'function') {
        throw new TypeError('[sdk/capabilities] onChange deve ser função');
    }
    return onSessionEvent(session, SESSION_EVENTS.CAPABILITIES_CHANGED, (event) => {
        onChange(getSessionCapabilities(session), /** @type {CapabilitiesChangedEvent} */ (event));
    });
}

/**
 * Aguarda até que a sessão anuncie suporte a elicitation, retornando imediatamente se já estiver disponível.
 *
 * @param {CopilotSession} session
 * @param {{ timeoutMs?: number | null; signal?: AbortSignal }} [opts]
 * @returns {Promise<SessionCapabilities>}
 */
export function waitForElicitationCapability(session, opts = {}) {
    assertSession(session);
    if (supportsElicitation(session)) return Promise.resolve(getSessionCapabilities(session));

    const { timeoutMs = 30_000, signal } = opts;
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException('Aborted', 'AbortError'));
            return;
        }

        /** @type {ReturnType<typeof setTimeout> | null} */
        let timer = null;
        /** @type {() => void} */
        let unsubscribe = () => {};

        const cleanup = () => {
            unsubscribe();
            if (timer !== null) clearTimeout(timer);
            signal?.removeEventListener('abort', onAbort);
        };

        const onAbort = () => {
            cleanup();
            reject(new DOMException('Aborted', 'AbortError'));
        };

        unsubscribe = watchCapabilities(session, (capabilities) => {
            if (capabilities.ui?.elicitation === true) {
                cleanup();
                resolve(capabilities);
            }
        });

        if (timeoutMs !== null) {
            timer = setTimeout(() => {
                cleanup();
                reject(new Error(`waitForElicitationCapability timeout após ${timeoutMs}ms`));
            }, timeoutMs);
        }
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}
