// @ts-check
/**
 * src/copilot/conversation-hub/orchestrator.js
 *
 * HubOrchestrator — Gerencia o diálogo entre LLM-A (GitHub Copilot) e LLM-B (SDK gpt-4.1), persistindo cada turno no
 * ConversationStore e emitindo eventos em tempo real.
 *
 * LLM-A é o orquestrador: utiliza o HubOrchestrator para enviar mensagens a LLM-B, receber respostas estruturadas e
 * processar mensagens injetadas pelo usuário.
 *
 * @module copilot/conversation-hub/orchestrator
 * @see module:copilot/conversation-hub/store
 * @see module:copilot/conversation-hub/hub
 * @see module:copilot/always-alive
 */

import { log } from '#core/logger';
import EventEmitter from 'node:events';
import { LlmBridgeClient } from '../channel/client.js';

// ─── Lazy resolution do AlwaysAliveAgent (ARCH-03: break circular dep) ────────

/**
 * @typedef {{
 *     getStatusSnapshot(): object;
 *     dialogLoopActive?: boolean;
 *     sendDialogTurn?(content: string, opts?: { timeout?: number }): Promise<string>;
 *     getPermissionMode?(): string;
 *     setPermissionMode?(mode: string, opts?: object): void;
 *     status?: string;
 *     on?(event: string, listener: (...args: any[]) => void): void;
 *     off?(event: string, listener: (...args: any[]) => void): void;
 * }} AgentLike
 */

/** @type {AgentLike | null} */
let _fallbackAgent = null;

/**
 * Injeta o AlwaysAliveAgent como fallback global. Chamado em `bootstrapTools()` após o agent ser instanciado. Evita
 * import circular.
 *
 * @param {AgentLike} agent
 * @returns {void}
 */
export function setFallbackAgent(agent) {
    _fallbackAgent = agent;
}

// ─── Tipos ────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} SendToLlmBOpts
 * @property {boolean} [useStructured] - Usar chatStructured() em vez de chat() (default: true)
 * @property {number} [timeoutMs] - Timeout para a resposta (default: 120000)
 * @property {string} [model] - Modelo a registrar no turn (default: 'gpt-4.1')
 * @property {object} [structuredInput] - Campos extras para chatStructured() (context, intent, etc.)
 */

/**
 * @typedef {Object} OrchestratorResult
 * @property {number} turnId - ID do turn registrado no ConversationStore
 * @property {string} content - Resposta completa de LLM-B
 * @property {object | null} structured - StructuredMessage parseado (se useStructured=true)
 * @property {number} durationMs - Duração da resposta
 * @property {string} hubSessionId - ID da hub_session
 * @property {number} turnNumber - Número sequencial do turno
 */

// ─── HubOrchestrator ──────────────────────────────────────────────────────────

/**
 * Orquestrador do ambiente permanente LLM-A ↔ LLM-B ↔ Usuário.
 *
 * Emite os seguintes eventos:
 *
 * - `turn:sent` { hubSessionId, turnId, role, content, turnNumber }
 * - `turn:delta` { hubSessionId, chunk, turnNumber }
 * - `turn:complete` { hubSessionId, turnId, role, content, structured, durationMs, turnNumber }
 * - `user:injected` { hubSessionId, turnId, content }
 * - `session:created` { hubSessionId, title }
 * - `session:closed` { hubSessionId }
 * - `error` { hubSessionId, message, error }
 *
 * @extends {EventEmitter}
 */
export class HubOrchestrator extends EventEmitter {
    /** @type {import('./store.js').ConversationStore} */
    #store;

    /** @type {LlmBridgeClient | null} */
    #bridge = null;

    /**
     * @type {AgentLike | null}
     */
    #agent = null;

    /** @type {Map<string, number>} hubSessionId → próximo turn_number esperado */
    #turnCounters = new Map();

    /**
     * Mutex por sessão: garante que apenas um sendToLlmB() executa por vez por hubSessionId. Cada entry é a cauda da
     * cadeia de Promises — novo sendToLlmB() encadeia via .then().
     *
     * @type {Map<string, Promise<void>>}
     */
    #inflightBySession = new Map();

