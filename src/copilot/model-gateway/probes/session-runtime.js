// @ts-check
/**
 * Porta mínima de sessão para probes Model Gateway.
 *
 * O domínio de probes não deve conhecer `CopilotSession`: ele só precisa abrir uma sessão descartável, observar
 * eventos, enviar uma mensagem e, no caminho de erro do chat probe, abortar a mensagem ativa. O adapter default
 * concentra os casts para a implementação concreta do SDK numa única borda.
 *
 * @module copilot/model-gateway/probes/session-runtime
 */

import { abortSession, onSessionEvents, sendSessionAndWait, withEphemeralSession } from '#copilot/sdk/session';

/**
 * @typedef {{ session: unknown; sessionId: string }} ModelGatewayProbeSessionHandle
 *
 * @typedef {{ data?: { content?: string } }} ModelGatewayProbeAssistantReply
 *
 * @typedef {{
 *     withSession: (
 *         options: Partial<import('../../sdk/session/lifecycle.js').SessionCreateOptions>,
 *         callback: (handle: ModelGatewayProbeSessionHandle) => Promise<void> | void,
 *     ) => Promise<void>;
 *     subscribe: (session: unknown, handlers: Parameters<typeof onSessionEvents>[1]) => () => void;
 *     sendAndWait: (
 *         session: unknown,
 *         message: import('@github/copilot-sdk').MessageOptions,
 *         timeoutMs: number,
 *     ) => Promise<ModelGatewayProbeAssistantReply | undefined>;
 *     abort: (session: unknown) => Promise<void>;
 * }} ModelGatewayProbeSessionRuntime
 */

/** @type {ModelGatewayProbeSessionRuntime} */
export const DEFAULT_MODEL_GATEWAY_PROBE_SESSION_RUNTIME = Object.freeze({
    async withSession(options, callback) {
        await withEphemeralSession(options, async ({ session, sessionId }) => {
            await callback({ session, sessionId });
        });
    },
    subscribe(session, handlers) {
        return onSessionEvents(/** @type {Parameters<typeof onSessionEvents>[0]} */ (session), handlers);
    },
    sendAndWait(session, message, timeoutMs) {
        return sendSessionAndWait(
            /** @type {Parameters<typeof sendSessionAndWait>[0]} */ (session),
            message,
            timeoutMs,
        );
    },
    async abort(session) {
        await abortSession(/** @type {Parameters<typeof abortSession>[0]} */ (session));
    },
});
