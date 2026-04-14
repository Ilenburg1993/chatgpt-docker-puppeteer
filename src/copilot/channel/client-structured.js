// @ts-check
/**
 * src/copilot/channel/client-structured.js
 *
 * Protocolo chatStructured extraído de LlmBridgeClient.
 *
 * @module copilot/channel/client-structured
 * @see EventBus
 */

import { buildStructuredRequest, parseStructuredResponse, serializeStructuredMessage } from '#copilot/core';
import { log } from '#copilot/observability';

/**
 * @typedef {import('./client.js').ChatResult} ChatResult
 *
 * @typedef {import('./client.js').ChatOptions} ChatOptions
 */

/**
 * Envia uma mensagem estruturada (protocolo Sprint A) e tenta parsear a resposta.
 *
 * @param {{
 *     chat: (msg: string, opts?: ChatOptions) => Promise<ChatResult>;
 *     getSessionId: () => string | undefined;
 * }} deps
 * @param {import('#copilot/core/structured-message').StructuredMessageInput} input
 * @param {ChatOptions & { turnNumber?: number; sessionId?: string }} [opts]
 * @returns {Promise<import('#copilot/core/structured-message').StructuredChatResult>}
 */
export async function chatStructured(deps, input, opts = {}) {
    const { turnNumber, sessionId, ...chatOpts } = opts;

    const effectiveSessionId = sessionId ?? deps.getSessionId();
    const msg = buildStructuredRequest({
        ...input,
        ...(turnNumber !== undefined ? { turnNumber } : {}),
        ...(effectiveSessionId ? { sessionId: effectiveSessionId } : {}),
    });

    const serialized = serializeStructuredMessage(msg);
    const chatResult = await deps.chat(serialized, chatOpts);

    let structured = parseStructuredResponse(chatResult.response);

    // F11.5: segunda tentativa quando resposta não é estruturada em sessões novas
    if (chatResult.response && !structured) {
        log(
            'DEBUG',
            '[LlmBridgeClient] chatStructured: resposta não-estruturada — tentando novamente com instrução explícita.',
        );
        const retryPrompt =
            `Por favor responda APENAS com JSON válido no formato StructuredMessage.\n` +
            `Não inclua texto, markdown ou explicações fora do JSON.\n` +
            `Minha mensagem anterior foi:\n${serialized}`;
        const retryResult = await deps.chat(retryPrompt, chatOpts);
        const retryStructured = parseStructuredResponse(retryResult.response);
        if (retryStructured) {
            log('INFO', '[LlmBridgeClient] chatStructured: segunda tentativa bem-sucedida.');
            structured = retryStructured;
            Object.assign(chatResult, {
                response: retryResult.response,
                responseLen: retryResult.responseLen,
                durationMs: chatResult.durationMs + retryResult.durationMs,
                chunks: [...chatResult.chunks, ...retryResult.chunks],
                taskId: retryResult.taskId,
            });
        }
    }

    /** @type {Error | undefined} */
    let parseError;
    if (chatResult.response && !structured) {
        parseError = new Error(
            `Resposta não é StructuredMessage válido (${chatResult.responseLen ?? chatResult.response.length} chars)`,
        );
    }

    log(
        'INFO',
        `[LlmBridgeClient] chatStructured: responseType=${structured?.responseType ?? 'UNSTRUCTURED'}, ` +
            `output=${structured?.output?.length ?? 0} chars`,
    );

    return {
        structured,
        raw: chatResult.response,
        taskId: chatResult.taskId,
        responseLen: chatResult.responseLen,
        chunks: chatResult.chunks,
        durationMs: chatResult.durationMs,
        ...(parseError !== undefined ? { parseError } : {}),
    };
}
