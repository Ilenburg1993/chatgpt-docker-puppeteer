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
 *
 * @see module:copilot/always-alive
 * @see module:copilot/channel/inject
 */

import { log } from '#copilot/observability/logger';
import {
    buildStructuredRequest,
    parseStructuredResponse,
    serializeStructuredMessage,
} from '#copilot/types/structured-message';

// ─── Injeção de dependência do agent (ARCH-03: break circular dep) ────────────

/**
 * Interface mínima do AlwaysAliveAgent usada pelo LlmBridgeClient.
 *
 * @typedef {Object} BridgeAgentLike
 * @property {string} status
 * @property {Function} sendMessage
 * @property {() => object} getStatusSnapshot
 * @property {(bootPrompt?: string) => Promise<void>} startDialogLoop
 * @property {(message: string, opts?: { timeout?: number }) => Promise<string>} sendDialogTurn
 * @property {Function} stopDialogLoop
 * @property {(answer: string) => any} answerPendingQuestion
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
    _agent = agent;
}

/**
 * @returns {BridgeAgentLike}
 * @throws {Error} Se o agent não foi injetado via `setBridgeAgent()`.
 */
function requireAgent() {
    if (!_agent) throw new Error('[LlmBridgeClient] agent não injetado — chamar setBridgeAgent() antes.');
    return _agent;
}

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
        const { onDelta, onQuestion, timeoutMs = 60_000, attachments } = opts;
        const startedAt = Date.now();

        if (requireAgent().status === 'stopped') {
            throw new Error('[LlmBridgeClient] Agente não está ativo. Chame requireAgent().start() primeiro.');
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
        };

        const onDeltaEvt = (/** @type {{ taskId?: string; chunk?: string }} */ evt) => {
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

        const onQuestionEvt = (/** @type {Record<string, unknown>} */ evt) => {
            if (onQuestion) {
                try {
                    onQuestion(evt);
                } catch {
                    /* seguro */
                }
            }
        };

        requireAgent().on('task.queued', onTaskQueued);
        requireAgent().on('task.delta', onDeltaEvt);

        if (onQuestion) {
            requireAgent().once('question.pending', onQuestionEvt);
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
            if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
            requireAgent().off('task.queued', onTaskQueued);
            requireAgent().off('task.delta', onDeltaEvt);
            if (onQuestion) {
                requireAgent().off('question.pending', onQuestionEvt);
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

        const snap = /** @type {{ sessionId?: string }} */ (requireAgent().getStatusSnapshot());
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
                this.chat(msg, chatOpts).catch((/** @type {any} */ err) => ({
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
     * Registra os event listeners de diálogo e retorna uma função de cleanup simétrica.
     *
     * @param {{ onReady?: () => void; onReply?: (reply: string) => void; onStopped?: () => void }} opts
     * @returns {{ replyHandler: ((evt: { reply?: string }) => void) | null; cleanup: () => void }}
     */
    #registerDialogListeners(opts) {
        const { onReady, onReply, onStopped } = opts;
        const replyHandler = onReply ? (/** @type {{ reply?: string }} */ evt) => onReply(evt.reply ?? '') : null;

        if (onReady) requireAgent().once('dialog.ready', onReady);
        if (replyHandler) requireAgent().on('dialog.reply', replyHandler);
        if (onStopped) requireAgent().once('dialog.stopped', onStopped);

        const cleanup = () => {
            if (onReady) requireAgent().off('dialog.ready', onReady);
            if (replyHandler) requireAgent().off('dialog.reply', replyHandler);
            if (onStopped) requireAgent().off('dialog.stopped', onStopped);
        };

        return { replyHandler, cleanup };
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
        const { cleanup } = this.#registerDialogListeners(opts);

        try {
            await requireAgent().startDialogLoop(bootPrompt);
            log('INFO', '[LlmBridgeClient] Modo diálogo ativo — LLM-B sinalizou READY.');
        } catch (err) {
            cleanup();
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
     * @param {{ timeout?: number; onDelta?: (chunk: string) => void }} [opts]
     * @returns {Promise<string>} Resposta da LLM-B (conteúdo após REPLY: ou confirmação de DONE:)
     * @throws {Error} Se o dialog loop não estiver ativo ou timeout for excedido
     */
    async dialogTurn(message, opts = {}) {
        const { timeout = 60_000, onDelta } = opts;
        const sentAt = Date.now();
        this.#turnCount++;

        // BUG-H05 fix: propaga chunks de streaming para onDelta enquanto sendDialogTurn processa
        const onDeltaTemp = onDelta
            ? (/** @type {{ chunk?: string }} */ evt) => {
                  if (evt.chunk) onDelta(evt.chunk);
              }
            : null;
        if (onDeltaTemp) requireAgent().on('task.delta', onDeltaTemp);
        let reply;
        try {
            reply = await requireAgent().sendDialogTurn(message, { timeout });
        } finally {
            if (onDeltaTemp) requireAgent().off('task.delta', onDeltaTemp);
        }
        // BUG-MED-02 (fix): registrar turno de usuário apenas após confirmação de envio bem-sucedido
        // Evita histórico contaminado com menssagens do usuário sem resposta correspondente
        this.#pushHistory({ role: 'user', content: message, timestamp: sentAt });
        // Registra resposta da LLM-B no histórico local
        this.#pushHistory({ role: 'assistant', content: reply, timestamp: Date.now() });
        return reply;
    }

    /**
     * Encerra o modo de diálogo direto, sinalizando STOP_DIALOG para LLM-B.
     *
     * DL-PERM: autorizado internamente para uso pelo watchdog e mecanismos de restart do sistema. Usa reason
     * 'watchdog_restart' para que o handler em index.js saiba que deve reiniciar.
     *
     * @returns {Promise<void>}
     */
    async stopDialogMode() {
        await requireAgent().stopDialogLoop({ authorized: true, reason: 'watchdog_restart' });
        log('INFO', '[LlmBridgeClient] Modo diálogo encerrado (restart autorizado do sistema).');
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
     * UPG-PROP-12 (fix): Retorna os últimos N pares (user + assistant) do histórico.
     *
     * Útil para enviar contexto compacto a um LLM sem incluir o histórico completo. Garante que os pares comecem sempre
     * por uma mensagem `user`, preservando a estrutura de alternância esperada pelo protocolo.
     *
     * F6.9 (UPG-05): implementação cursor-based — navega do fim para o início sem criar arrays intermediários.
     *
     * @param {number} [pairs=5] - Número máximo de pares a retornar. Default is `5`
     * @returns {ReadonlyArray<ConversationTurn>} Slice imutável dos últimos N pares
     */
    getLastNPairs(pairs = 5) {
        const hist = /** @type {ConversationTurn[]} */ (this.#history);
        /** @type {{ user: ConversationTurn; assistant: ConversationTurn }[]} */
        const collected = [];
        let i = hist.length - 1;
        while (i >= 0 && collected.length < pairs) {
            const cur = hist[i];
            if (cur?.role === 'assistant') {
                const j = i - 1;
                const prev = j >= 0 ? hist[j] : undefined;
                if (prev?.role === 'user') {
                    collected.unshift({ user: prev, assistant: cur });
                    i = j - 1;
                    continue;
                }
            }
            i--;
        }
        if (!collected.length) return /** @type {ReadonlyArray<ConversationTurn>} */ (hist.slice(-pairs * 2));
        // Achata pares em array plano [user, assistant, user, assistant, ...]
        return /** @type {ReadonlyArray<ConversationTurn>} */ (
            collected.flatMap(({ user, assistant }) => [user, assistant])
        );
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
        if (this.#history.length > this.#maxHistorySize) {
            // ARCH-07 (fix): emitir warning explícito ao truncar histórico em vez de silenciar
            const removed = this.#history.length - this.#maxHistorySize;
            this.#history.splice(0, removed);
            log(
                'WARN',
                `[LlmBridgeClient] Histórico truncado: ${removed} entrada(s) removida(s) (limite: ${this.#maxHistorySize}).`,
            );
        }
    }

    /**
     * Retorna o snapshot de status do agente subjacente.
     *
     * @returns {object} Snapshot de status do AlwaysAliveAgent
     */
    getAgentStatus() {
        return requireAgent().getStatusSnapshot();
    }
}

/**
 * Instância singleton do LlmBridgeClient para uso em toda a aplicação. Reutiliza o alwaysAliveAgent singleton
 * subjacente.
 */
export const llmBridgeClient = new LlmBridgeClient();
