// @ts-check
/**
 * src/copilot/sdk/session-lifecycle.js
 *
 * Wrappers de lifecycle para CopilotSession do SDK. Centraliza abort, setModel, getMessages, workspacePath e
 * asyncDispose com validação de sessão, logging e tratamento de erros padronizados.
 *
 * @module copilot/sdk/session-lifecycle
 * @see EventBus
 * @see module:copilot/sdk/session
 */

import { log } from './logger.js';

/**
 * @typedef {import('@github/copilot-sdk').CopilotSession} CopilotSession
 *
 * @typedef {import('@github/copilot-sdk').SessionEvent} SessionEvent
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
    await session.abort();
    log('INFO', `[session-lifecycle] Abort concluído: sessionId='${session.sessionId}'`);
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
    await session.setModel(model, options);
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
    const messages = await session.getMessages();
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
    await session[Symbol.asyncDispose]();
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
    } catch (/** @type {any} */ e) {
        error = e;
        if (opts.abortOnError !== false) {
            try {
                await abortSession(session);
                aborted = true;
            } catch (/** @type {any} */ abortErr) {
                log('WARN', `[session-lifecycle] abort após erro falhou: ${abortErr.message}`);
            }
        }
    } finally {
        try {
            if (opts.forceDispose) {
                await disposeSession(session);
            } else {
                await session.disconnect();
            }
        } catch (/** @type {any} */ cleanupErr) {
            log('WARN', `[session-lifecycle] cleanup falhou: ${cleanupErr.message}`);
        }
    }

    /** @type {{ session: CopilotSession; aborted: boolean; error: Error | undefined }} */
    const result = { session, aborted, error };
    return result;
}