    /**
     * F6.5 (BUG-MOD-09): sessões já encerradas — previne re-inserção zumbi em #inflightBySession após closeSession()
     * ser chamado durante uma Promise em voo.
     *
     * @type {Set<string>}
     */
    #closedSessions = new Set();

    /**
     * @param {import('./store.js').ConversationStore} store
     * @param {AgentLike} [agentOverride]
     *
     *   - AlwaysAliveAgent a usar (útil em testes).
     */
    constructor(store, agentOverride) {
        super();
        this.#store = store;
        this.#agent = agentOverride ?? null;
    }

    // ─── Ciclo de vida ────────────────────────────────────────────────────────

    /**
     * Inicializa o orquestrador criando o LlmBridgeClient. Restaura turn counters das sessões ativas da DB para
     * garantir continuidade após restart.
     *
     * @param {LlmBridgeClient} [bridgeOverride] - Bridge a usar em vez de criar uma nova instância (útil em testes).
     * @returns {void}
     */
    init(bridgeOverride) {
        this.#bridge = bridgeOverride ?? new LlmBridgeClient();

        // Restaurar turn counters das sessões ativas (evita sequência errada após restart)
        try {
            const activeSessions = this.#store.listHubSessions({ status: 'active' });
            for (const session of activeSessions) {
                const count = this.#store.countTurns(session.id);
                this.#turnCounters.set(session.id, count);
                log('DEBUG', `[HubOrchestrator] Sessão ${session.id}: ${count} turns restaurados.`);
            }
            if (activeSessions.length > 0) {
                log('INFO', `[HubOrchestrator] ${activeSessions.length} sessão(ões) ativa(s) restaurada(s) da DB.`);
            }
        } catch (/** @type {any} */ err) {
            log('WARN', `[HubOrchestrator] Falha ao restaurar turn counters: ${err.message}`);
        }

        log('DEBUG', '[HubOrchestrator] Inicializado com LlmBridgeClient.');
    }

    /**
     * Para o orquestrador e limpa recursos.
     *
     * @returns {void}
     */
    destroy() {
        this.#bridge = null;
        this.#turnCounters.clear();
        this.#inflightBySession.clear();
        this.#closedSessions.clear();
        this.removeAllListeners();
        log('DEBUG', '[HubOrchestrator] Destruído.');
    }

    // ─── Sessões ──────────────────────────────────────────────────────────────

