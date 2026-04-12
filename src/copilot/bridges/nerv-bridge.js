// @ts-check
/**
 * src/copilot/bridges/nerv-bridge.js
 *
 * Bridge entre o AlwaysAliveAgent (EventEmitter) e o NERV event bus.
 *
 * Responsabilidades:
 *
 * - Receber a instância NERV por injeção (setNerv / mount)
 * - Registrar listeners nos eventos do alwaysAliveAgent
 * - Reemitir cada evento como um envelope NERV com actor/actionCode estruturado
 * - Operar de forma totalmente opcional — se NERV não for injetado, é um no-op
 *
 * Padrão de uso (em main.js ou no bootstrap do servidor):
 *
 * ```javascript
 * import { copilotNervBridge } from '#copilot/nerv-bridge';
 * copilotNervBridge.mount(nerv); // injeta o NERV
 * copilotNervBridge.unmount(); // desregistra (cleanup)
 * ```
 *
 * @module copilot/bridges/nerv-bridge
 * @see EventBus
 * @see module:copilot/always-alive
 * @see module:copilot/conversation-hub/hub
 */

import { registerShutdownHandler } from '#copilot/core';
import { log } from '#copilot/observability';
import { onSessionEvent } from '#copilot/sdk';

/**
 * @typedef {import('../agent/always-alive.js').AlwaysAliveAgent} AlwaysAliveAgentLike
 */

/**
 * Referência ao agente injetada via `registerNervBridgeAgent()`.
 * Não importamos `agent/` diretamente para evitar inversão de camada (bridges → agent).
 *
 * @type {AlwaysAliveAgentLike | null}
 */
let _agent = null;

/**
 * Registra a instância do AlwaysAliveAgent para uso pelo bridge.
 * Deve ser chamado no bootstrap (main.js) antes de qualquer `mount()`.
 *
 * @param {AlwaysAliveAgentLike} agent
 * @returns {void}
 */
export function registerNervBridgeAgent(agent) {
    _agent = agent;
}

/**
 * Retorna o agent registrado. Utilitário interno.
 *
 * @returns {AlwaysAliveAgentLike}
 */
function getAgent() {
    if (!_agent) throw new Error('[nerv-bridge] Agent não registrado — chame registerNervBridgeAgent() no bootstrap.');
    return _agent;
}

/**
 * Mapa de eventos do AlwaysAliveAgent → actionCode NERV.
 *
 * ARCH-02 (fix): todos os 22 eventos de AGENT_EVENTS mapeados (antes apenas 9).
 *
 * @type {ReadonlyArray<{ event: string; actionCode: string }>}
 */
