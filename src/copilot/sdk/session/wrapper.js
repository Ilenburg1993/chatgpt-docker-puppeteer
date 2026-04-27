// @ts-check
/**
 * src/copilot/sdk/session-lifecycle.js
 *
 * Wrappers de lifecycle para CopilotSession do SDK. Centraliza abort, setModel, getMessages, workspacePath e
 * asyncDispose com validação de sessão, logging e tratamento de erros padronizados.
 *
 * @module copilot/sdk/session-lifecycle
 * @see module:copilot/sdk/session
 */

import { toError } from '../../core/error-handlers.js';
import { toSdkOperationError } from '../errors.js';
import { log } from '../logger.js';
import { emitSdkOperationMetric } from '../telemetry/operation-metrics.js';

/**
 * @typedef {import('@github/copilot-sdk').CopilotSession} CopilotSession
 *
 * @typedef {import('@github/copilot-sdk').SessionEvent} SessionEvent
 *
 * @typedef {import('@github/copilot-sdk').AssistantMessageEvent} AssistantMessageEvent
 *
 * @typedef {import('@github/copilot-sdk').MessageOptions} MessageOptions
 *
 * @typedef {'low' | 'medium' | 'high'} ReasoningEffort
 */

// ─── Validação interna ────────────────────────────────────────────────────────

/**
 * Valida que a sessão é um objeto não-nulo com sessionId.
 *
 * @param {unknown} session
 * @param {string} caller
 * @returns {asserts session is CopilotSession}
 */
function assertSession(session, caller) {
    if (!session || typeof session !== 'object' || !('sessionId' in session)) {
        throw new TypeError(`[session-lifecycle/${caller}] Sessão inválida ou não fornecida.`);
    }
}

// ─── Wrappers públicos ────────────────────────────────────────────────────────

/**
 * Aborta a mensagem em processamento na sessão. A sessão permanece válida e pode continuar recebendo novas mensagens.
 *
 * @param {CopilotSession} session - Sessão ativa
 * @returns {Promise<void>}
 * @throws {TypeError} Se a sessão for inválida
 * @throws {Error} Se a sessão estiver desconectada ou abort falhar
 */
export async function abortSession(session) {
    assertSession(session, 'abort');
    log('INFO', `[session-lifecycle] Abortando mensagem: sessionId='${session.sessionId}'`);
    try {
        await session.abort();
    } catch (error) {
        throw toSdkOperationError('session.abort', error);
    }
    log('INFO', `[session-lifecycle] Abort concluído: sessionId='${session.sessionId}'`);
}

/**
 * Desconecta uma sessão ativa de forma padronizada.
 *
 * @param {CopilotSession} session - Sessão ativa
 * @returns {Promise<void>}
 * @throws {TypeError} Se a sessão for inválida
 * @throws {Error} Se o SDK falhar ao desconectar
 */
export async function disconnectSessionSafe(session) {
    assertSession(session, 'disconnect');
    log('INFO', `[session-lifecycle] Desconectando sessão: sessionId='${session.sessionId}'`);
    try {
        await session.disconnect();
    } catch (error) {
        throw toSdkOperationError('session.disconnect', error);
    }
    log('INFO', `[session-lifecycle] Sessão desconectada: sessionId='${session.sessionId}'`);
}

/**
 * Envia uma mensagem para a sessão e aguarda resposta final do assistente.
 *
 * Wrapper canônico para `session.sendAndWait(...)`, centralizando validação e logging.
 *
 * @param {CopilotSession} session - Sessão ativa
 * @param {MessageOptions} messageOptions - Payload de mensagem
 * @param {number} [timeoutMs] - Timeout opcional (ms)
 * @returns {Promise<AssistantMessageEvent | undefined>}
 * @throws {TypeError} Se a sessão for inválida
 * @throws {Error} Se a operação falhar
 */
