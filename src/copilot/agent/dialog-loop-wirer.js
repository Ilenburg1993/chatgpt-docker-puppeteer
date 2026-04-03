// @ts-check
/**
 * src/copilot/agent/dialog-loop-wirer.js
 *
 * Utilitário de wiring de eventos do DialogLoopManager para o AlwaysAliveAgent.
 *
 * Encapsula o boilerplate de event-forwarding extraído de `AlwaysAliveAgent#ensureDialogLoopAttached`, eliminando a
 * longa sequência de `.on()` repetitivos do corpo da classe principal.
 *
 * @module copilot/agent/dialog-loop-wirer
 */

/**
 * Registra todos os listeners de forwarding de eventos no DialogLoopManager.
 *
 * Esta função deve ser chamada UMA ÚNICA VEZ por instância do agente (a classe-mãe controla a idempotência via flag
 * interno). Ela:
 *
 * 1. Chama `dialogLoop.removeAllListeners()` para limpar listeners anteriores.
 * 2. Registra um listener para cada evento relevante, encaminhando-o ao agente via `emitFn`.
 *
 * @param {import('./dialog-loop-manager.js').DialogLoopManager} dialogLoop
 * @param {(event: string, payload: Record<string, unknown>) => void} emitFn - Função de emissão do agente host.
 * @returns {void}
 */
export function wireDialogLoopEvents(dialogLoop, emitFn) {
    // FINDING-P4: remover apenas os eventos conhecidos em vez de todos os listeners
    // (evita remover listeners de outros componentes que possam ter registrado no DLM)
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
    ];
    for (const event of DLM_EVENTS) dialogLoop.removeAllListeners(event);

    dialogLoop.on('ready', (/** @type {Record<string, unknown>} */ evt) => emitFn('dialog.ready', evt));
    dialogLoop.on('reply', (/** @type {Record<string, unknown>} */ evt) => emitFn('dialog.reply', evt));
    dialogLoop.on('stopped', (/** @type {Record<string, unknown>} */ evt) => emitFn('dialog.stopped', evt));
    dialogLoop.on('paused', (/** @type {Record<string, unknown>} */ evt) => emitFn('dialog.paused', evt));
    dialogLoop.on('resumed', (/** @type {Record<string, unknown>} */ evt) => emitFn('dialog.resumed', evt));
    dialogLoop.on('stalled', (/** @type {Record<string, unknown>} */ evt) => emitFn('dialog.stalled', evt));
    dialogLoop.on('turn_start', (/** @type {Record<string, unknown>} */ evt) => emitFn('dialog.turn_start', evt));
    dialogLoop.on('turn_end', (/** @type {Record<string, unknown>} */ evt) => emitFn('dialog.turn_end', evt));
    dialogLoop.on('turn_timeout', (/** @type {Record<string, unknown>} */ evt) => emitFn('dialog.turn_timeout', evt));
    dialogLoop.on('changed', (/** @type {Record<string, unknown>} */ evt) => emitFn('dialog.loop.changed', evt));
    dialogLoop.on('model.fallback', (/** @type {Record<string, unknown>} */ evt) => emitFn('pr.fallback_model', evt));
}
