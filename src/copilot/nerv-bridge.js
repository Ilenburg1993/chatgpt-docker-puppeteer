// @ts-check
/**
 * src/copilot/nerv-bridge.js
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
 * @module copilot/nerv-bridge
 */

import { log } from '#core/logger';
import { alwaysAliveAgent } from './always-alive.js';

/**
 * Mapa de eventos do AlwaysAliveAgent → actionCode NERV.
 *
 * @type {ReadonlyArray<{ event: string; actionCode: string }>}
 */
const EVENT_MAP = [
    { event: 'status', actionCode: 'COPILOT_AGENT_STATUS' },
    { event: 'task.queued', actionCode: 'COPILOT_TASK_QUEUED' },
    { event: 'task.started', actionCode: 'COPILOT_TASK_STARTED' },
    { event: 'task.completed', actionCode: 'COPILOT_TASK_COMPLETED' },
    { event: 'task.error', actionCode: 'COPILOT_TASK_ERROR' },
    { event: 'question.pending', actionCode: 'COPILOT_QUESTION_PENDING' },
    { event: 'question.answered', actionCode: 'COPILOT_QUESTION_ANSWERED' },
    { event: 'started', actionCode: 'COPILOT_SESSION_STARTED' },
    { event: 'stopped', actionCode: 'COPILOT_SESSION_STOPPED' },
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
    _nerv.emitEvent(envelope).catch((/** @type {any} */ e) => {
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
        const handler = (/** @type {any} */ payload) => safeEmit(actionCode, payload ?? {});
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
    log('INFO', '[nerv-bridge] Bridge NERV↔AlwaysAlive montado.');
}

/**
 * Remove o NERV injetado e desativa o bridge.
 *
 * @returns {void}
 */
export function unmount() {
    _detachListeners();
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
