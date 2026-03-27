// @ts-check
/**
 * src/copilot/channel/client.js
 *
 * LLM Bridge Client — camada conversacional de alto nível sobre o AlwaysAliveAgent.
 *
 * Permite que LLM-A (este agente) se comunique continuamente com LLM-B (Copilot SDK) dentro de uma sessão infinita, com
 * suporte a:
 *
 * - Envio de mensagens com coleta de tokens em streaming (task.delta)
 * - Histórico de conversa estruturado (turn-by-turn)
 * - Resposta automática ou manual a perguntas pendentes (onUserInputRequest)
 * - Callbacks por evento: onDelta, onComplete, onQuestion
 * - Protocolo StructuredMessage (Sprint A): chatStructured() para comunicação tipada LLM-A ↔ LLM-B
 *
 * @module copilot/channel/client
 *
 * @example
 *     ```js
 *     import { LlmBridgeClient } from '#copilot/channel';
 *
 *     const bridge = new LlmBridgeClient();
 *     const reply = await bridge.chat('Explique monads em uma linha.');
 *     console.log(reply.response);
 *     console.log(bridge.history);
 *
 *     // Protocolo estruturado:
 *     const result = await bridge.chatStructured({
 *         context: 'Sprint A implementado.',
 *         intent: 'Confirmar que novos testes passam',
 *         priority: 'high',
 *         responseType: 'diagnostic',
 *     });
 *     if (result.structured) console.log('Diagnóstico:', result.structured.output);
 *     ```;
 */

import {
    buildStructuredRequest,
    parseStructuredResponse,
    serializeStructuredMessage,
} from '#copilot/types/structured-message';
import { log } from '#core/logger';
import { alwaysAliveAgent } from '../agent/always-alive.js';

// ─── Tipos ────────────────────────────────────────────────────────────────────

/**
 * Uma entrada no histórico de conversa.
 *
 * @typedef {Object} ConversationTurn
 * @property {string} role - 'user' ou 'assistant'
 * @property {string} content - Conteúdo do turno
 * @property {number} timestamp - Epoch ms do turno
 * @property {string} [taskId] - ID da tarefa associada (somente assistant)
 * @property {number} [responseLen] - Comprimento da resposta (somente assistant)
 */

/**
 * Resultado de uma chamada ao chat().
 *
 * @typedef {Object} ChatResult
 * @property {string} taskId - ID da tarefa Copilot SDK
 * @property {string} response - Resposta completa do modelo
 * @property {number} responseLen - Comprimento da resposta
 * @property {string[]} chunks - Chunks coletados via streaming (task.delta)
 * @property {number} durationMs - Tempo total da chamada em ms
 */

/**
 * Opções para uma chamada ao chat().
 *
 * @typedef {Object} ChatOptions
 * @property {(chunk: string, taskId: string) => void} [onDelta] - Callback por chunk de streaming
 * @property {(question: object) => void} [onQuestion] - Callback quando modelo faz pergunta
 * @property {number} [timeoutMs] - Timeout em ms (default: 60000)
 * @property {import('@github/copilot-sdk').MessageOptions['attachments']} [attachments] - Anexos (arquivos, imagens) a
 *   enviar junto com a mensagem
 */

// ─── Implementação ────────────────────────────────────────────────────────────

/**
 * Cliente de alto nível para conversa contínua com LLM-B via AlwaysAliveAgent.
 *
 * Mantém histórico de conversa e gerencia listeners de streaming por turno.
 */
export class LlmBridgeClient {
    /** @type {ConversationTurn[]} */
    #history = [];

    /** @type {number} */
    #turnCount = 0;

    /**
     * ARCH-05 (fix): limite máximo de entradas no histórico local para evitar crescimento ilimitado de memória em
     * sessões de longa duração. Entradas mais antigas são removidas automaticamente.
     */
    static #MAX_HISTORY_SIZE = 500;

