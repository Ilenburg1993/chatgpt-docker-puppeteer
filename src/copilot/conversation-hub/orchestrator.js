// @ts-check
/**
 * @module copilot/conversation-hub/orchestrator
 * @file Orquestrador de conversas multi-sessão: gerencia criação, roteamento e ciclo de vida de sessões no hub,
 *   delegando ao LlmBridgeClient.
 *
 *   src/copilot/conversation-hub/orchestrator.js
 * @see EventBus
 * @see module:copilot/conversation-hub/store
 * @see module:copilot/conversation-hub/hub
 * @see module:copilot/always-alive
 */

import { getSharedSdkSessionId, SessionError, toError } from '#copilot/core';
import { HUB_EVENTS } from '#copilot/events';
import { log } from '#copilot/observability';
import { EventEmitter } from 'node:events';
import { LlmBridgeClient } from '../channel/client.js';
import { logSwallowed } from '../core/error-handlers.js';
import { executeSendToLlmB } from './send-pipeline.js';

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
/**
 * @typedef {Object} SendToLlmBOpts
 * @property {boolean} [useStructured] - Usar chatStructured() em vez de chat() (default: true)
 * @property {number} [timeoutMs] - Timeout para a resposta (default: 120000)
 * @property {string} [model] - Modelo a registrar no turn (default: 'gpt-4.1')
 * @property {object} [structuredInput] - Campos extras para chatStructured() (context, intent, etc.)
 *
 * @typedef {Object} OrchestratorResult
 * @property {number} turnId - ID do turn registrado no ConversationStore
 * @property {string} content - Resposta completa de LLM-B
 * @property {object | null} structured - StructuredMessage parseado (se useStructured=true)
 * @property {number} durationMs - Duração da resposta
 * @property {string} hubSessionId - ID da hub_session
 * @property {number} turnNumber - Número sequencial do turno
 */

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
        } catch (err) {
            log('WARN', `[HubOrchestrator] Falha ao restaurar turn counters: ${toError(err).message}`);
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

    /**
     * Cria uma nova hub_session persistente.
     *
     * @param {{ title?: string; metadata?: object }} [opts]
     * @returns {string} ID da hub_session criada
     */
    createSession(opts = {}) {
        const sdkSessionId = this.#getActiveSdkSessionId();

        const hubSessionId = this.#store.createHubSession({
            title: opts.title ?? `Conversa ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
            ...(sdkSessionId !== undefined && { sdkSessionId }),
            ...(opts.metadata !== undefined && { metadata: opts.metadata }),
        });

        this.#turnCounters.set(hubSessionId, 0);

        this.emit(HUB_EVENTS.SESSION_CREATED, { hubSessionId, title: opts.title });
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
        this.emit(HUB_EVENTS.SESSION_CLOSED, { hubSessionId });
        log('INFO', `[HubOrchestrator] Hub session encerrada: ${hubSessionId}`);
    }

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
            return Promise.reject(
                new SessionError(`[HubOrchestrator] Sessão já encerrada: ${hubSessionId}`, 'ORCH_SESSION_ENDED'),
            );
        }

        // Encadeia na cauda da Promise existente para esta sessão (mutex por sessão)
        const prev = this.#inflightBySession.get(hubSessionId) ?? Promise.resolve();

        /** @type {Promise<OrchestratorResult>} */
        const next = prev.then(() => {
            // Verificação dupla: pode ter sido fechada enquanto aguardava na fila
            if (this.#closedSessions.has(hubSessionId)) {
                throw new SessionError(
                    `[HubOrchestrator] Sessão encerrada durante enfileiramento: ${hubSessionId}`,
                    'ORCH_SESSION_ENDED',
                );
            }
            return this.#executeSendToLlmB(hubSessionId, message, opts);
        });

        // Cauda sem valor — quando completa (ok ou erro), limpa o mapa se ninguém mais se encadeou
        const tail = next.then(() => {}).catch((e) => logSwallowed(e, 'hub.orchestrator.tail'));
        // F6.5: só inserir no mapa se a sessão ainda não foi fechada
        if (!this.#closedSessions.has(hubSessionId)) {
            this.#inflightBySession.set(hubSessionId, tail);
        }
        tail.then(() => {
            // Só remove se a cauda armazenada ainda é esta — indica que a fila está vazia
            if (this.#inflightBySession.get(hubSessionId) === tail) {
                this.#inflightBySession.delete(hubSessionId);
            }
        }).catch((e) => logSwallowed(e, 'hub.orchestrator.inflightCleanup'));

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
        return executeSendToLlmB(hubSessionId, message, opts, {
            store: this.#store,
            bridge: this.#bridge,
            agent: this.#agent,
            fallbackAgent: _fallbackAgent,
            emit: this.emit.bind(this),
            getActiveSdkSessionId: () => this.#getActiveSdkSessionId(),
        });
    }

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
        this.emit(HUB_EVENTS.USER_INJECTED, { hubSessionId, turnId, content });

        // Notifica LLM-A que há uma mensagem pendente do usuário para processar.
        // Se um sendToLlmB() estiver em andamento (inflight), o evento serve como sinal para
        // que LLM-A chame pollUserMessages() ao completar o turn atual.
        const hasTurnInFlight = this.#inflightBySession.has(hubSessionId);
        if (hasTurnInFlight) {
            this.emit(HUB_EVENTS.TURN_USER_PENDING, { hubSessionId, turnId, content });
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
        this.emit(HUB_EVENTS.TURN_SENT, {
            hubSessionId,
            turnId: userTurn.turnId,
            role: userTurn.role,
            content: userTurn.content,
            turnNumber: userTurn.turnNumber,
            source: userTurn.source ?? 'terminal',
        });
        this.emit(HUB_EVENTS.TURN_COMPLETE, {
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

    /**
     * Lê o histórico de turns de uma hub_session.
     *
     * @param {string} hubSessionId
     * @param {import('./store-helpers.js').ReadTurnsOpts} [opts]
     * @returns {import('./store.js').ConversationTurn[]}
     */
    readHistory(hubSessionId, opts = {}) {
        return this.#store.readTurns(hubSessionId, opts);
    }

    /**
     * Lista as hub_sessions disponíveis.
     *
     * @param {{ limit?: number; offset?: number; status?: import('./store-helpers.js').HubSessionStatus }} [opts]
     * @returns {import('./store.js').HubSession[]}
     */
    listSessions(opts = {}) {
        return this.#store.listHubSessions(opts);
    }

    /**
     * Obtém o sdkSessionId ativo do AlwaysAliveAgent.
     *
     * @returns {string | undefined}
     */
    #getActiveSdkSessionId() {
        const shared = getSharedSdkSessionId();
        if (shared) return shared;

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
}
