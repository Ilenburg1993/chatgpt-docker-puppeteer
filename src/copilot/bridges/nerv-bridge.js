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
 * @see module:copilot/always-alive
 * @see module:copilot/conversation-hub/hub
 */

import { log } from '#copilot/observability/logger';
import { alwaysAliveAgent } from '../agent/always-alive.js';

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
];

/**
 * @typedef {object} NervInstance
 * @property {(envelope: any) => Promise<void>} emitEvent - Emite um envelope no bus NERV
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

/**
 * F3.7 (BUG-MOD-12): rastrear se o handler before-stop já está registrado para evitar re-registro duplo em caso de
 * mount() → unmount() → mount() rápido.
 *
 * @type {boolean}
 */
let _beforeStopRegistered = false;

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
        alwaysAliveAgent.on(event, handler);
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
        alwaysAliveAgent.off(event, handler);
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

    // BUG-HIGH-10 (fix): re-registrar listeners após ciclo stop()/start() do agente.
    // O agente emite 'before-stop' antes de encerrar; ouvimos para limpar nossos listeners
    // e então re-registramos quando 'ready' disparar (novo ciclo de vida do agente).
    // F3.7 (BUG-MOD-12): verificar flag para evitar registro duplo em mounts consecutivos.
    if (!_beforeStopRegistered) {
        alwaysAliveAgent.on('before-stop', _onAgentBeforeStop);
        _beforeStopRegistered = true;
    }

    log('INFO', '[nerv-bridge] Bridge NERV↔AlwaysAlive montado.');
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
    // Ao reiniciar, o agente emite 'ready'; re-registramos UMA vez.
    alwaysAliveAgent.once('ready', () => {
        if (_nerv === null) return; // bridge foi desmontado enquanto o agente reiniciava
        log('INFO', '[nerv-bridge] Agente pronto novamente — re-registrando listeners.');
        _attachListeners();
        // Reagendar o handler para o próximo ciclo de stop (flag já true, apenas re-registra)
        alwaysAliveAgent.on('before-stop', _onAgentBeforeStop);
    });
}

/**
 * Remove o NERV injetado e desativa o bridge.
 *
 * @returns {void}
 */
export function unmount() {
    _detachListeners();
    alwaysAliveAgent.off('before-stop', _onAgentBeforeStop);
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
    _listeners.clear();
}