    /**
     * Cria uma nova hub_session persistente.
     *
     * @param {{ title?: string; metadata?: object }} [opts]
     * @returns {string} ID da hub_session criada
     */
    createSession(opts = {}) {
        // Tenta obter o sdkSessionId atual do AlwaysAliveAgent
        let sdkSessionId;
        try {
            const agent = this.#agent ?? _fallbackAgent;
            if (!agent) throw new Error('agent not injected');
            const snap = /** @type {{ sessionId?: string }} */ (agent.getStatusSnapshot());
            sdkSessionId = snap.sessionId;
        } catch {
            sdkSessionId = undefined;
        }

        const hubSessionId = this.#store.createHubSession({
            title: opts.title ?? `Conversa ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
            ...(sdkSessionId !== undefined && { sdkSessionId }),
            ...(opts.metadata !== undefined && { metadata: opts.metadata }),
        });

        this.#turnCounters.set(hubSessionId, 0);

        this.emit('session:created', { hubSessionId, title: opts.title });
        log('INFO', `[HubOrchestrator] Hub session criada: ${hubSessionId}`);
        return hubSessionId;
    }

    /**
     * Encerra uma hub_session.
     *
     * @param {string} hubSessionId
     * @returns {void}
     */
    closeSession(hubSessionId) {
        this.#store.closeHubSession(hubSessionId);
        this.#turnCounters.delete(hubSessionId);
        this.#inflightBySession.delete(hubSessionId);
        // F6.5 (BUG-MOD-09): registrar no set de sessões fechadas para bloquear re-inserções zumbi
        // BUG-P2-09: limitar set para evitar crescimento indefinido em produção de longa duração
        if (this.#closedSessions.size >= 1000) {
            const first = this.#closedSessions.values().next().value;
            if (first !== undefined) this.#closedSessions.delete(first);
        }
        this.#closedSessions.add(hubSessionId);
        this.emit('session:closed', { hubSessionId });
        log('INFO', `[HubOrchestrator] Hub session encerrada: ${hubSessionId}`);
    }

    // ─── Envio e recepção de mensagens ────────────────────────────────────────

    /**
     * LLM-A envia uma mensagem para LLM-B via HubOrchestrator.
     *
     * 1. Persiste o turn de LLM-A
     * 2. Emite evento `turn:sent`
     * 3. Chama LlmBridgeClient.chatStructured() (ou chat()) com streaming
     * 4. Persiste o turn de LLM-B ao completar
     * 5. Emite evento `turn:complete`
     *
     * SERIALIZAÇÃO: chamadas concorrentes para a mesma hubSessionId são automaticamente enfileiradas via
     * #inflightBySession — nunca executam em paralelo. Isso previne race conditions no sendDialogTurn() e na escrita de
     * turns em SQLite.
     *
     * @param {string} hubSessionId
     * @param {string | object} message - Texto da mensagem ou StructuredMessageInput
     * @param {SendToLlmBOpts} [opts]
     * @returns {Promise<OrchestratorResult>}
     * @throws {Error} Se a sessão já estiver encerrada ou agente não estiver ativo
     */
    sendToLlmB(hubSessionId, message, opts = {}) {
        // F6.5 (BUG-MOD-09): bloquear novas mensagens para sessões já encerradas
        if (this.#closedSessions.has(hubSessionId)) {
            return Promise.reject(new Error(`[HubOrchestrator] Sessão já encerrada: ${hubSessionId}`));
        }

        // Encadeia na cauda da Promise existente para esta sessão (mutex por sessão)
        const prev = this.#inflightBySession.get(hubSessionId) ?? Promise.resolve();

        /** @type {Promise<OrchestratorResult>} */
        const next = prev.then(() => {
            // Verificação dupla: pode ter sido fechada enquanto aguardava na fila
            if (this.#closedSessions.has(hubSessionId)) {
                throw new Error(`[HubOrchestrator] Sessão encerrada durante enfileiramento: ${hubSessionId}`);
            }
            return this.#executeSendToLlmB(hubSessionId, message, opts);
        });

        // Cauda sem valor — quando completa (ok ou erro), limpa o mapa se ninguém mais se encadeou
        const tail = next.then(() => {}).catch(() => {});
        // F6.5: só inserir no mapa se a sessão ainda não foi fechada
        if (!this.#closedSessions.has(hubSessionId)) {
            this.#inflightBySession.set(hubSessionId, tail);
        }
        tail.then(() => {
            // Só remove se a cauda armazenada ainda é esta — indica que a fila está vazia
            if (this.#inflightBySession.get(hubSessionId) === tail) {
                this.#inflightBySession.delete(hubSessionId);
            }
        }).catch(() => {});

        return next;
    }

    /**
     * Implementação interna de sendToLlmB — executada de forma serializada pelo mutex.
     *
     * @param {string} hubSessionId
     * @param {string | object} message
     * @param {SendToLlmBOpts} opts
     * @returns {Promise<OrchestratorResult>}
     * @throws {Error} Se não inicializado, agente parado, ou turno não encontrado após writeTurn
     */
    async #executeSendToLlmB(hubSessionId, message, opts = {}) {
        if (!this.#bridge) {
            throw new Error('[HubOrchestrator] Não inicializado. Chame init() primeiro.');
        }

        // ARCH-02 fix: verificar que o agente está ativo antes de prosseguir
        const agentCheck = this.#agent ?? _fallbackAgent;
        if (!agentCheck || agentCheck.status === 'stopped') {
            throw new Error('[HubOrchestrator] AlwaysAliveAgent não está ativo');
        }

        const useStructured = opts.useStructured !== false;
        const timeoutMs = opts.timeoutMs ?? 120_000;
        const modelLabel = opts.model ?? 'gpt-4.1';

        // Conteúdo normalizado para string para persistência
        const messageContent = typeof message === 'string' ? message : JSON.stringify(message);

        // Persistir turn de LLM-A
        const sdkSessionId = this.#getActiveSdkSessionId();
        // F6.7 (BUG-MOD-14): logar traceId/correlationId no metadata do turn para rastreabilidade distribuída
        const structuredMeta =
            typeof message === 'object' && message !== null
                ? {
                      traceId: /** @type {Record<string, unknown>} */ (message)['traceId'],
                      correlationId: /** @type {Record<string, unknown>} */ (message)['correlationId'],
                  }
                : {};
        const llmATurnId = await this.#store.writeTurn(hubSessionId, {
            role: 'llm_a',
            content: messageContent,
            ...(sdkSessionId !== undefined && { sdkSessionId }),
            model: 'copilot-claude-sonnet-4.6',
            structured: typeof message === 'object' ? message : null,
            metadata: Object.keys(structuredMeta).length > 0 ? structuredMeta : null,
        });
        const llmATurn = this.#store.getTurn(llmATurnId);
        const turnNumber = llmATurn?.turn_number;
        if (!turnNumber) {
            throw new Error(`[HubOrchestrator] Turno ${llmATurnId} não encontrado após writeTurn`);
        }

        this.emit('turn:sent', {
            hubSessionId,
            turnId: llmATurnId,
            role: 'llm_a',
            content: messageContent,
            turnNumber,
        });

        log(
            'DEBUG',
            `[HubOrchestrator] Turno #${turnNumber} (LLM-A) enviado para LLM-B: ${messageContent.slice(0, 80)}...`,
        );