const EVENT_MAP = [
    { event: 'status', actionCode: 'COPILOT_AGENT_STATUS' },
    { event: 'task.queued', actionCode: 'COPILOT_TASK_QUEUED' },
    { event: 'task.started', actionCode: 'COPILOT_TASK_STARTED' },
    { event: 'task.completed', actionCode: 'COPILOT_TASK_COMPLETED' },
    { event: 'task.error', actionCode: 'COPILOT_TASK_ERROR' },
    { event: 'task.delta', actionCode: 'COPILOT_TASK_DELTA' },
    { event: 'task.reasoning', actionCode: 'COPILOT_TASK_REASONING' },
    { event: 'question.pending', actionCode: 'COPILOT_QUESTION_PENDING' },
    { event: 'question.answered', actionCode: 'COPILOT_QUESTION_ANSWERED' },
    { event: 'ready', actionCode: 'COPILOT_AGENT_READY' },
    { event: 'error', actionCode: 'COPILOT_AGENT_ERROR' },
    { event: 'stopped', actionCode: 'COPILOT_SESSION_STOPPED' },
    { event: 'session.compaction_start', actionCode: 'COPILOT_SESSION_COMPACTION_START' },
    { event: 'session.compaction_complete', actionCode: 'COPILOT_SESSION_COMPACTION_COMPLETE' },
    { event: 'session.fatal', actionCode: 'COPILOT_SESSION_FATAL' },
    { event: 'session.usage', actionCode: 'COPILOT_SESSION_USAGE' },
    { event: 'session.token_budget_warning', actionCode: 'COPILOT_SESSION_TOKEN_BUDGET_WARNING' },
    { event: 'session.mode_changed', actionCode: 'COPILOT_SESSION_MODE_CHANGED' },
    { event: 'dialog.ready', actionCode: 'COPILOT_DIALOG_READY' },
    { event: 'dialog.reply', actionCode: 'COPILOT_DIALOG_REPLY' },
    { event: 'dialog.stopped', actionCode: 'COPILOT_DIALOG_STOPPED' },
    { event: 'dialog.stalled', actionCode: 'COPILOT_DIALOG_STALLED' },
    { event: 'tool.execution_start', actionCode: 'COPILOT_TOOL_EXECUTION_START' },
    { event: 'tool.execution_complete', actionCode: 'COPILOT_TOOL_EXECUTION_COMPLETE' },
    { event: 'session.history_synced', actionCode: 'COPILOT_SESSION_HISTORY_SYNCED' },
    // BUG-C04 (fix): before-stop é emitido pelo agent antes do encerramento
    { event: 'before-stop', actionCode: 'COPILOT_AGENT_BEFORE_STOP' },
    // GAP-SDK-04 (fix): context:compacted — emitido após compactação de contexto
    { event: 'context:compacted', actionCode: 'COPILOT_CONTEXT_COMPACTED' },
    // ARCH-04 (fix): removidos 'session.usage_info' e 'assistant.reasoning_delta' — são eventos do SDK session,
    // não do EventEmitter do agent, e nunca serão emitidos via agent.on()
    // ── Fase BK: eventos ausentes de alto valor ──────────────────────────────
    { event: 'pr.consumed', actionCode: 'COPILOT_PR_CONSUMED' },
    { event: 'pr.fallback_model', actionCode: 'COPILOT_PR_FALLBACK_MODEL' },
    { event: 'agent.metrics', actionCode: 'COPILOT_AGENT_METRICS' },
    { event: 'dialog.turn_start', actionCode: 'COPILOT_TURN_START' },
    { event: 'dialog.turn_end', actionCode: 'COPILOT_TURN_END' },
    { event: 'dialog.turn_timeout', actionCode: 'COPILOT_TURN_TIMEOUT' },
    { event: 'dialog.paused', actionCode: 'COPILOT_DIALOG_PAUSED' },
    { event: 'dialog.resumed', actionCode: 'COPILOT_DIALOG_RESUMED' },
    { event: 'permission.mode_changed', actionCode: 'COPILOT_PERMISSION_MODE_CHANGED' },
    // ── Fase BJ: background agents e shells ──────────────────────────────────
    { event: 'agent.background.completed', actionCode: 'COPILOT_BG_AGENT_COMPLETED' },
    { event: 'agent.background.idle', actionCode: 'COPILOT_BG_AGENT_IDLE' },
    { event: 'agent.shell.completed', actionCode: 'COPILOT_SHELL_COMPLETED' },
    { event: 'agent.shell.detached_completed', actionCode: 'COPILOT_SHELL_DETACHED_COMPLETED' },
    // ── Fase CD: eventos de AGENT_EVENTS ausentes do bridge ──────────────────
    { event: 'dialog.loop.changed', actionCode: 'COPILOT_DIALOG_LOOP_CHANGED' },
    { event: 'exit_plan_mode.completed', actionCode: 'COPILOT_EXIT_PLAN_MODE_COMPLETED' },
    { event: 'external_tool.completed', actionCode: 'COPILOT_EXTERNAL_TOOL_COMPLETED' },
    { event: 'pending_messages.modified', actionCode: 'COPILOT_PENDING_MESSAGES_MODIFIED' },
    { event: 'session.info', actionCode: 'COPILOT_SESSION_INFO' },
    { event: 'session.snapshot_rewind', actionCode: 'COPILOT_SESSION_SNAPSHOT_REWIND' },
    { event: 'session.title_changed', actionCode: 'COPILOT_SESSION_TITLE_CHANGED' },
    { event: 'session.workspace_file_changed', actionCode: 'COPILOT_SESSION_WORKSPACE_FILE_CHANGED' },
    { event: 'system.message', actionCode: 'COPILOT_SYSTEM_MESSAGE' },
    { event: 'tool.execution_progress', actionCode: 'COPILOT_TOOL_EXECUTION_PROGRESS' },
    // ── Fase SE: eventos de streaming & SDK responses (STREAMING-EVENTS-AUDIT) ──
    { event: 'assistant.intent', actionCode: 'COPILOT_ASSISTANT_INTENT' },
    { event: 'assistant.reasoning_complete', actionCode: 'COPILOT_ASSISTANT_REASONING_COMPLETE' },
    { event: 'session.context_changed', actionCode: 'COPILOT_SESSION_CONTEXT_CHANGED' },
    { event: 'abort', actionCode: 'COPILOT_ABORT' },
    { event: 'steering.sent', actionCode: 'COPILOT_STEERING_SENT' },
    { event: 'elicitation.pending', actionCode: 'COPILOT_ELICITATION_PENDING' },
    { event: 'elicitation.answered', actionCode: 'COPILOT_ELICITATION_ANSWERED' },
    { event: 'subagent.started', actionCode: 'COPILOT_SUBAGENT_STARTED' },
    { event: 'subagent.completed', actionCode: 'COPILOT_SUBAGENT_COMPLETED' },
    { event: 'subagent.failed', actionCode: 'COPILOT_SUBAGENT_FAILED' },
    // ── F31.3-F31.4: compaction proativa ─────────────────────────────────────
    { event: 'compaction.proactive_request', actionCode: 'COPILOT_COMPACTION_PROACTIVE_REQUEST' },
    { event: 'compaction.force_request', actionCode: 'COPILOT_COMPACTION_FORCE_REQUEST' },
    // ── F36.2: dialog delta routing ──────────────────────────────────────────
    { event: 'dialog.delta', actionCode: 'COPILOT_DIALOG_DELTA' },
];

