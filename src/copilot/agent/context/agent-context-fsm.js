// @ts-check
/**
 * src/copilot/agent/context/agent-context-fsm.js
 *
 * FSM de transições de status do AgentContext. Extraído de `agent-context.js` na Faixa C3.1.
 *
 * Contém: `STATUS_TRANSITIONS`, lógica de `setStatus` com validação, helpers de query de status.
 *
 * @module copilot/agent/context/agent-context-fsm
 * @internal
 */

import { EMITTER_STATUS } from '#copilot/events';
import { log } from '../ports/index.js';

/**
 * @typedef {import('../types.js').AgentStatus} AgentStatus
 *
 * @typedef {import('../types.js').AgentRuntimeState} AgentRuntimeState
 *
 * @typedef {import('../types.js').AgentMetricsState} AgentMetricsState
 */

/**
 * Contrato mínimo do contexto para operações FSM.
 *
 * @typedef {{
 *     runtimeState: AgentRuntimeState;
 *     invalidateStatusSnapshot: () => void;
 * }} FsmCtx
 */

/**
 * Emitter mínimo para emissão de evento 'status'.
 *
 * @typedef {{ emit: (event: string | symbol, payload?: unknown) => boolean }} StatusEmitterLike
 */

/**
 * Transições válidas do FSM de status do agente. Regra: qualquer estado pode transitar para 'stopped' (shutdown é
 * sempre permitido).
 *
 * @type {Readonly<Record<AgentStatus, ReadonlySet<AgentStatus>>>}
 */
export const STATUS_TRANSITIONS = Object.freeze({
    stopped: new Set(/** @type {const} */ (['starting'])),
    starting: new Set(/** @type {const} */ (['idle', 'stopped'])),
    idle: new Set(/** @type {const} */ (['processing', 'stopped'])),
    processing: new Set(/** @type {const} */ (['idle', 'waiting_for_input', 'stopped'])),
    waiting_for_input: new Set(/** @type {const} */ (['processing', 'stopped'])),
});

/**
 * Atualiza o status operacional sem emitir eventos. Invalida o snapshot cacheado quando há mudança efetiva.
 *
 * @param {FsmCtx} ctx
 * @param {AgentStatus} status
 * @returns {void}
 */
export function setRuntimeStatus(ctx, status) {
    if (ctx.runtimeState.status === status) {
        return;
    }
    ctx.runtimeState.status = status;
    ctx.invalidateStatusSnapshot();
}

/**
 * Retorna o status operacional atual sem expor `runtimeState` ao chamador.
 *
 * @param {FsmCtx} ctx
 * @returns {AgentStatus}
 */
export function getRuntimeStatus(ctx) {
    return ctx.runtimeState.status;
}

/**
 * Indica se o status atual é igual ao valor informado.
 *
 * @param {FsmCtx} ctx
 * @param {AgentStatus} status
 * @returns {boolean}
 */
export function isStatus(ctx, status) {
    return ctx.runtimeState.status === status;
}

/** @param {FsmCtx} ctx @returns {boolean} */
export function isStopped(ctx) {
    return ctx.runtimeState.status === 'stopped';
}

/** @param {FsmCtx} ctx @returns {boolean} */
export function isStarting(ctx) {
    return ctx.runtimeState.status === 'starting';
}

/** @param {FsmCtx} ctx @returns {boolean} */
export function isIdle(ctx) {
    return ctx.runtimeState.status === 'idle';
}

/** @param {FsmCtx} ctx @returns {boolean} */
export function isProcessing(ctx) {
    return ctx.runtimeState.status === 'processing';
}

/** @param {FsmCtx} ctx @returns {boolean} */
export function isWaitingForInput(ctx) {
    return ctx.runtimeState.status === 'waiting_for_input';
}

/**
 * Altera o status com validação FSM, invalida o cache de snapshot e emite evento 'status' no emitter. Bloqueia
 * transições inválidas em desenvolvimento; em produção registra e retorna.
 *
 * @param {FsmCtx} ctx
 * @param {AgentStatus} status
 * @param {StatusEmitterLike} emitter
 * @returns {void}
 */
export function applyStatusTransition(ctx, status, emitter) {
    if (ctx.runtimeState.status === status) {
        return;
    }
    const allowed = STATUS_TRANSITIONS[ctx.runtimeState.status];
    if (allowed && !allowed.has(status)) {
        const message = `[AgentContext] Transição de status inválida: ${ctx.runtimeState.status} → ${status}`;
        log('ERROR', message);
        if (process.env['NODE_ENV'] !== 'production') {
            throw new Error(message);
        }
        return;
    }
    setRuntimeStatus(ctx, status);
    emitter.emit(EMITTER_STATUS, status);
}