    /**
     * Envia uma mensagem ao LLM-B e aguarda a resposta completa.
     *
     * Coleta chunks via task.delta durante o processamento para construir a resposta incrementalmente. Suporta
     * callbacks por evento.
     *
     * @param {string} message - Mensagem a enviar para LLM-B
     * @param {ChatOptions} [opts] - Opções de callback e timeout
     * @returns {Promise<ChatResult>} Resultado completo com resposta e metadados
     * @throws {Error} Se o agente não estiver ativo ou a tarefa falhar
     */
    async chat(message, opts = {}) {
        const { onDelta, onQuestion, timeoutMs = 60_000, attachments } = opts;
        const startedAt = Date.now();

        if (alwaysAliveAgent.status === 'stopped') {
            throw new Error('[LlmBridgeClient] Agente não está ativo. Chame alwaysAliveAgent.start() primeiro.');
        }

        // Registra turno do usuário no histórico
        this.#pushHistory({
            role: 'user',
            content: message,
            timestamp: startedAt,
        });
        this.#turnCount++;

        /** @type {string[]} */
        const chunks = [];
        /** @type {string | null} */
        let activeTaskId = null;

        // Listener de streaming para este turno
        const onTaskQueued = (/** @type {any} */ evt) => {
            activeTaskId = evt.taskId;
        };

        const onDeltaEvt = (/** @type {any} */ evt) => {
            if (activeTaskId && evt.taskId === activeTaskId) {
                chunks.push(evt.chunk ?? '');
                if (onDelta) {
                    try {
                        onDelta(evt.chunk ?? '', evt.taskId);
                    } catch {
                        /* seguro */
                    }
                }
            }
        };

        const onQuestionEvt = (/** @type {any} */ evt) => {
            if (onQuestion) {
                try {
                    onQuestion(evt);
                } catch {
                    /* seguro */
                }
            }
        };

        alwaysAliveAgent.on('task.queued', onTaskQueued);
        alwaysAliveAgent.on('task.delta', onDeltaEvt);

        if (onQuestion) {
            alwaysAliveAgent.once('question.pending', onQuestionEvt);
        }

        /** @type {ReturnType<typeof setTimeout> | undefined} */
        let timeoutHandle;

        try {
            log('INFO', `[LlmBridgeClient] Turno #${this.#turnCount}: enviando mensagem.`);

            /** @type {Promise<string>} */
            const timeoutPromise = new Promise((_, reject) => {
                timeoutHandle = setTimeout(
                    () => reject(new Error(`[LlmBridgeClient] Timeout após ${timeoutMs}ms`)),
                    timeoutMs,
                );
            });

            const response = await Promise.race([
                alwaysAliveAgent.sendMessage(message, { attachments }),
                timeoutPromise,
            ]);

            const responseStr = /** @type {string} */ (response);
            const durationMs = Date.now() - startedAt;

            // Registra turno do assistente no histórico
            this.#pushHistory({
                role: 'assistant',
                content: responseStr,
                timestamp: Date.now(),
                ...(activeTaskId != null ? { taskId: activeTaskId } : {}),
                responseLen: responseStr.length,
            });

            log(
                'INFO',
                `[LlmBridgeClient] Turno #${this.#turnCount} concluído em ${durationMs}ms (${responseStr.length} chars, ${chunks.length} chunks)`,
            );

            return {
                taskId: activeTaskId ?? '',
                response: responseStr,
                responseLen: responseStr.length,
                chunks,
                durationMs,
            };
        } finally {
            if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
            alwaysAliveAgent.off('task.queued', onTaskQueued);
            alwaysAliveAgent.off('task.delta', onDeltaEvt);
            if (onQuestion) {
                alwaysAliveAgent.off('question.pending', onQuestionEvt);
            }
        }
    }

    /**
     * Envia uma mensagem estruturada (protocolo Sprint A) para LLM-B e tenta parsear a resposta.
     *
     * Serializa o StructuredMessageInput como JSON com instrução de protocolo, envia via chat(), e tenta parsear a
     * resposta como StructuredMessage. Se LLM-B responder com texto puro (fallback), `result.structured` será `null` e
     * `result.raw` conterá a resposta.
     *
     * @example
     *     ```js
     *     const result = await bridge.chatStructured({
     *         context: 'Sprint A implementado. 1419 testes passando.',
     *         intent: 'Confirmar que novos testes passam sem regressão',
     *         priority: 'high',
     *         responseType: 'diagnostic',
     *     }, { onDelta: (chunk) => process.stdout.write(chunk) });
     *
     *     if (result.structured) {
     *         console.log('Tipo:', result.structured.responseType);
     *         console.log('Output:', result.structured.output);
     *     }
     *     ```;
     *
     * @param {import('#copilot/types/structured-message').StructuredMessageInput} input - Campos da mensagem
     *   estruturada
     * @param {ChatOptions & { turnNumber?: number; sessionId?: string }} [opts] - Opções de callback e metadata
     * @returns {Promise<import('#copilot/types/structured-message').StructuredChatResult>} Resultado com campo
     *   `structured`
     * @throws {Error} Se o agente não estiver ativo ou a tarefa falhar
     */
    async chatStructured(input, opts = {}) {
        const { turnNumber, sessionId, ...chatOpts } = opts;

        const snap = /** @type {{ sessionId?: string }} */ (alwaysAliveAgent.getStatusSnapshot());
        const msg = buildStructuredRequest({
            ...input,
            ...(turnNumber !== undefined ? { turnNumber } : {}),
            ...((sessionId ?? snap.sessionId) ? { sessionId: sessionId ?? snap.sessionId } : {}),
        });

        const serialized = serializeStructuredMessage(msg);
        const chatResult = await this.chat(serialized, chatOpts);

        const structured = parseStructuredResponse(chatResult.response);

        // BUG-04 (fix): popular parseError quando a resposta não é um StructuredMessage válido
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

    /**
     * Inicia a LLM-B em modo de "diálogo direto" (Dialog Loop).
     *
     * @param {string} [bootPrompt] - Prompt de boot (usa padrão §15.8 quando omitido)
     * @param {{
     *     onReady?: () => void;
     *     onReply?: (reply: string) => void;
     *     onStopped?: () => void;
     *     timeoutMs?: number;
     * }} [opts]
     * @returns {Promise<void>} Resolve quando LLM-B sinaliza READY pela primeira vez
     * @throws {Error} Se agente não estiver idle ou dialog loop já estiver ativo
     */
    async startDialogMode(bootPrompt, opts = {}) {
        const { onReady, onReply, onStopped } = opts;

        // BUG-06 (fix): armazenar o wrapper do onReply para poder removê-lo em caso de erro
        const replyHandler = onReply ? (/** @type {any} */ evt) => onReply(evt.reply ?? '') : null;

        if (onReady) alwaysAliveAgent.once('dialog.ready', onReady);
        if (replyHandler) alwaysAliveAgent.on('dialog.reply', replyHandler);
        if (onStopped) alwaysAliveAgent.once('dialog.stopped', onStopped);

        try {
            await alwaysAliveAgent.startDialogLoop(bootPrompt);
            log('INFO', '[LlmBridgeClient] Modo diálogo ativo — LLM-B sinalizou READY.');
        } catch (err) {
            // Limpar listeners registrados se startDialogLoop lançar antes de ter efeito
            if (onReady) alwaysAliveAgent.off('dialog.ready', onReady);
            if (replyHandler) alwaysAliveAgent.off('dialog.reply', replyHandler);
            if (onStopped) alwaysAliveAgent.off('dialog.stopped', onStopped);
            throw err;
        }
    }

    /**
     * Envia um turno de diálogo para a LLM-B no dialog loop.
     *
     * A LLM-B está suspensa em ask_user aguardando input. Esta chamada fornece o input e aguarda a resposta (REPLY: ou
     * DONE: próximo READY). O histórico local é atualizado com o turno do usuário e a resposta da LLM-B.
     *
     * @param {string} message - Mensagem a enviar à LLM-B
     * @param {{ timeout?: number }} [opts]
     * @returns {Promise<string>} Resposta da LLM-B (conteúdo após REPLY: ou confirmação de DONE:)
     */
    async dialogTurn(message, opts = {}) {
        const { timeout = 60_000 } = opts;
        // ARCH-03 fix: registra turno do usuário no histórico local antes de enviar
        const sentAt = Date.now();
        this.#pushHistory({ role: 'user', content: message, timestamp: sentAt });
        this.#turnCount++;
        const reply = await alwaysAliveAgent.sendDialogTurn(message, { timeout });
        // Registra resposta da LLM-B no histórico local
        this.#pushHistory({ role: 'assistant', content: reply, timestamp: Date.now() });
        return reply;
    }

    /**
     * Encerra o modo de diálogo direto, sinalizando STOP_DIALOG para LLM-B.
     *
     * DL-PERM: autorizado internamente para uso pelo watchdog e mecanismos de restart do sistema.
     * Usa reason 'watchdog_restart' para que o handler em index.js saiba que deve reiniciar.
     *
     * @returns {Promise<void>}
     */
    async stopDialogMode() {
        await alwaysAliveAgent.stopDialogLoop({ authorized: true, reason: 'watchdog_restart' });
        log('INFO', '[LlmBridgeClient] Modo diálogo encerrado (restart autorizado do sistema).');
    }

    /**
     * Responde a uma pergunta pendente do modelo.
     *
     * @param {string} answer - Resposta a enviar ao modelo
     * @returns {boolean} True se havia pergunta pendente e foi respondida
     */
    answer(answer) {
        return alwaysAliveAgent.answerPendingQuestion(answer);
    }

    /**
     * Retorna o histórico de conversa completo.
     *
     * @returns {ReadonlyArray<ConversationTurn>} Histórico imutável de turnos
     */
    get history() {
        return /** @type {ReadonlyArray<ConversationTurn>} */ (this.#history);
    }

    /**
     * Retorna o número de turnos de conversa realizados desde a criação.
     *
     * @returns {number} Número de turnos
     */
    get turnCount() {
        return this.#turnCount;
    }

    /**
     * Limpa o histórico local de conversa (não afeta a sessão do SDK).
     *
     * @returns {void}
     */
    clearHistory() {
        this.#history = [];
        this.#turnCount = 0;
    }

    /**
     * Adiciona um turno ao histórico local sem enviar ao modelo (seed manual). Útil para inicializar contexto após
     * resetar histórico via clearHistory().
     *
     * @param {'user' | 'assistant' | 'system'} role - Papel do turno
     * @param {string} content - Conteúdo do turno
     * @returns {void}
     */
    seedHistory(role, content) {
        this.#pushHistory({ role, content, timestamp: Date.now() });
    }

    /**
     * ARCH-05: Adiciona ao histórico com auto-trim para evitar crescimento ilimitado.
     *
     * @param {ConversationTurn} turn
     * @returns {void}
     */
    #pushHistory(turn) {
        this.#history.push(turn);
        if (this.#history.length > LlmBridgeClient.#MAX_HISTORY_SIZE) {
            this.#history.splice(0, this.#history.length - LlmBridgeClient.#MAX_HISTORY_SIZE);
        }
    }

    /**
     * Retorna o snapshot de status do agente subjacente.
     *
     * @returns {object} Snapshot de status do AlwaysAliveAgent
     */
    getAgentStatus() {
        return alwaysAliveAgent.getStatusSnapshot();
    }
}

/**
 * Instância singleton do LlmBridgeClient para uso em toda a aplicação. Reutiliza o alwaysAliveAgent singleton
 * subjacente.
 */
export const llmBridgeClient = new LlmBridgeClient();
