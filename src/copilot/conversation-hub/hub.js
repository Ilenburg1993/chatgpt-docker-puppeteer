// @ts-check
/**
 * src/copilot/conversation-hub/hub.js
 *
 * ConversationHub — singleton que compõe ConversationStore + HubOrchestrator + Namespace Socket.io.
 *
 * É o ponto de entrada único para o ambiente permanente LLM-A ↔ LLM-B ↔ Usuário. Deve ser inicializado via
 * conversationHub.init({ io, nerv }) ou conversationHub.init() (standalone) no boot.
 *
 * @module copilot/conversation-hub/hub
 * @see module:copilot/conversation-hub/orchestrator
 * @see module:copilot/bridges/nerv-event-bus-adapterbus-adapter
 */

import { EVENT_BUS, SessionError, bridgeEmitter, logSwallowed, registerShutdownHandler } from '#copilot/core';
import {
    HUB_EVENTS,
    HUB_SESSION_CLOSED,
    HUB_SESSION_CREATED,
    HUB_TURN_COMPLETE,
    HUB_TURN_SENT,
    HUB_USER_INJECTED,
} from '#copilot/events';
import { log } from '#copilot/observability';
import { container } from '../core/di-container.js';
import { setCopilotNamespace } from './broadcast.js';
import { HubOrchestrator } from './orchestrator.js';
import { conversationStore } from './store.js';

// ─── ConversationHub ──────────────────────────────────────────────────────────

/**
 * @typedef {Object} HubInitOpts
 * @property {import('socket.io').Server} [io] - Instância Socket.io Server (opcional — se omitido, inicia sem realtime)
 * @property {(
 *     io: import('socket.io').Server,
 *     orchestrator: HubOrchestrator,
 *     store: import('./store.js').ConversationStore,
 * ) => void} [mountFn]
 *   - Função de montagem do namespace Socket.IO (injetada pelo server layer para evitar dependência direta). Se omitida,
 *       socket mounting é responsabilidade do chamador (ex.: createCopilotSocket).
 *
 * @property {{ emitEvent?: (e: { source: string; actionCode: string; payload: unknown; ts: number }) => void }} [nerv]
 *   - Instância NERV bus (opcional, para forwarding de eventos)
 */

/**
 * ConversationHub — ambiente permanente LLM-A ↔ LLM-B ↔ Usuário.
 *
 * Compõe:
 *
 * - ConversationStore (SQLite, persistência)
 * - HubOrchestrator (lógica de diálogo)
 * - Namespace /copilot (Socket.io, tempo real)
 */
export class ConversationHub {
    /** @type {HubOrchestrator | null} */
    #orchestrator = null;

    /** @type {boolean} */
    #initialized = false;

    // ─── Inicialização ─────────────────────────────────────────────────────────

