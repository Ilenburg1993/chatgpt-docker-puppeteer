// @ts-check
/**
 * src/copilot/llm-bridge-client.js
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
 *
 * @module copilot/llm-bridge-client
 *
 * @example
 *     ```js
 *     import { LlmBridgeClient } from './llm-bridge-client.js';
 *
 *     const bridge = new LlmBridgeClient();
 *     const reply = await bridge.chat('Explique monads em uma linha.');
 *     console.log(reply.response);
 *     console.log(bridge.history);
 *     ```;
 */

import { log } from '#core/logger';
import { alwaysAliveAgent } from './always-alive.js';

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
        const { onDelta, onQuestion, timeoutMs = 60_000 } = opts;
        const startedAt = Date.now();

        if (alwaysAliveAgent.status === 'stopped') {
            throw new Error('[LlmBridgeClient] Agente não está ativo. Chame alwaysAliveAgent.start() primeiro.');
        }

        // Registra turno do usuário no histórico
        this.#history.push({
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

            const response = await Promise.race([alwaysAliveAgent.sendMessage(message), timeoutPromise]);

            const responseStr = /** @type {string} */ (response);
            const durationMs = Date.now() - startedAt;

            // Registra turno do assistente no histórico
            this.#history.push({
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
     * Inicia a LLM-B em modo de "diálogo direto" (Dialog Loop).
     *
     * Neste modo, a LLM-B usa ask_user em loop (padrão §15.8), permitindo iteração multitarefa dentro do mesmo PR —
     * custo zero de tokens adicionais.
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

        if (onReady) alwaysAliveAgent.once('dialog.ready', onReady);
        if (onReply) alwaysAliveAgent.on('dialog.reply', (/** @type {any} */ evt) => onReply(evt.reply ?? ''));
        if (onStopped) alwaysAliveAgent.once('dialog.stopped', onStopped);

        await alwaysAliveAgent.startDialogLoop(bootPrompt);
        log('INFO', '[LlmBridgeClient] Modo diálogo ativo — LLM-B sinalizou READY.');
    }

    /**
     * Envia um turno de diálogo para a LLM-B no dialog loop.
     *
     * A LLM-B está suspensa em ask_user aguardando input. Esta chamada fornece o input e aguarda a resposta (REPLY: ou
     * DONE: próximo READY).
     *
     * @param {string} message - Mensagem a enviar à LLM-B
     * @param {{ timeout?: number }} [opts]
     * @returns {Promise<string>} Resposta da LLM-B (conteúdo após REPLY: ou confirmação de DONE:)
     */
    async dialogTurn(message, opts = {}) {
        const { timeout = 60_000 } = opts;
        return alwaysAliveAgent.sendDialogTurn(message, { timeout });
    }

    /**
     * Encerra o modo de diálogo direto, sinalizando STOP_DIALOG para LLM-B.
     *
     * @returns {Promise<void>}
     */
    async stopDialogMode() {
        await alwaysAliveAgent.stopDialogLoop();
        log('INFO', '[LlmBridgeClient] Modo diálogo encerrado.');
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