/**
 * @typedef {object} NervInstance
 * @property {(envelope: any) => Promise<void>} emitEvent - Emite um envelope no bus NERV
 * @property {((actionCode: string, handler: (envelope: any) => void) => () => void) | undefined} [onEvent] - Assina
 *   eventos por actionCode (F34)
 */

/**
 * @typedef {object} Envelope
 * @property {string} actor
 * @property {string} actionCode
 * @property {string} messageType
 * @property {Record<string, any>} payload
 * @property {number} timestamp
 */

/** @type {NervInstance | null} */
let _nerv = null;

/** @type {Map<string, (payload: any) => void>} */
const _listeners = new Map();

// ─── F34: Inbound command schema ────────────────────────────────────────────

/**
 * Comandos aceitos pelo canal NERV → agent (inbound).
 *
 * @type {Readonly<Record<string, (payload: Record<string, any>) => Promise<void>>>}
 */
const INBOUND_COMMANDS = Object.freeze({
    /** Envia uma mensagem para o agente (equivale a sendMessage). */
    async sendMessage(payload) {
        const { message, options } = payload;
        if (typeof message !== 'string' || !message.trim()) {
            log('WARN', '[nerv-bridge:inbound] sendMessage ignorado — message inválido.');
            return;
        }
        await getAgent().sendMessage(message, options ?? {});
    },
    /** Pausa o dialog loop do agente. */
    async pause() {
        if (typeof getAgent().pauseDialogLoop === 'function') {
            await getAgent().pauseDialogLoop();
        }
    },
    /** Retoma o dialog loop após pause. */
    async resume() {
        if (typeof getAgent().resumeDialogLoop === 'function') {
            await getAgent().resumeDialogLoop();
        }
    },
    /** Reinicia o agente (stop + start). */
    async restart() {
        await getAgent().stop();
        await getAgent().start();
    },
});

/**
 * Handler inbound: recebe envelopes NERV com actionCode `COPILOT_COMMAND` e despacha o comando para o agente.
 *
 * @type {(() => void) | null}
 */
let _inboundUnsub = null;

/**
 * F3.7 (BUG-MOD-12): rastrear se o handler before-stop já está registrado para evitar re-registro duplo em caso de
 * mount() → unmount() → mount() rápido.
 *
 * @type {boolean}
 */
let _beforeStopRegistered = false;

/** @type {boolean} Flag para evitar registro duplicado de shutdown handler. */
let _shutdownRegistered = false;

