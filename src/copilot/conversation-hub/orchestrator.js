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
 */

import { log } from '#core/logger';
import EventEmitter from 'node:events';
import { alwaysAliveAgent } from '../always-alive.js';
import { LlmBridgeClient } from '../llm-bridge-client.js';

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

    /** @type {{ getStatusSnapshot(): object } | null} */
    #agent = null;

    /** @type {Map<string, number>} hubSessionId → próximo turn_number esperado */
    #turnCounters = new Map();

    /**
     * @param {import('./store.js').ConversationStore} store
     * @param {{ getStatusSnapshot(): object }} [agentOverride] - AlwaysAliveAgent a usar (útil em testes).
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
                const count = this.#store.countTurns(session.hubSessionId);
                this.#turnCounters.set(session.hubSessionId, count);
                log('DEBUG', `[HubOrchestrator] Sessão ${session.hubSessionId}: ${count} turns restaurados.`);
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
            const agent = this.#agent ?? alwaysAliveAgent;
            const snap = /** @type {{ sessionId?: string }} */ (agent.getStatusSnapshot());
            sdkSessionId = snap.sessionId;
        } catch {
            sdkSessionId = undefined;
        }

        const hubSessionId = this.#store.createHubSession({
            title: opts.title ?? `Conversa ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
            sdkSessionId,
            metadata: opts.metadata,
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
     * @param {string} hubSessionId
     * @param {string | object} message - Texto da mensagem ou StructuredMessageInput
     * @param {SendToLlmBOpts} [opts]
     * @returns {Promise<OrchestratorResult>}
     */
    async sendToLlmB(hubSessionId, message, opts = {}) {
        if (!this.#bridge) {
            throw new Error('[HubOrchestrator] Não inicializado. Chame init() primeiro.');
        }

        const useStructured = opts.useStructured !== false;
        const timeoutMs = opts.timeoutMs ?? 120_000;
        const modelLabel = opts.model ?? 'gpt-4.1';

        // Conteúdo normalizado para string para persistência
        const messageContent = typeof message === 'string' ? message : JSON.stringify(message);

        // Persistir turn de LLM-A
        const sdkSessionId = this.#getActiveSdkSessionId();
        const llmATurnId = this.#store.writeTurn(hubSessionId, {
            role: 'llm_a',
            content: messageContent,
            sdkSessionId,
            model: 'copilot-claude-sonnet-4.6',
            structured: typeof message === 'object' ? message : null,
        });

        const llmATurn = this.#store.getTurn(llmATurnId);
        const turnNumber = llmATurn?.turn_number ?? 0;

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
        let llmBResponse = '';
        let llmBStructured = null;
        let parseError = null;

        try {
            // Preferir dialog loop (sendDialogTurn) quando ativo — mais eficiente (0 PR por turno)
            // Senão, usar LlmBridgeClient.chat() (1 PR por turno)
            const agentInst = this.#agent ?? alwaysAliveAgent;
            const useDialogLoop = /** @type {any} */ (agentInst).dialogLoopActive === true;

            if (useDialogLoop) {
                const content = typeof message === 'string' ? message : messageContent;
                log('DEBUG', `[HubOrchestrator] Usando sendDialogTurn (modo eficiente) para turno #${turnNumber + 1}.`);
                llmBResponse = await /** @type {any} */ (agentInst).sendDialogTurn(content, { timeout: timeoutMs });
            } else if (useStructured && typeof message === 'object') {
                // Usar chatStructured() com StructuredMessage
                const result = await this.#bridge.chatStructured(/** @type {any} */ (message), {
                    onDelta: (chunk) => {
                        llmBResponse += chunk;
                        this.emit('turn:delta', { hubSessionId, chunk, turnNumber: turnNumber + 1 });
                    },
                    timeoutMs,
                });
                llmBResponse = result.raw?.response ?? llmBResponse;
                llmBStructured = result.structured;
                if (result.parseError) parseError = result.parseError;
            } else {
                // Usar chat() simples
                const content = typeof message === 'string' ? message : messageContent;
                const result = await this.#bridge.chat(content, {
                    onDelta: (chunk) => {
                        llmBResponse += chunk;
                        this.emit('turn:delta', { hubSessionId, chunk, turnNumber: turnNumber + 1 });
                    },
                    timeoutMs,
                });
                llmBResponse = result.response;
            }
        } catch (/** @type {any} */ err) {
            const errMsg = `[HubOrchestrator] Erro na resposta de LLM-B: ${err.message}`;
            log('ERROR', errMsg);
            this.emit('error', { hubSessionId, message: errMsg, error: err });

            // Persistir o erro como turn de LLM-B para manter histórico completo
            this.#store.writeTurn(hubSessionId, {
                role: 'llm_b',
                content: `[ERRO] ${err.message}`,
                sdkSessionId,
                model: modelLabel,
                durationMs: Date.now() - startTime,
                metadata: { error: true, errorMessage: err.message },
            });

            throw err;
        }

        const durationMs = Date.now() - startTime;

        // Persistir resposta de LLM-B
        const llmBTurnId = this.#store.writeTurn(hubSessionId, {
            role: 'llm_b',
            content: llmBResponse,
            sdkSessionId,
            model: modelLabel,
            structured: llmBStructured,
            durationMs,
            metadata: parseError ? { parseError } : null,
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
     * @returns {number} ID do turno registrado
     */
    injectUserMessage(hubSessionId, content, opts = {}) {
        const turnId = this.#store.injectUserMessage(hubSessionId, content, opts);
        this.emit('user:injected', { hubSessionId, turnId, content });
        log('INFO', `[HubOrchestrator] Mensagem do usuário injetada na sessão ${hubSessionId}.`);
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
            const snap = /** @type {{ sessionId?: string }} */ (alwaysAliveAgent.getStatusSnapshot());
            return snap.sessionId;
        } catch {
            return undefined;
        }
    }
}