export async function sendSessionAndWait(session, messageOptions, timeoutMs) {
    assertSession(session, 'sendAndWait');
    const hasTimeout = typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0;
    log(
        'DEBUG',
        `[session-lifecycle] sendAndWait: sessionId='${session.sessionId}', timeout=${hasTimeout ? String(timeoutMs) : 'none'}`,
    );
    const startedAt = Date.now();
    emitSdkOperationMetric({ operation: 'session.sendAndWait', status: 'started', sessionId: session.sessionId });
    /** @type {AssistantMessageEvent | undefined} */
    let event;
    try {
        event = hasTimeout
            ? await session.sendAndWait(messageOptions, timeoutMs)
            : await session.sendAndWait(messageOptions);
    } catch (error) {
        const sdkError = toSdkOperationError('session.sendAndWait', error);
        emitSdkOperationMetric({
            operation: 'session.sendAndWait',
            status: 'failed',
            sessionId: session.sessionId,
            durationMs: Date.now() - startedAt,
            attributes: { errorKind: sdkError.kind },
        });
        throw sdkError;
    }
    emitSdkOperationMetric({
        operation: 'session.sendAndWait',
        status: 'succeeded',
        sessionId: session.sessionId,
        durationMs: Date.now() - startedAt,
        attributes: { hasAssistantMessage: Boolean(event) },
    });
    log('DEBUG', `[session-lifecycle] sendAndWait concluído: sessionId='${session.sessionId}'`);
    return event;
}

/**
 * Envia uma mensagem para a sessão sem aguardar resposta (modo streaming / fire-and-subscribe).
 *
 * Wrapper canônico para `session.send(...)`. Use quando o fluxo de resposta é consumido via inscrição de eventos
 * separadamente.
 *
 * @param {CopilotSession} session - Sessão ativa
 * @param {MessageOptions} messageOptions - Payload de mensagem
 * @returns {Promise<string | undefined>} messageId retornado pelo SDK
 * @throws {TypeError} Se a sessão for inválida
 * @throws {Error} Se a operação falhar
 */
export async function sendSession(session, messageOptions) {
    assertSession(session, 'send');
    log('DEBUG', `[session-lifecycle] send: sessionId='${session.sessionId}'`);
    let messageId;
    try {
        messageId = await session.send(messageOptions);
    } catch (error) {
        throw toSdkOperationError('session.send', error);
    }
    log(
        'DEBUG',
        `[session-lifecycle] send enfileirado: sessionId='${session.sessionId}', messageId=${messageId ?? 'n/a'}`,
    );
    return messageId;
}

/**
 * Altera o modelo da sessão. O novo modelo toma efeito na próxima mensagem. O histórico de conversação é preservado.
 *
 * @param {CopilotSession} session - Sessão ativa
 * @param {string} model - ID do modelo (ex: 'gpt-4.1', 'claude-sonnet-4-5')
 * @param {{ reasoningEffort?: ReasoningEffort }} [options] - Opções do novo modelo
 * @returns {Promise<void>}
 * @throws {TypeError} Se a sessão for inválida ou model não for string
 * @throws {Error} Se a comunicação com o SDK falhar
 */
export async function setSessionModel(session, model, options) {
    assertSession(session, 'setModel');
    if (typeof model !== 'string' || model.length === 0) {
        throw new TypeError('[session-lifecycle/setModel] model deve ser string não-vazia.');
    }
    log('INFO', `[session-lifecycle] setModel: sessionId='${session.sessionId}', model='${model}'`);
    const startedAt = Date.now();
    emitSdkOperationMetric({
        operation: 'session.setModel',
        status: 'started',
        sessionId: session.sessionId,
        attributes: { model },
    });
    try {
        await session.setModel(model, options);
    } catch (error) {
        const sdkError = toSdkOperationError('session.setModel', error);
        emitSdkOperationMetric({
            operation: 'session.setModel',
            status: 'failed',
            sessionId: session.sessionId,
            durationMs: Date.now() - startedAt,
            attributes: { model, errorKind: sdkError.kind },
        });
        throw sdkError;
    }
    emitSdkOperationMetric({
        operation: 'session.setModel',
        status: 'succeeded',
        sessionId: session.sessionId,
        durationMs: Date.now() - startedAt,
        attributes: { model },
    });
    log('INFO', `[session-lifecycle] Modelo alterado para '${model}': sessionId='${session.sessionId}'`);
}