/**
 * B10-03: rastrear o handler once('ready') pendente para poder removê-lo em unmount() antes do disparo. Evita
 * re-anexação de listeners após bridge ter sido desmontado.
 *
 * @type {(() => void) | null}
 */
let _pendingReadyHandler = null;

/**
 * Cria um envelope simples para emissão no NERV.
 *
 * @param {string} actionCode
 * @param {Record<string, any>} payload
 * @returns {Envelope}
 */
function makeEnvelope(actionCode, payload) {
    return {
        actor: 'COPILOT',
        actionCode,
        messageType: 'EVENT',
        payload,
        timestamp: Date.now(),
    };
}

/**
 * Emite um evento no NERV de forma segura (sem lançar exceções).
 *
 * @param {string} actionCode
 * @param {Record<string, any>} payload
 * @returns {void}
 */
function safeEmit(actionCode, payload) {
    if (!_nerv) return;
    const envelope = makeEnvelope(
        actionCode,
        typeof payload === 'object' && payload !== null ? payload : { value: payload },
    );
    // emitEvent() é síncrono (void) — wrapping em Promise.resolve para consistência
    Promise.resolve(_nerv.emitEvent(envelope)).catch((/** @type {any} */ e) => {
        log('WARN', `[nerv-bridge] Falha ao emitir ${actionCode}: ${e?.message ?? String(e)}`);
    });
}

/**
 * Registra todos os listeners dos eventos do AlwaysAliveAgent redirecionados ao NERV.
 *
 * @returns {void}
 */
function _attachListeners() {
    for (const { event, actionCode } of EVENT_MAP) {
        const handler = (/** @type {Record<string, unknown>} */ payload) => safeEmit(actionCode, payload ?? {});
        _listeners.set(event, handler);
        getAgent().on(event, handler);
    }
    log('INFO', '[nerv-bridge] Listeners registrados nos eventos do AlwaysAliveAgent.');
}

/**
 * Remove todos os listeners registrados pelo bridge.
 *
 * @returns {void}
 */
function _detachListeners() {
    for (const [event, handler] of _listeners.entries()) {
        getAgent().off(event, handler);
    }
    _listeners.clear();
    log('INFO', '[nerv-bridge] Listeners removidos do AlwaysAliveAgent.');
}

// ─────────────────────── API Pública ────────────────────────────────────────

/**
 * Injeta a instância NERV e ativa o bridge (idempotente).
 *
 * @param {NervInstance} nerv - Instância NERV com `emitEvent(envelope)`
 * @returns {void}
 */
export function mount(nerv) {
    if (_nerv !== null) {
        log('WARN', '[nerv-bridge] mount() chamado com NERV já montado — remontando.');
        _detachListeners();
    }
    _nerv = nerv;
    _attachListeners();

    // F34: assinar canal inbound NERV → agent para comandos remotos
    if (typeof nerv.onEvent === 'function') {
        _inboundUnsub = nerv.onEvent('COPILOT_COMMAND', (/** @type {any} */ envelope) => {
            const command = envelope?.payload?.command;
            const handler = typeof command === 'string' ? INBOUND_COMMANDS[command] : undefined;
            if (!handler) {
                log('WARN', `[nerv-bridge:inbound] Comando desconhecido: ${String(command)}`);
                return;
            }
            Promise.resolve(handler(envelope.payload)).catch((/** @type {any} */ e) => {
                log('WARN', `[nerv-bridge:inbound] Erro ao executar ${command}: ${e?.message ?? String(e)}`);
            });
        });
    }

    // BUG-HIGH-10 (fix): re-registrar listeners após ciclo stop()/start() do agente.
    // O agente emite 'before-stop' antes de encerrar; ouvimos para limpar nossos listeners
    // e então re-registramos quando 'ready' disparar (novo ciclo de vida do agente).
    // F3.7 (BUG-MOD-12): verificar flag para evitar registro duplo em mounts consecutivos.
    if (!_beforeStopRegistered) {
        getAgent().on('before-stop', _onAgentBeforeStop);
        _beforeStopRegistered = true;
    }

    log('INFO', '[nerv-bridge] Bridge NERV↔AlwaysAlive montado.');

    // FAIXA-0: graceful shutdown — desmontar bridge ao encerrar processo (registro idempotente)
    if (!_shutdownRegistered) {
        registerShutdownHandler(
            'nerv-bridge.unmount',
            async () => { unmount(); },
            20,
        );
        _shutdownRegistered = true;
    }
}

