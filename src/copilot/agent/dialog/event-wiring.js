// @ts-check
/**
 * src/copilot/agent/dialog/event-wiring.js
 *
 * F61: Registra listeners de forwarding de eventos do DialogLoopManager para o agente host.
 *
 * Extraído de loop-manager.js para separação de concerns.
 *
 * @module copilot/agent/dialog/event-wiring
 */

/**
 * Lista canônica de eventos emitidos pelo DialogLoopManager.
 */
const DLM_EVENTS = [
    'ready',
    'reply',
    'stopped',
    'paused',
    'resumed',
    'stalled',
    'turn_start',
    'turn_end',
    'turn_timeout',
    'changed',
    'model.fallback',
    'compaction.requested',
    'pre_stall_warning',
];

/**
 * Mapa de evento DLM → evento do agente host.
 *
 * @type {ReadonlyArray<[string, string]>}
 */
const EVENT_MAP = [
    ['ready', 'dialog.ready'],
    ['reply', 'dialog.reply'],
    ['stopped', 'dialog.stopped'],
    ['paused', 'dialog.paused'],
    ['resumed', 'dialog.resumed'],
    ['stalled', 'dialog.stalled'],
    ['turn_start', 'dialog.turn_start'],
    ['turn_end', 'dialog.turn_end'],
    ['turn_timeout', 'dialog.turn_timeout'],
    ['changed', 'dialog.loop.changed'],
    ['model.fallback', 'pr.fallback_model'],
    ['compaction.requested', 'dialog.compaction.requested'],
    ['pre_stall_warning', 'dialog.pre_stall_warning'],
];

/**
 * Registra todos os listeners de forwarding de eventos no DialogLoopManager.
 *
 * Esta função deve ser chamada UMA ÚNICA VEZ por instância do agente (a classe-mãe controla a idempotência via flag
 * interno). Ela:
 *
 * 1. Chama `removeAllListeners()` para os eventos conhecidos do DLM.
 * 2. Registra um listener para cada evento relevante, encaminhando-o ao agente via `emitFn`.
 *
 * @param {import('./loop-manager.js').DialogLoopManager} dialogLoop
 * @param {(event: string, payload: Record<string, unknown>) => void} emitFn - Função de emissão do agente host.
 * @returns {void}
 */
export function wireDialogLoopEvents(dialogLoop, emitFn) {
    for (const event of DLM_EVENTS) dialogLoop.removeAllListeners(event);

    for (const [src, dest] of EVENT_MAP) {
        dialogLoop.on(src, (/** @type {Record<string, unknown>} */ evt) => emitFn(dest, evt));
    }
}

export { DLM_EVENTS, EVENT_MAP };
