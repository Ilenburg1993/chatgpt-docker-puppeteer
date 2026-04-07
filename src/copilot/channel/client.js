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

import {
    buildStructuredRequest,
    parseStructuredResponse,
    serializeStructuredMessage,
} from '#copilot/core/structured-message';
import { log } from '#copilot/observability/logger';

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
 * @property {number} [retries] - F11.4: número máximo de tentativas em caso de timeout/erro transiente (default: 0)
 * @property {number} [retryDelayMs] - F11.4: delay base entre tentativas em ms (default: 1500; cresce 2× a cada retry)
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
        const { onDelta, onQuestion, timeoutMs = 60_000, attachments, retries = 0, retryDelayMs = 1_500 } = opts;

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
        throw new Error('[LlmBridgeClient] Falha inesperada após retries');
    }

    /**
     * Envia uma mensagem ao LLM-B e aguarda a resposta completa (implementação interna sem retry).
     *
     * @param {string} message
     * @param {{
     *     onDelta?: ChatOptions['onDelta'];
     *     onQuestion?: ChatOptions['onQuestion'];
     *     timeoutMs?: number;
     *     attachments?: ChatOptions['attachments'];
     * }} opts
     * @returns {Promise<ChatResult>}
     */
    async #chatOnce(message, opts = {}) {
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

        // CH-P4-01: usar once para evitar cross-contamination em chatBatch concorrente
        // e remover listener imediatamente após capturar o taskId deste turno
        requireAgent().once('task.queued', onTaskQueued);
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
     * @param {import('#copilot/core/structured-message').StructuredMessageInput} input - Campos da mensagem estruturada
     * @param {ChatOptions & { turnNumber?: number; sessionId?: string }} [opts] - Opções de callback e metadata
     * @returns {Promise<import('#copilot/core/structured-message').StructuredChatResult>} Resultado com campo
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
            const retryResult = await this.chat(retryPrompt, chatOpts);
            const retryStructured = parseStructuredResponse(retryResult.response);
            if (retryStructured) {
                log('INFO', '[LlmBridgeClient] chatStructured: segunda tentativa bem-sucedida.');
                structured = retryStructured;
                // Atualiza resultado com dados da segunda tentativa
                Object.assign(chatResult, {
                    response: retryResult.response,
                    responseLen: retryResult.responseLen,
                    durationMs: chatResult.durationMs + retryResult.durationMs,
                    chunks: [...chatResult.chunks, ...retryResult.chunks],
                    taskId: retryResult.taskId,
                });
            }
        }

        // BUG-04 (fix): popular parseError quando a resposta não é um StructuredMessage válido após ambas as tentativas
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
     * F18.1: callback `onReasoning` para receber chunks de extended thinking em tempo real.
     *
     * @param {string} message - Mensagem a enviar à LLM-B
     * @param {{
     *     timeout?: number;
     *     onDelta?: (chunk: string) => void;
     *     onReasoning?: (chunk: string, reasoningId: string | null) => void;
     * }} [opts]
     * @returns {Promise<string>} Resposta da LLM-B (conteúdo após REPLY: ou confirmação de DONE:)
     * @throws {Error} Se o dialog loop não estiver ativo ou timeout for excedido
     */
    async dialogTurn(message, opts = {}) {
        const { timeout = 60_000, onDelta, onReasoning } = opts;
        const sentAt = Date.now();
        this.#turnCount++;

        const agent = requireAgent();

        // BUG-H05 fix: propaga chunks de streaming para onDelta enquanto sendDialogTurn processa
        const onDeltaTemp = onDelta
            ? (/** @type {{ chunk?: string }} */ evt) => {
                  if (evt.chunk) onDelta(evt.chunk);
              }
            : null;
        if (onDeltaTemp) agent.on('task.delta', onDeltaTemp);

        // F18.1: propaga chunks de reasoning (extended thinking) via callback
        const onReasoningTemp = onReasoning
            ? (/** @type {{ chunk?: string; reasoningId?: string | null }} */ evt) => {
                  if (evt.chunk) onReasoning(evt.chunk, evt.reasoningId ?? null);
              }
            : null;
        if (onReasoningTemp) agent.on('task.reasoning', onReasoningTemp);

        let reply;
        try {
            reply = await agent.sendDialogTurn(message, { timeout });
        } finally {
            if (onDeltaTemp) agent.off('task.delta', onDeltaTemp);
            if (onReasoningTemp) agent.off('task.reasoning', onReasoningTemp);
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
     * DL-PERM: autorizado internamente para uso pelo watchdog e mecanismos de restart do sistema.
     *
     * @param {string} [reason='watchdog_restart'] - Motivo do encerramento (GAP-CHAN-001). Default is
     *   `'watchdog_restart'`
     * @returns {Promise<void>}
     */
    async stopDialogMode(reason = 'watchdog_restart') {
        await requireAgent().stopDialogLoop({ authorized: true, reason });
        log('INFO', `[LlmBridgeClient] Modo diálogo encerrado (reason=${reason}).`);
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
     * F12.4: Opção `summarize: true` retorna versão compacta de cada turno (primeiros 200 chars), para uso em prompts
     * onde tokens são escassos.
     *
     * @param {number} [pairs=5] - Número máximo de pares a retornar. Default is `5`
     * @param {{ summarize?: boolean }} [opts]
     * @returns {ReadonlyArray<ConversationTurn>} Slice imutável dos últimos N pares
     */
    getLastNPairs(pairs = 5, opts = {}) {
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
        /** @type {ConversationTurn[]} */
        let result;
        if (!collected.length) {
            result = /** @type {ConversationTurn[]} */ (hist.slice(-pairs * 2));
        } else {
            result = collected.flatMap(({ user, assistant }) => [user, assistant]);
        }
        // F12.4: modo compacto — truncar conteúdo a 200 chars para economia de tokens
        if (opts.summarize) {
            result = result.map((t) => ({
                ...t,
                content: t.content.length > 200 ? t.content.slice(0, 200) + '…' : t.content,
            }));
        }
        return /** @type {ReadonlyArray<ConversationTurn>} */ (result);
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
