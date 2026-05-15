// @ts-check
/**
 * Helpers de envio de mensagens para sessões SDK.
 *
 * Esta camada é deliberadamente direta: qualquer chamada aqui chega a `sendSession()` e pode produzir
 * `assistant.usage`/`pr.consumed`. O caminho zero-PR do terminal é outro: mailbox de intervenção + drenagem em
 * `ask_user(kind=question)`.
 */

/**
 * @typedef {ReturnType<import('./deps.js').resolveSdkRouteSharedDeps>} SdkRouteDeps
 *
 * @typedef {{ type?: string; data?: { message?: string; stack?: string }; [key: string]: unknown }} RouteSessionEvent
 *
 * @typedef {{ prompt: string; attachments?: unknown; mode?: unknown; [key: string]: unknown }} RouteMessageOptions
 *
 * @typedef {RouteSessionEvent & { type: 'assistant.message' }} RouteAssistantMessageEvent
 */

// C14-04: limite máximo de bytes aceitos em prompt para evitar uso excessivo de tokens
export const MAX_PROMPT_BYTES = 512_000;

/**
 * @param {SdkRouteDeps} routeDeps
 * @param {NonNullable<ReturnType<SdkRouteDeps['sdkSession']['getClientSession']>>['session']} session
 * @param {RouteMessageOptions} messageOptions
 * @returns {Promise<RouteAssistantMessageEvent | undefined>}
 */
export async function sendAndWaitWithoutTimeout(routeDeps, session, messageOptions) {
    /** @type {RouteAssistantMessageEvent | undefined} */
    let lastAssistantMessage;

    /** @type {() => void} */
    let resolveIdle = () => {};
    /** @type {(error: Error) => void} */
    let rejectIdle = () => {};

    const idlePromise = new Promise((resolve, reject) => {
        resolveIdle = () => resolve(undefined);
        rejectIdle = (error) => reject(error);
    });

    const unsubscribe = routeDeps.sdkSessionEvents.onAllSessionEvents(
        session,
        (/** @type {RouteSessionEvent} */ event) => {
            if (event.type === 'assistant.message') {
                lastAssistantMessage = /** @type {RouteAssistantMessageEvent} */ (event);
            } else if (event.type === 'session.idle') {
                resolveIdle();
            } else if (event.type === 'session.error') {
                const error = new Error(event.data?.message ?? 'Erro desconhecido na sessão SDK.');
                if (event.data?.stack) error.stack = event.data.stack;
                rejectIdle(error);
            }
        },
    );

    try {
        await routeDeps.sdkSessionRuntime.sendSession(session, /** @type {never} */ (messageOptions));
        await idlePromise;
        return lastAssistantMessage;
    } finally {
        unsubscribe();
    }
}
