// @ts-check
/**
 * src/copilot/channel/client.js
 *
 * @module copilot/channel/client
 * @see EventBus
 * @see module:copilot/always-alive
 * @see module:copilot/channel/inject
 */

import { LLM_B_TURN_TIMEOUT_MS } from '#copilot/config';
import { BridgeError } from '#copilot/core';
import {
    EMITTER_QUESTION_PENDING,
    EMITTER_TASK_DELTA,
    EMITTER_TASK_QUEUED,
    EMITTER_TASK_REASONING,
    EMITTER_TASK_STARTED,
    EMITTER_TOOL_EXECUTION_PROGRESS,
} from '#copilot/events';
import { log } from '#copilot/observability';
import { logSwallowed } from '../core/error-handlers.js';
import {
    dialogTurn as _dialogTurn,
    startDialogMode as _startDialogMode,
    stopDialogMode as _stopDialogMode,
} from './client-dialog.js';
import { getLastNPairs as _getLastNPairs } from './client-history.js';
import { chatStructured as _chatStructured } from './client-structured.js';

/**
 * Interface mínima do AlwaysAliveAgent usada pelo LlmBridgeClient.
 *
 * @typedef {Object} BridgeAgentLike
 * @property {string} status
 * @property {string | null} [sessionId]
 * @property {string} [model]
 * @property {number} [queueSize]
 * @property {boolean} [dialogLoopActive]
 * @property {boolean} [dialogPaused]
 * @property {Function} sendMessage
 * @property {(bootPrompt?: string) => Promise<void>} startDialogLoop
 * @property {(message: string, opts?: { timeout?: number }) => Promise<string>} sendDialogTurn
 * @property {(opts?: {
 *     authorized?: boolean;
 *     reason?: 'watchdog_restart' | 'authorized_stop' | 'recovery_restart';
 *     shutdownTimeoutMs?: number;
 * }) => Promise<void>} stopDialogLoop
 * @property {(answer: string) => boolean} answerPendingQuestion
 * @property {(event: string, listener: (...args: any[]) => void) => void} on
 * @property {(event: string, listener: (...args: any[]) => void) => void} once
 * @property {(event: string, listener: (...args: any[]) => void) => void} off
 */

/** @type {BridgeAgentLike | null} */
let _agent = null;

/**
 * Injeta o AlwaysAliveAgent singleton para quebrar dependência circular. Chamado em `startTerminalServer()` durante o
 * boot.
 *
 * @param {BridgeAgentLike} agent
 * @returns {void}
 */
export function setBridgeAgent(agent) {
    if (_agent && _agent !== agent) {
        log('WARN', '[LlmBridgeClient] setBridgeAgent chamado novamente — substituindo instância anterior.');
    }
    _agent = agent;
}

/**
 * Utilitário de teste para limpar o singleton injetado.
 *
 * @returns {void}
 */
export function resetBridgeAgentForTests() {
    _agent = null;
}
/**
 * @returns {BridgeAgentLike}
 * @throws {Error} Se o agent não foi injetado via `setBridgeAgent()`.
 */
function requireAgent() {
    if (!_agent)
        throw new BridgeError(
            '[LlmBridgeClient] agent não injetado — chamar setBridgeAgent() antes.',
            'BRIDGE_NOT_INITIALIZED',
        );
    return _agent;
}

/**
 * @param {number | null} timeoutMs
 * @param {() => void} onTimeout Se `timeoutMs` for `null`, nenhum timer é criado e `ping()` é no-op — para turnos sem
 *   timeout explícito.
 * @returns {{ ping: () => void; clear: () => void }}
 */