/**
 * Retorna o histórico completo de eventos/mensagens da sessão.
 *
 * @param {CopilotSession} session - Sessão ativa
 * @returns {Promise<SessionEvent[]>}
 * @throws {TypeError} Se a sessão for inválida
 * @throws {Error} Se a sessão estiver desconectada
 */
export async function getSessionMessages(session) {
    assertSession(session, 'getMessages');
    log('DEBUG', `[session-lifecycle] getMessages: sessionId='${session.sessionId}'`);
    let messages;
    try {
        messages = await session.getMessages();
    } catch (error) {
        throw toSdkOperationError('session.getMessages', error);
    }
    log(
        'DEBUG',
        `[session-lifecycle] getMessages retornou ${messages.length} eventos: sessionId='${session.sessionId}'`,
    );
    return messages;
}

/**
 * Retorna o caminho do workspace da sessão (quando infinite sessions está habilitado). Contém checkpoints/, plan.md e
 * files/.
 *
 * @param {CopilotSession} session - Sessão ativa
 * @returns {string | undefined}
 * @throws {TypeError} Se a sessão for inválida
 */
export function getSessionWorkspacePath(session) {
    assertSession(session, 'workspacePath');
    return session.workspacePath;
}

/**
 * Dispose assíncrono da sessão. Equivale a `session[Symbol.asyncDispose]()`. Útil para cleanup programático quando
 * `await using` não é viável.
 *
 * @param {CopilotSession} session - Sessão a ser descartada
 * @returns {Promise<void>}
 * @throws {TypeError} Se a sessão for inválida
 * @throws {Error} Se a comunicação falhar
 */
export async function disposeSession(session) {
    assertSession(session, 'dispose');
    log('INFO', `[session-lifecycle] Disposing sessão: sessionId='${session.sessionId}'`);
    try {
        await session[Symbol.asyncDispose]();
    } catch (error) {
        throw toSdkOperationError('session.dispose', error);
    }
    log('INFO', `[session-lifecycle] Sessão disposed: sessionId='${session.sessionId}'`);
}

/**
 * Executa ciclo completo: create → use → abort → disconnect. Wrapper de conveniência para testes e scripts one-shot.
 *
 * @param {object} params
 * @param {() => Promise<CopilotSession>} params.create - Factory que cria/retoma a sessão
 * @param {(session: CopilotSession) => Promise<void>} params.use - Lógica de uso da sessão
 * @param {{ abortOnError?: boolean; forceDispose?: boolean }} [params.options]
 * @returns {Promise<{ session: CopilotSession; aborted: boolean; error: Error | undefined }>}
 */
export async function runSessionLifecycle({ create, use, options }) {
    const opts = options ?? {};
    const session = await create();
    let aborted = false;
    /** @type {Error | undefined} */
    let error;

    try {
        await use(session);
    } catch (e) {
        error = toError(e);
        if (opts.abortOnError !== false) {
            try {
                await abortSession(session);
                aborted = true;
            } catch (abortErr) {
                log('WARN', `[session-lifecycle] abort após erro falhou: ${toError(abortErr).message}`);
            }
        }
    } finally {
        try {
            if (opts.forceDispose) {
                await disposeSession(session);
            } else {
                await disconnectSessionSafe(session);
            }
        } catch (cleanupErr) {
            log('WARN', `[session-lifecycle] cleanup falhou: ${toError(cleanupErr).message}`);
        }
    }

    /** @type {{ session: CopilotSession; aborted: boolean; error: Error | undefined }} */
    const result = { session, aborted, error };
    return result;
}