/**
 * Handler interno: ao receber 'before-stop', remove os listeners do bridge e aguarda que o agente suba novamente para
 * re-registrá-los.
 *
 * @returns {void}
 */
function _onAgentBeforeStop() {
    log('INFO', '[nerv-bridge] Agente sinalizou before-stop — removendo listeners temporariamente.');
    _detachListeners();
    // B10-03: armazenar handler para que unmount() possa cancelar o once() se bridge for desmontado
    // antes do agente emitir 'ready'.
    _pendingReadyHandler = () => {
        _pendingReadyHandler = null; // consumido
        if (_nerv === null) return; // bridge foi desmontado enquanto o agente reiniciava
        log('INFO', '[nerv-bridge] Agente pronto novamente — re-registrando listeners.');
        _attachListeners();
        // Reagendar o handler para o próximo ciclo de stop (flag já true, apenas re-registra)
        getAgent().on('before-stop', _onAgentBeforeStop);
    };
    // Ao reiniciar, o agente emite 'ready'; re-registramos UMA vez.
    getAgent().once('ready', _pendingReadyHandler);
}

/**
 * Remove o NERV injetado e desativa o bridge.
 *
 * @returns {void}
 */
export function unmount() {
    _detachListeners();
    // F34: limpar assinatura inbound NERV → agent
    if (typeof _inboundUnsub === 'function') {
        _inboundUnsub();
        _inboundUnsub = null;
    }
    getAgent().off('before-stop', _onAgentBeforeStop);
    // B10-03: cancelar handler 'ready' pendente para evitar re-anexação após desmontagem
    if (_pendingReadyHandler) {
        getAgent().off('ready', _pendingReadyHandler);
        _pendingReadyHandler = null;
    }
    _beforeStopRegistered = false;
    _nerv = null;
    log('INFO', '[nerv-bridge] Bridge NERV↔AlwaysAlive desmontado.');
}

/**
 * Retorna true se o bridge está montado com um NERV ativo.
 *
 * @returns {boolean}
 */
export function isMounted() {
    return _nerv !== null;
}

/**
 * Emite um evento isolado no NERV (para uso nas outras partes do módulo copilot). No-op se o bridge não estiver
 * montado.
 *
 * @param {string} actionCode - Código da ação (ex: 'COPILOT_SESSION_METRICS')
 * @param {Record<string, any>} payload - Dados do evento
 * @returns {void}
 */
export function emitNerv(actionCode, payload) {
    safeEmit(actionCode, payload);
}

/**
 * Objeto de conveniência para acesso via importação nomeada única.
 *
 * @type {{ mount: typeof mount; unmount: typeof unmount; isMounted: typeof isMounted; emitNerv: typeof emitNerv }}
 */
export const copilotNervBridge = { mount, unmount, isMounted, emitNerv };

/**
 * Reseta estado interno mutable do bridge para isolamento de testes. **Não usar em produção.**
 *
 * @returns {void}
 * @internal
 */
export function _resetNervBridgeState() {
    _nerv = null;
    _beforeStopRegistered = false;
    _shutdownRegistered = false;
    _pendingReadyHandler = null;
    _listeners.clear();
}

// ─── F114: Typed SDK event helper ────────────────────────────────────────────

/**
 * Registra um handler typed em um evento da sessão SDK usando `onSessionEvent`. Utilitário para bridges que precisam
 * ouvir eventos tipados do SDK diretamente (sessão copilot), em contraste com eventos do AlwaysAliveAgent
 * (EventEmitter).
 *
 * @param {import('#copilot/sdk/types').CopilotSession} session - Sessão SDK ativa.
 * @param {string} eventType - Tipo de evento SDK (e.g., 'assistant.message').
 * @param {(event: any) => void} handler - Callback.
 * @returns {() => void} Função de unsubscribe.
 */
export function subscribeSessionEvent(session, eventType, handler) {
    return onSessionEvent(session, eventType, handler);
}