function createInactivityGuard(timeoutMs, onTimeout) {
    /** @type {ReturnType<typeof setTimeout> | null} */
    let handle = null;
    let disposed = false;

    const arm = () => {
        if (timeoutMs === null) return;
        if (disposed) return;
        if (handle) clearTimeout(handle);
        handle = setTimeout(() => {
            if (disposed) return;
            disposed = true;
            handle = null;
            onTimeout();
        }, timeoutMs);
    };

    arm();

    return {
        ping: () => {
            arm();
        },
        clear: () => {
            disposed = true;
            if (handle) clearTimeout(handle);
            handle = null;
        },
    };
}
/**
 * Uma entrada no histórico de conversa.
 *
 * @typedef {Object} ConversationTurn
 * @property {string} role - 'user' ou 'assistant'
 * @property {string} content - Conteúdo do turno
 * @property {number} timestamp - Epoch ms do turno
 * @property {string} [taskId] - ID da tarefa associada (somente assistant)
 * @property {number} [responseLen] - Comprimento da resposta (somente assistant) Resultado de uma chamada ao chat().
 *
 * @typedef {Object} ChatResult
 * @property {string} taskId - ID da tarefa Copilot SDK
 * @property {string} response - Resposta completa do modelo
 * @property {number} responseLen - Comprimento da resposta
 * @property {string[]} chunks - Chunks coletados via streaming (task.delta)
 * @property {number} durationMs - Tempo total da chamada em ms Opções para uma chamada ao chat().
 *
 * @typedef {Object} ChatOptions
 * @property {(chunk: string, taskId: string) => void} [onDelta] - Callback por chunk de streaming
 * @property {(question: object) => void} [onQuestion] - Callback quando modelo faz pergunta
 * @property {number | null} [timeoutMs] - Timeout em ms. `null` = sem timeout por inatividade (default:
 *   `LLM_B_TURN_TIMEOUT_MS`). Use `null` somente quando o watchdog for o único guardião de stall.
 * @property {import('#copilot/sdk/types').MessageOptions['attachments']} [attachments] - Anexos (arquivos, imagens) a
 *   enviar junto com a mensagem
 * @property {number} [retries] - F11.4: número máximo de tentativas em caso de timeout/erro transiente (default: 0)
 * @property {number} [retryDelayMs] - F11.4: delay base entre tentativas em ms (default: 1500; cresce 2× a cada retry)
 *   Cliente de alto nível para conversa contínua com LLM-B via AlwaysAliveAgent.
 *
 *   Mantém histórico de conversa e gerencia listeners de streaming por turno.
 */
export class LlmBridgeClient {
    /** @type {ConversationTurn[]} */
    #history = [];

    /** @type {number} */
    #turnCount = 0;

    /**
     * ARCH-05 (fix): limite máximo de entradas no histórico local para evitar crescimento ilimitado de memória em
     * sessões de longa duração. Entradas mais antigas são removidas automaticamente.
     *
     * ARCH-06 (fix): valor padrão estático — pode ser sobrescrito por instância via construtor.
     */
    static #DEFAULT_MAX_HISTORY_SIZE = 500;

    /** @type {number} */
    #maxHistorySize;

    /**
     * @param {{ maxHistorySize?: number }} [opts]
     */
    constructor(opts = {}) {
        // ARCH-06 (fix): tamanho máximo do histórico configurável por instância
        this.#maxHistorySize = opts.maxHistorySize ?? LlmBridgeClient.#DEFAULT_MAX_HISTORY_SIZE;
    }

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
        const {
            onDelta,
            onQuestion,
            timeoutMs = LLM_B_TURN_TIMEOUT_MS,
            attachments,
            retries = 0,
            retryDelayMs = 1_500,
        } = opts;

