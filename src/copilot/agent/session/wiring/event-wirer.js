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

/**
 * Tipo mínimo de sessão SDK usado pelos handlers — compatível com CopilotSession.
 *
 * @typedef {import('#copilot/sdk/types').CopilotSession} CopilotSessionLike
 */

/**
 * @typedef {import('#copilot/sdk/types').CopilotSession} CopilotSession
 */

/**
 * Callbacks repassados pelo AlwaysAliveAgent para que o wirer possa notificá-lo sem acoplamento.
 *
 * @typedef {Object} SessionWirerCallbacks
 * @property {(event: string, payload?: unknown) => void} emit
 * @property {() => import('../../types.js').AgentStatusSnapshot} getStatusSnapshot
 * @property {(path: string) => void} onCheckpointPath
 * @property {(contextState: { tokens: number; tokenLimit: number; utilization: number } | null) => void} onContextState
 * @property {(prInfo: {
 *     model?: string;
 *     configuredModel?: string;
 *     modelMismatch?: boolean;
 *     sessionId?: string | null;
 *     cost?: number;
 *     quotaSnapshots?: Record<string, unknown>;
 *     ts: number;
 * }) => void} onPrInfo
 * @property {() => boolean} isProcessing
 * @property {() => boolean} dialogLoopActive
 */

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