        // Invocar LLM-B com streaming
        const startTime = Date.now();
        /** @type {string} */ let llmBResponse;
        let llmBStructured = null;
        let parseError = null;

        try {
            // Preferir dialog loop (sendDialogTurn) quando ativo — mais eficiente (0 PR por turno)
            // Senão, usar LlmBridgeClient.chat() (1 PR por turno)
            const agentInst = this.#agent ?? _fallbackAgent;
            const useDialogLoop = agentInst?.dialogLoopActive === true;

            if (useDialogLoop) {
                llmBResponse = await this.#callViaDialogLoop(
                    message,
                    messageContent,
                    hubSessionId,
                    turnNumber,
                    timeoutMs,
                );
            } else if (useStructured && typeof message === 'object') {
                ({ llmBResponse, llmBStructured, parseError } = await this.#callViaStructured(
                    message,
                    hubSessionId,
                    turnNumber,
                    timeoutMs,
                ));
            } else {
                llmBResponse = await this.#callViaSimpleChat(messageContent, hubSessionId, turnNumber, timeoutMs);
            }
        } catch (/** @type {any} */ err) {
            const errMsg = `[HubOrchestrator] Erro na resposta de LLM-B: ${err.message}`;
            log('ERROR', errMsg);
            this.emit('error', { hubSessionId, message: errMsg, error: err });

            // Persistir o erro como turn de LLM-B para manter histórico completo
            await this.#store.writeTurn(hubSessionId, {
                role: 'llm_b',
                content: `[ERRO] ${err.message}`,
                ...(sdkSessionId !== undefined && { sdkSessionId }),
                model: modelLabel,
                durationMs: Date.now() - startTime,
                metadata: { error: true, errorMessage: err.message },
            });

            throw err;
        }

        const durationMs = Date.now() - startTime;

        // Persistir resposta de LLM-B
        const llmBTurnId = await this.#store.writeTurn(hubSessionId, {
            role: 'llm_b',
            content: llmBResponse,
            ...(sdkSessionId !== undefined && { sdkSessionId }),
            model: modelLabel,
            structured: llmBStructured,
            durationMs,
            metadata: parseError !== null ? { parseError } : null,
        });

        const llmBTurn = this.#store.getTurn(llmBTurnId);
        const llmBTurnNumber = llmBTurn?.turn_number ?? turnNumber + 1;

        this.emit('turn:complete', {
            hubSessionId,
            turnId: llmBTurnId,
            role: 'llm_b',
            content: llmBResponse,
            structured: llmBStructured,
            durationMs,
            turnNumber: llmBTurnNumber,
        });

        log('INFO', `[HubOrchestrator] Turno #${llmBTurnNumber} (LLM-B) completado em ${durationMs}ms.`);

        return {
            turnId: llmBTurnId,
            content: llmBResponse,
            structured: llmBStructured,
            durationMs,
            hubSessionId,
            turnNumber: llmBTurnNumber,
        };
    }

    // ─── Mensagens do usuário ─────────────────────────────────────────────────

    /**
     * Injeta uma mensagem do usuário na hub_session. LLM-A pode posteriormente chamá-la via pollUserMessages().
     *
     * @param {string} hubSessionId
     * @param {string} content
     * @param {{ metadata?: object }} [opts]
     * @returns {Promise<number>} ID do turno registrado
     */
    async injectUserMessage(hubSessionId, content, opts = {}) {
        const turnId = await this.#store.injectUserMessage(hubSessionId, content, opts);
        this.emit('user:injected', { hubSessionId, turnId, content });

        // Notifica LLM-A que há uma mensagem pendente do usuário para processar.
        // Se um sendToLlmB() estiver em andamento (inflight), o evento serve como sinal para
        // que LLM-A chame pollUserMessages() ao completar o turn atual.
        const hasTurnInFlight = this.#inflightBySession.has(hubSessionId);
        if (hasTurnInFlight) {
            this.emit('turn:user_pending', { hubSessionId, turnId, content });
            log(
                'INFO',
                `[HubOrchestrator] Mensagem do usuário injetada (turn em andamento) na sessão ${hubSessionId} — turn:user_pending emitido.`,
            );
        } else {
            log('INFO', `[HubOrchestrator] Mensagem do usuário injetada na sessão ${hubSessionId}.`);
        }
        return turnId;
    }

    /**
     * Retorna as mensagens do usuário ainda não processadas por LLM-A. Marca automaticamente as mensagens como lidas
     * após retorná-las.
     *
     * @param {string} hubSessionId
     * @returns {import('./store.js').ConversationTurn[]}
     */
    pollUserMessages(hubSessionId) {
        const msgs = this.#store.getPendingUserMessages(hubSessionId);
        if (msgs.length > 0) {
            this.#store.markAllUserMessagesRead(hubSessionId);
            log('DEBUG', `[HubOrchestrator] ${msgs.length} mensagem(ns) do usuário processada(s).`);
        }
        return msgs;
    }

    // ─── Notificação de turnos externos ──────────────────────────────────────

    /**
     * FLOW-UPG-01: Notifica o Orchestrator sobre um turno já persistido no ConversationStore pelo terminal (dialog.js).
     * Emite `turn:sent` e `turn:complete` para que LLM-A e listeners de SSE vejam as mensagens do usuário humano
     * digitadas diretamente no terminal.
     *
     * Não re-persiste turnos — apenas emite os eventos com os IDs já gravados.
     *
     * @param {string} hubSessionId
     * @param {{ turnId: number; role: 'user' | 'llm_a'; content: string; turnNumber: number; source?: string }} userTurn
     * @param {{ turnId: number; content: string; turnNumber: number; durationMs: number }} llmBTurn
     * @returns {void}
     */
    notifyTerminalTurn(hubSessionId, userTurn, llmBTurn) {
        this.emit('turn:sent', {
            hubSessionId,
            turnId: userTurn.turnId,
            role: userTurn.role,
            content: userTurn.content,
            turnNumber: userTurn.turnNumber,
            source: userTurn.source ?? 'terminal',
        });
        this.emit('turn:complete', {
            hubSessionId,
            turnId: llmBTurn.turnId,
            role: 'llm_b',
            content: llmBTurn.content,
            structured: null,
            durationMs: llmBTurn.durationMs,
            turnNumber: llmBTurn.turnNumber,
            source: 'terminal',
        });
        log(
            'DEBUG',
            `[HubOrchestrator] FLOW-01: notifyTerminalTurn emitido (user=${userTurn.turnId}, llm_b=${llmBTurn.turnId}).`,
        );
    }

    // ─── Histórico ────────────────────────────────────────────────────────────

    /**
     * Lê o histórico de turns de uma hub_session.
     *
     * @param {string} hubSessionId
     * @param {import('./store.js').ReadTurnsOpts} [opts]
     * @returns {import('./store.js').ConversationTurn[]}
     */
    readHistory(hubSessionId, opts = {}) {
        return this.#store.readTurns(hubSessionId, opts);
    }

    /**
     * Lista as hub_sessions disponíveis.
     *
     * @param {{ limit?: number; offset?: number; status?: import('./store.js').HubSessionStatus }} [opts]
     * @returns {import('./store.js').HubSession[]}
     */
    listSessions(opts = {}) {
        return this.#store.listHubSessions(opts);
    }

    // ─── Helpers internos ─────────────────────────────────────────────────────

    /**
     * Obtém o sdkSessionId ativo do AlwaysAliveAgent.
     *
     * @returns {string | undefined}
     */
    #getActiveSdkSessionId() {
        try {
            // BUG-06 (fix): usar agentOverride quando fornecido em vez de hardcodar alwaysAliveAgent
            const activeAgent = this.#agent ?? _fallbackAgent;
            if (!activeAgent) return undefined;
            const snap = /** @type {{ sessionId?: string }} */ (activeAgent.getStatusSnapshot());
            return snap.sessionId;
        } catch {
            return undefined;
        }
    }

    /**
     * Envia message via Dialog Loop (sendDialogTurn). Emite `turn:delta` em tempo real via task.delta do agente.
     *
     * @param {string | object} message
     * @param {string} messageContent - Versão string normalizada
     * @param {string} hubSessionId
     * @param {number} turnNumber
     * @param {number} timeoutMs
     * @returns {Promise<string>}
     * @throws {Error} Se agentInst não suportar sendDialogTurn
     */
    async #callViaDialogLoop(message, messageContent, hubSessionId, turnNumber, timeoutMs) {
        const agentInst = this.#agent ?? _fallbackAgent;
        if (!agentInst?.sendDialogTurn) {
            throw new Error('[HubOrchestrator] agentInst não suporta sendDialogTurn');
        }
        const content = typeof message === 'string' ? message : messageContent;
        log('DEBUG', `[HubOrchestrator] Usando sendDialogTurn (modo eficiente) para turno #${turnNumber + 1}.`);
        // BUG-HIGH-03 (fix): capturar task.delta durante sendDialogTurn para emitir turn:delta em tempo real
        const onDelta = (/** @type {{ chunk: string }} */ evt) => {
            const chunk = evt?.chunk ?? '';
            if (chunk) this.emit('turn:delta', { hubSessionId, chunk, turnNumber: turnNumber + 1 });
        };
        agentInst.on?.('task.delta', onDelta);
        try {
            return await agentInst.sendDialogTurn(content, { timeout: timeoutMs });
        } finally {
            agentInst.off?.('task.delta', onDelta);
        }
    }

    /**
     * Envia message via chatStructured() com StructuredMessage.
     *
     * @param {object} message
     * @param {string} hubSessionId
     * @param {number} turnNumber
     * @param {number} timeoutMs
     * @returns {Promise<{ llmBResponse: string; llmBStructured: object | null; parseError: unknown }>}
     * @throws {Error} Se não inicializado
     */
    async #callViaStructured(message, hubSessionId, turnNumber, timeoutMs) {
        if (!this.#bridge) throw new Error('[HubOrchestrator] Não inicializado.');
        /** @type {string} */ let accumulated = '';
        const result = await this.#bridge.chatStructured(
            /** @type {import('#copilot/types/structured-message').StructuredMessageInput} */ (message),
            {
                onDelta: (chunk) => {
                    accumulated += chunk;
                    this.emit('turn:delta', { hubSessionId, chunk, turnNumber: turnNumber + 1 });
                },
                timeoutMs,
            },
        );
        return {
            llmBResponse: result.raw ?? accumulated,
            llmBStructured: result.structured ?? null,
            parseError: result.parseError ?? null,
        };
    }

    /**
     * Envia message via chat() simples (fallback). ARCH-03: registra WARN pois indica useStructured=false ou mensagem
     * em formato inesperado.
     *
     * @param {string} messageContent
     * @param {string} hubSessionId
     * @param {number} turnNumber
     * @param {number} timeoutMs
     * @returns {Promise<string>}
     * @throws {Error} Se não inicializado
     */
    async #callViaSimpleChat(messageContent, hubSessionId, turnNumber, timeoutMs) {
        if (!this.#bridge) throw new Error('[HubOrchestrator] Não inicializado.');
        log(
            'WARN',
            `[HubOrchestrator] Usando chat() simples (fallback path) para hubSession=${hubSessionId}, messageType=string`,
        );
        const result = await this.#bridge.chat(messageContent, {
            onDelta: (chunk) => {
                this.emit('turn:delta', { hubSessionId, chunk, turnNumber: turnNumber + 1 });
            },
            timeoutMs,
        });
        return result.response;
    }
}