    /**
     * Inicializa todos os componentes do hub. É idempotente: chamadas adicionais são no-op.
     *
     * Se `io` for omitido, inicializa sem Socket.IO (equivalente ao antigo `initStandalone()`). Socket.IO pode ser
     * conectado posteriormente via {@link attachSocketIO}.
     *
     * @param {HubInitOpts} [opts]
     * @returns {Promise<void>}
     */
    async init(opts) {
        if (this.#initialized) {
            log('WARN', '[ConversationHub] já inicializado, ignorando re-init.');
            return;
        }

        // 1. Inicializar store (DDL idempotente)
        conversationStore.init();

        // 2. Criar orquestrador
        this.#orchestrator = new HubOrchestrator(conversationStore);
        this.#orchestrator.init();

        // 3. Montar namespace Socket.io /copilot (se io e mountFn fornecidos)
        // Faixa-3.1: mountFn é injetada pelo server layer — hub.js não importa de server/
        if (opts?.io) {
            if (opts.mountFn) {
                opts.mountFn(opts.io, this.#orchestrator, conversationStore);
            } else {
                log(
                    'DEBUG',
                    '[ConversationHub] opts.io fornecido sem opts.mountFn — namespace Socket.IO montado externamente (createCopilotSocket).',
                );
            }
        }

        // 4. (Opcional) Encaminhar eventos para NERV bus
        if (opts?.nerv) {
            this.#bridgeToNerv(opts.nerv);
        }

        // 5. M-3: Bridge Orchestrator → EventBus centralizado
        this.#bridgeToEventBus();

        this.#initialized = true;
        const mode = opts?.io ? 'completo (Socket.IO + EventBus)' : 'standalone (sem Socket.IO)';
        log('INFO', `[ConversationHub] Inicializado — modo ${mode}.`);
    }

    /**
     * Conecta Socket.IO ao hub já inicializado. Permite iniciar sem io e fazer upgrade depois.
     *
     * @param {import('socket.io').Server} io
     * @returns {void}
     * @throws {SessionError} Se hub não inicializado
     */
    /**
     * Conecta Socket.IO ao hub já inicializado via função de montagem injetável. Permite iniciar sem io e fazer upgrade
     * depois (ex.: terminal standalone → full).
     *
     * @param {import('socket.io').Server} io
     * @param {(
     *     io: import('socket.io').Server,
     *     orchestrator: HubOrchestrator,
     *     store: import('./store.js').ConversationStore,
     * ) => void} [mountFn]
     *   - Função de montagem injetada pelo server layer. Se omitida, namespace já deve estar montado.
     *
     * @returns {void}
     * @throws {SessionError} Se hub não inicializado
     */
    attachSocketIO(io, mountFn) {
        if (!this.#initialized || !this.#orchestrator) {
            throw new SessionError(
                '[ConversationHub] Não inicializado. Chame init() antes de attachSocketIO().',
                'HUB_NOT_INITIALIZED',
            );
        }
        if (mountFn) {
            mountFn(io, this.#orchestrator, conversationStore);
            log('INFO', '[ConversationHub] Socket.IO conectado via attachSocketIO() com mountFn.');
        } else {
            log('INFO', '[ConversationHub] Socket.IO disponível — namespace já montado por createCopilotSocket().');
        }
    }

    // ─── Acesso ao orquestrador ────────────────────────────────────────────────

    /**
     * Retorna o HubOrchestrator. Lança erro se o hub não foi inicializado.
     *
     * @returns {HubOrchestrator}
     * @throws {Error} Se hub não inicializado
     * @see HubOrchestrator
     * @see ConversationStore
     */
    get orchestrator() {
        if (!this.#orchestrator) {
            throw new SessionError('[ConversationHub] Não inicializado. Chame init() primeiro.', 'HUB_NOT_INITIALIZED');
        }
        return this.#orchestrator;
    }

    /**
     * Retorna o ConversationStore.
     *
     * @returns {import('./store.js').ConversationStore}
     */
    get store() {
        return conversationStore;
    }

    /**
     * Se o hub está inicializado e pronto.
     *
     * @returns {boolean}
     */
    get isReady() {
        return this.#initialized;
    }

    // ─── Atalhos de API ────────────────────────────────────────────────────────

    /**
     * Cria uma nova hub_session de conversa.
     *
     * @param {{ title?: string; metadata?: object }} [opts]
     * @returns {string} hubSessionId
     */
    createSession(opts = {}) {
        return this.orchestrator.createSession(opts);
    }

    /**
     * LLM-A envia mensagem para LLM-B via hub.
     *
     * @param {string} hubSessionId
     * @param {string | object} message
     * @param {import('./orchestrator.js').SendToLlmBOpts} [opts]
     * @returns {Promise<import('./orchestrator.js').OrchestratorResult>}
     */
    sendToLlmB(hubSessionId, message, opts = {}) {
        return this.orchestrator.sendToLlmB(hubSessionId, message, opts);
    }

    /**
     * Injeta mensagem do usuário na conversa.
     *
     * @param {string} hubSessionId
     * @param {string} content
     * @param {{ metadata?: object }} [opts]
     * @returns {Promise<number>} turnId
     */
    injectUserMessage(hubSessionId, content, opts = {}) {
        return this.orchestrator.injectUserMessage(hubSessionId, content, opts);
    }

    /**
     * LLM-A verifica mensagens pendentes do usuário.
     *
     * @param {string} hubSessionId
     * @returns {import('./store.js').ConversationTurn[]}
     */
    pollUserMessages(hubSessionId) {
        return this.orchestrator.pollUserMessages(hubSessionId);
    }

    /**
     * FLOW-UPG-01: Notifica o Orchestrator sobre um turno já persistido pelo terminal (dialog.js). Emite `turn:sent` e
     * `turn:complete` para que LLM-A e listeners de SSE vejam a conversa do usuário humano digitada diretamente no
     * terminal.
     *
     * @param {string} hubSessionId
     * @param {{ turnId: number; role: 'user' | 'llm_a'; content: string; turnNumber: number; source?: string }} userTurn
     * @param {{ turnId: number; content: string; turnNumber: number; durationMs: number }} llmBTurn
     * @returns {void}
     */
    notifyTerminalTurn(hubSessionId, userTurn, llmBTurn) {
        return this.orchestrator.notifyTerminalTurn(hubSessionId, userTurn, llmBTurn);
    }

    // ─── Encerramento ──────────────────────────────────────────────────────────

    /**
     * Para o hub e libera recursos.
     *
     * @returns {void}
     */
    stop() {
        if (this.#orchestrator) {
            this.#orchestrator.destroy();
            this.#orchestrator = null;
        }
        // ARCH-06 fix / Faixa-3.1: limpar referência do namespace de broadcast
        // O server layer (createCopilotSocket) cuida do unmount real via io.close() no shutdown handler.
        setCopilotNamespace(null);
        this.#initialized = false;
        log('INFO', '[ConversationHub] Parado.');
    }

    /**
     * ARCH-N08 (fix): Encerra o hub graciosamente — fecha todas as sessões ativas antes de destruir recursos.
     *
     * @returns {Promise<void>}
     */
    async close() {
        if (!this.#initialized) return;

        // Fechar todas as sessões ativas no orchestrator
        if (this.#orchestrator) {
            try {
                const activeSessions = conversationStore.listHubSessions({ status: 'active' });
                for (const session of activeSessions) {
                    try {
                        this.#orchestrator.closeSession(session.id);
                    } catch (e) {
                        logSwallowed(e, 'hub.closeSession');
                    }
                }
            } catch (e) {
                logSwallowed(e, 'hub.listSessionsOnShutdown');
            }
        }

        this.stop();
        log('INFO', '[ConversationHub] Encerramento gracioso concluído.');
    }

    // ─── Integração NERV ───────────────────────────────────────────────────────

    /**
     * Encaminha eventos do HubOrchestrator para o NERV bus.
     *
     * @param {{ emitEvent?: (e: { source: string; actionCode: string; payload: unknown; ts: number }) => void }} nerv
     * @returns {void}
     */
    /**
     * M-3: Re-emite eventos significativos do Orchestrator no EventBus centralizado. Permite que qualquer módulo ouça
     * eventos hub via EventBus (use constantes de `#copilot/events`).
     */
    #bridgeToEventBus() {
        if (!this.#orchestrator) return;
        try {
            const bus = container.resolve(EVENT_BUS);
            if (!bus) return;
            bridgeEmitter(this.#orchestrator, bus, {
                [HUB_EVENTS.SESSION_CREATED]: HUB_SESSION_CREATED,
                [HUB_EVENTS.SESSION_CLOSED]: HUB_SESSION_CLOSED,
                [HUB_EVENTS.TURN_SENT]: HUB_TURN_SENT,
                [HUB_EVENTS.TURN_COMPLETE]: HUB_TURN_COMPLETE,
                [HUB_EVENTS.USER_INJECTED]: HUB_USER_INJECTED,
            });
            log('DEBUG', '[ConversationHub] Bridge EventBus vinculado.');
        } catch {
            // EventBus não registrado no DI — ignorar
        }
    }

    /** @param {{ emitEvent?: (e: { source: string; actionCode: string; payload: unknown; ts: number }) => void }} nerv */
    #bridgeToNerv(nerv) {
        if (!this.#orchestrator) return;

        /** @param {string} actionCode @param {unknown} payload */
        const emit = (actionCode, payload) => {
            try {
                nerv.emitEvent?.({
                    source: 'copilot-hub',
                    actionCode,
                    payload,
                    ts: Date.now(),
                });
            } catch (_err) {
                // NERV indisponível — ignorar silenciosamente
            }
        };

        this.#orchestrator.on(HUB_EVENTS.SESSION_CREATED, (d) => emit('copilot.hub.session.created', d));
        this.#orchestrator.on(HUB_EVENTS.SESSION_CLOSED, (d) => emit('copilot.hub.session.closed', d));
        this.#orchestrator.on(HUB_EVENTS.TURN_SENT, (d) => emit('copilot.hub.turn.sent', d));
        this.#orchestrator.on(HUB_EVENTS.TURN_COMPLETE, (d) => emit('copilot.hub.turn.complete', d));
        this.#orchestrator.on(HUB_EVENTS.USER_INJECTED, (d) => emit('copilot.hub.user.injected', d));
        this.#orchestrator.on('error', (d) => emit('copilot.hub.error', d));

        log('DEBUG', '[ConversationHub] Bridge NERV vinculado.');
    }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

/**
 * Instância singleton do ConversationHub. Inicialize com `conversationHub.init()` ou `init({ io })` no boot.
 *
 * @type {ConversationHub}
 */
export const conversationHub = new ConversationHub();

// FAIXA-0: graceful shutdown — fechar sessions e orchestrator
registerShutdownHandler(
    'hub.close',
    async () => {
        await conversationHub.close();
    },
    10,
);