        // F11.4: wrapper de retry — tenta no máximo `retries+1` vezes em erros de timeout ou busy
        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                return await this.#chatOnce(message, { onDelta, onQuestion, timeoutMs, attachments });
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                const isRetryable = msg.includes('Timeout') || msg.includes('busy') || msg.includes('ECONNRESET');
                if (isRetryable && attempt < retries) {
                    const waitMs = retryDelayMs * Math.pow(2, attempt);
                    log('DEBUG', `[LlmBridgeClient] chat() retry ${attempt + 1}/${retries} após ${waitMs}ms: ${msg}`);
                    await new Promise((r) => setTimeout(r, waitMs));
                    continue;
                }
                throw err;
            }
        }
        // Nunca alcançado (loop sempre re-throw na última iteração), mas satisfaz o tipo
        throw new BridgeError('[LlmBridgeClient] Falha inesperada após retries', 'BRIDGE_RETRY_EXHAUSTED');
    }

    /**
     * Envia uma mensagem ao LLM-B e aguarda a resposta completa (implementação interna sem retry).
     *
     * @param {string} message
     * @param {{
     *     onDelta?: ChatOptions['onDelta'];
     *     onQuestion?: ChatOptions['onQuestion'];
     *     timeoutMs?: number | null;
     *     attachments?: ChatOptions['attachments'];
     * }} opts
     * @returns {Promise<ChatResult>}
     */
    async #chatOnce(message, opts = {}) {
        const { onDelta, onQuestion, timeoutMs = LLM_B_TURN_TIMEOUT_MS, attachments } = opts;
        const startedAt = Date.now();

        if (requireAgent().status === 'stopped') {
            throw new BridgeError(
                '[LlmBridgeClient] Agente não está ativo. Chame requireAgent().start() primeiro.',
                'BRIDGE_AGENT_STOPPED',
            );
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
        const onTaskQueued = (/** @type {{ taskId?: string }} */ evt) => {
            activeTaskId = evt.taskId ?? null;
            inactivityGuard.ping();
        };

        const onDeltaEvt = (/** @type {{ taskId?: string; chunk?: string }} */ evt) => {
            if (activeTaskId && evt.taskId === activeTaskId) {
                chunks.push(evt.chunk ?? '');
                if (onDelta) {
                    try {
                        onDelta(evt.chunk ?? '', evt.taskId);
                    } catch (e) {
                        logSwallowed(e, 'channel.client.onDelta');
                    }
                }
            }
        };

        const onQuestionEvt = (/** @type {Record<string, unknown>} */ evt) => {
            if (onQuestion) {
                try {
                    onQuestion(evt);
                } catch (e) {
                    logSwallowed(e, 'channel.client.onQuestion');
                }
            }
        };

        // CH-P4-01: usar once para evitar cross-contamination em chatBatch concorrente
        // e remover listener imediatamente após capturar o taskId deste turno
        requireAgent().once(EMITTER_TASK_QUEUED, onTaskQueued);
        requireAgent().on(EMITTER_TASK_DELTA, onDeltaEvt);

        if (onQuestion) {
            requireAgent().once(EMITTER_QUESTION_PENDING, onQuestionEvt);
        }

        /** @type {(evt?: unknown) => void} */
        const onProgress = () => {
            inactivityGuard.ping();
        };

        const inactivityGuard = createInactivityGuard(timeoutMs, () => {
            rejectChat(new Error(`[LlmBridgeClient] Timeout por inatividade após ${timeoutMs ?? 0}ms`));
        });

        /** @type {(error: Error) => void} */
        let rejectChat = (error) => {
            log('WARN', `[LlmBridgeClient] Reject before promise wiring: ${error.message}`);
        };

        try {
            log('INFO', `[LlmBridgeClient] Turno #${this.#turnCount}: enviando mensagem.`);

            const timeoutPromise = new Promise((_, reject) => {
                rejectChat = (error) => {
                    reject(error);
                };
            });

            requireAgent().on(EMITTER_TASK_STARTED, onProgress);
            requireAgent().on(EMITTER_TASK_REASONING, onProgress);
            requireAgent().on(EMITTER_TOOL_EXECUTION_PROGRESS, onProgress);
            requireAgent().on(EMITTER_TASK_DELTA, onProgress);
            requireAgent().on(EMITTER_QUESTION_PENDING, onProgress);

            const response = await Promise.race([requireAgent().sendMessage(message, { attachments }), timeoutPromise]);

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
            inactivityGuard.clear();
            requireAgent().off('task.queued', onTaskQueued);
            requireAgent().off('task.delta', onDeltaEvt);
            requireAgent().off(EMITTER_TASK_STARTED, onProgress);
            requireAgent().off(EMITTER_TASK_REASONING, onProgress);
            requireAgent().off(EMITTER_TOOL_EXECUTION_PROGRESS, onProgress);
            requireAgent().off(EMITTER_QUESTION_PENDING, onProgress);
            if (onQuestion) {
                requireAgent().off('question.pending', onQuestionEvt);
            }
        }
    }

    /**
     * Envia uma mensagem estruturada (protocolo Sprint A) para LLM-B e tenta parsear a resposta.
     *
     * @param {import('#copilot/core/structured-message').StructuredMessageInput} input
     * @param {ChatOptions & { turnNumber?: number; sessionId?: string }} [opts]
     * @returns {Promise<import('#copilot/core/structured-message').StructuredChatResult>}
     */
    async chatStructured(input, opts = {}) {
        const sessionId = requireAgent().sessionId ?? undefined;
        return _chatStructured(
            {
                chat: (msg, chatOpts) => this.chat(msg, chatOpts),
                getSessionId: () => sessionId,
            },
            input,
            opts,
        );
    }

    /**
     * UPG-06: Envia múltiplas mensagens com controle de concorrência via semáforo.
     *
     * Cada "slot" de concorrência é uma chain de Promises. Mensagens são atribuídas ciclicamente aos slots, garantindo
     * que até `concurrency` mensagens rodem simultâneas. Com `concurrency=1` (padrão), o comportamento é puramente
     * sequencial — preservando histórico de conversa.
     *
     * @remarks
     *   **BUG-CRIT-06 (documentado)**: AlwaysAliveAgent serializa internamente a fila — paralelismo real exige múltiplas
     *   instâncias. O semáforo aqui controla a taxa de submissão ao agente.
     * @param {string[]} messages - Mensagens a enviar
     * @param {{
     *     concurrency?: number;
     *     timeout?: number;
     *     onDelta?: (chunk: string) => void;
     * }} [opts]
     * @returns {Promise<
     *     (
     *         | { response: string; taskId: string; durationMs: number }
     *         | { error: string; response: null; taskId: string; durationMs: number }
     *     )[]
     * >}
     * @throws {RangeError} Se messages.length > 50
     */
    async chatBatch(messages, opts = {}) {
        if (messages.length > 50) {
            throw new RangeError(`chatBatch: máximo 50 mensagens por batch (recebido: ${messages.length})`);
        }
        const { concurrency = 1, ...chatOpts } = opts;
        const slots = Array.from({ length: Math.max(1, concurrency) }, () => Promise.resolve());
        /** @type {Promise<ChatResult | { error: string; response: null; taskId: string; durationMs: number }>[]} */
        const pending = messages.map((msg, i) => {
            const slot = i % slots.length;
            /** @type {Promise<ChatResult | { error: string; response: null; taskId: string; durationMs: number }>} */
            const next = (slots[slot] ?? Promise.resolve()).then(() =>
                this.chat(msg, chatOpts).catch((err) => ({
                    error: err.message,
                    response: /** @type {null} */ (null),
                    taskId: '',
                    durationMs: 0,
                })),
            );
            slots[slot] = next.then(() => undefined);
            return next;
        });
        return Promise.all(pending);
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
     * @returns {Promise<void>}
     */
    async startDialogMode(bootPrompt, opts = {}) {
        await _startDialogMode(requireAgent(), bootPrompt, opts);
    }

    /**
     * Envia um turno de diálogo para a LLM-B no dialog loop.
     *
     * @param {string} message
     * @param {{
     *     timeout?: number;
     *     onDelta?: (chunk: string) => void;
     *     onReasoning?: (chunk: string, reasoningId: string | null) => void;
     * }} [opts]
     * @returns {Promise<string>}
     */
    async dialogTurn(message, opts = {}) {
        const sentAt = Date.now();
        this.#turnCount++;

        const reply = await _dialogTurn(requireAgent(), message, opts);

        this.#pushHistory({ role: 'user', content: message, timestamp: sentAt });
        this.#pushHistory({ role: 'assistant', content: reply, timestamp: Date.now() });
        return reply;
    }

    /**
     * Encerra o modo de diálogo direto.
     *
     * @param {'watchdog_restart' | 'authorized_stop' | 'recovery_restart'} [reason='watchdog_restart'] Default is
     *   `'watchdog_restart'`
     * @returns {Promise<void>}
     */
    async stopDialogMode(reason = 'watchdog_restart') {
        await _stopDialogMode(requireAgent(), reason);
    }

    /**
     * Responde a uma pergunta pendente do modelo.
     *
     * @param {string} answer - Resposta a enviar ao modelo
     * @returns {boolean} True se havia pergunta pendente e foi respondida
     */
    answer(answer) {
        return requireAgent().answerPendingQuestion(answer);
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
     * Retorna os últimos N pares (user + assistant) do histórico.
     *
     * @param {number} [pairs=5] Default is `5`
     * @param {{ summarize?: boolean }} [opts]
     * @returns {ReadonlyArray<ConversationTurn>}
     */
    getLastNPairs(pairs = 5, opts = {}) {
        return _getLastNPairs(this.#history, pairs, opts);
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
     * F12.2: Valida que o role não cria sequência inválida (dois turnos idênticos seguidos), com exceção de 'system'
     * que pode aparecer a qualquer momento.
     *
     * @param {'user' | 'assistant' | 'system'} role - Papel do turno
     * @param {string} content - Conteúdo do turno
     * @returns {void}
     */
    seedHistory(role, content) {
        // F12.2: validação de alternância (não bloqueia 'system' que não faz parte da sequência chat)
        if (role !== 'system' && this.#history.length > 0) {
            const last = this.#history[this.#history.length - 1];
            if (last && last.role === role) {
                log(
                    'WARN',
                    `[LlmBridgeClient] seedHistory: sequência inválida — dois turnos '${role}' consecutivos. ` +
                        `Isso pode confundir o modelo. Considere alternar user/assistant.`,
                );
            }
        }
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
        // F12.1: aviso proativo antes do auto-trim (ao atingir 80% da capacidade)
        const len = this.#history.length;
        if (len === Math.floor(this.#maxHistorySize * 0.8)) {
            log(
                'WARN',
                `[LlmBridgeClient] Histórico em ${len}/${this.#maxHistorySize} entradas (80%) — ` +
                    `próximas adições vão acionar auto-trim.`,
            );
        }
        if (len > this.#maxHistorySize) {
            // ARCH-07 (fix): emitir warning explícito ao truncar histórico em vez de silenciar
            const removed = len - this.#maxHistorySize;
            this.#history.splice(0, removed);
            log(
                'WARN',
                `[LlmBridgeClient] Histórico truncado: ${removed} entrada(s) removida(s) (limite: ${this.#maxHistorySize}).`,
            );
        }
    }

    /**
     * Retorna uma projection mínima e estável do runtime do agente subjacente.
     *
     * @returns {{
     *     status: string;
     *     sessionId: string | null;
     *     model: string | null;
     *     queueSize: number;
     *     dialogLoopActive: boolean;
     *     dialogPaused: boolean;
     * }}
     */
    getAgentStatus() {
        const agent = requireAgent();
        return {
            status: String(agent.status ?? 'unknown'),
            sessionId: agent.sessionId ?? null,
            model: typeof agent.model === 'string' ? agent.model : null,
            queueSize: Number(agent.queueSize ?? 0),
            dialogLoopActive: Boolean(agent.dialogLoopActive),
            dialogPaused: Boolean(agent.dialogPaused),
        };
    }
}
/**
 * Instância singleton do LlmBridgeClient para uso em toda a aplicação. Reutiliza o alwaysAliveAgent singleton
 * subjacente.
 */
export const llmBridgeClient = new LlmBridgeClient();
