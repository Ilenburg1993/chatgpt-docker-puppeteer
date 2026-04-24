// @ts-check
/**
 * src/copilot/agent/dialog/agent-dialog-controller.js
 *
 * F37: Controle do dialog loop — funções extraídas de always-alive.js.
 *
 * Gerencia start/stop/pause/resume do dialog loop, com validações de estado, health checks de contexto, e wiring de
 * eventos.
 *
 * @module copilot/agent/dialog/agent-dialog-controller
 * @internal
 * @see EventBus
 */

import { container, SessionError } from '#copilot/core';
import { EMITTER_DIALOG_LOOP_CHANGED, EMITTER_SESSION_KEEPALIVE } from '#copilot/events';
import { CONTEXT_UTIL_BLOCK_THRESHOLD, CONTEXT_UTIL_WARN_THRESHOLD } from '../../config/agent.js';
import { withAgentErrorPolicy } from '../error-policy.js';
import { log, METRICS_STORE } from '../ports/observability-port.js';
import {
    assertEmitterHost,
    normalizeCompactionComplete,
    normalizeTokenBudgetWarning,
    trySetLiveSessionModel,
} from '../runtime-contracts.js';
import { wireDialogLoopEvents } from './loop-manager.js';

/**
 * @typedef {import('../agent-context.js').AgentContext} AgentContext
 */

/** @typedef {import('../types.js').DialogHost} DialogHost */

/**
 * @param {'retry' | 'fatal' | 'ignore'} disposition
 * @returns {'WARN' | 'ERROR' | 'INFO'}
 */
function toDialogPolicyLevel(disposition) {
    if (disposition === 'fatal') return 'ERROR';
    if (disposition === 'ignore') return 'INFO';
    return 'WARN';
}

/**
 * @param {string} label
 * @param {() => Promise<void>} operation
 * @returns {Promise<void>}
 */
async function runDialogOperationWithPolicy(label, operation) {
    const result = await withAgentErrorPolicy(operation, {
        label,
        phase: 'dialog',
        onError: (error, disposition, context) => {
            log(
                toDialogPolicyLevel(disposition),
                `[DialogController] ${context.label ?? label} falhou (${disposition}): ${error.message}`,
            );
        },
    });
    if (!result.ok) {
        throw result.error;
    }
}

/**
 * Reinicia o keepalive quando houver sessão viva e o dialog loop não estiver ativo.
 *
 * @param {AgentContext} ctx
 * @param {DialogHost} host
 * @returns {void}
 */
function startKeepaliveIfPossible(ctx, host) {
    ctx.startKeepalive({
        onKeepalive: (/** @type {number} */ ts) => {
            container.resolve(METRICS_STORE).recordKeepalivePing();
            host.emit(EMITTER_SESSION_KEEPALIVE, { ts });
        },
    });
}

/**
 * Inicia o dialog loop com validações de estado e health check de contexto.
 *
 * @param {AgentContext} ctx
 * @param {DialogHost} host
 * @param {string} [bootPrompt]
 * @returns {Promise<void>}
 */
export async function dialogStart(ctx, host, bootPrompt) {
    if (!ctx.isIdle()) {
        throw new SessionError(
            `[AlwaysAlive] startDialogLoop() requer status 'idle'. Status atual: '${ctx.getRuntimeStatus()}'`,
            'INVALID_STATE',
        );
    }
    // F44.1 (GAP-SD-08): health check pre-boot
    const contextState = ctx.getContextStateSnapshot();
    if (contextState) {
        const utilization = contextState.utilization ?? 0;
        if (utilization >= CONTEXT_UTIL_BLOCK_THRESHOLD) {
            throw new SessionError(
                `[AlwaysAlive] startDialogLoop() bloqueado: utilização de contexto em ${Math.round(utilization * 100)}% (≥95%). Solicite compaction antes de iniciar.`,
                'CONTEXT_EXHAUSTED',
            );
        }
        if (utilization >= CONTEXT_UTIL_WARN_THRESHOLD) {
            log(
                'WARN',
                `[AlwaysAlive] F44.1: Utilização de contexto em ${Math.round(utilization * 100)}% — dialog loop prosseguindo com cautela.`,
            );
        }
    }
    ensureDialogLoopAttached(ctx, host);
    // F42.2: pausar keepalive enquanto dialog loop está ativo
    ctx.stopKeepalive('dialog_loop_active');
    try {
        await runDialogOperationWithPolicy('dialog.start', () => ctx.startDialogLoop(bootPrompt));
    } catch (error) {
        startKeepaliveIfPossible(ctx, host);
        throw error;
    }
    host.emit(EMITTER_DIALOG_LOOP_CHANGED, { active: true, ts: Date.now() });
}

/**
 * Para o dialog loop e reinicia o keepalive da sessão.
 *
 * @param {AgentContext} ctx
 * @param {DialogHost} host
 * @param {{
 *     authorized?: boolean;
 *     reason?: 'watchdog_restart' | 'authorized_stop';
 *     shutdownTimeoutMs?: number;
 * }} [opts]
 * @returns {Promise<void>}
 */
export async function dialogStop(ctx, host, opts) {
    await runDialogOperationWithPolicy('dialog.stop', () => ctx.stopDialogLoop(opts));
    // F42.2: reiniciar keepalive quando dialog loop para
    startKeepaliveIfPossible(ctx, host);
}

/**
 * Retoma o dialog loop com validação de estado.
 *
 * @param {AgentContext} ctx
 * @returns {Promise<void>}
 */
export async function dialogResume(ctx) {
    if (!ctx.isIdle() && !ctx.isWaitingForInput()) {
        throw new SessionError(
            `[AlwaysAlive] resumeDialogLoop() requer status 'idle' ou 'waiting_for_input'. Status atual: '${ctx.getRuntimeStatus()}'`,
            'INVALID_STATE',
        );
    }
    await runDialogOperationWithPolicy('dialog.resume', () => ctx.resumeDialogLoop());
}

/**
 * Garante que o DialogLoopManager está vinculado ao host. Wiring de eventos ocorre apenas na primeira chamada (guard de
 * idempotência).
 *
 * @param {AgentContext} ctx
 * @param {DialogHost} host
 */
export function ensureDialogLoopAttached(ctx, host) {
    const emitterHost = assertEmitterHost(host, 'DialogHost');

    /** @type {import('../types.js').DialogLoopHost} */
    const agentHost = {
        sendMessage: (msg, opts) => host.sendMessage(msg, opts),
        sendMessageDialogBoot: (msg, opts) => host.sendMessageDialogBoot(msg, opts),
        answerPendingQuestion: (answer) => host.answerPendingQuestion(answer),
        getPendingQuestionSnapshot: () => ctx.getPendingQuestionSnapshot(),
        on: (event, listener) => host.on(event, listener),
        once: (event, listener) => host.once(event, listener),
        off: (event, listener) => host.off(event, listener),
        getSessionId: () => host.sessionId,
        getModel: () => ctx.getModelSnapshot(),
        setModel: (modelId) => {
            ctx.setModel(modelId);
            trySetLiveSessionModel(ctx.getSessionSnapshot(), modelId, 'AlwaysAlive');
        },
        hasPendingQuestion: () => ctx.hasPendingQuestion(),
        trackBackgroundTask: (task, meta) => ctx.trackBackgroundTask(task, meta),
    };
    // Sempre atualiza host — necessário após reconexão.
    ctx.attachDialogLoop(agentHost);
    // Wiring de eventos: somente na primeira vez.
    if (ctx.getDialogLoopAttachedSnapshot()) return;
    ctx.setDialogLoopAttached(true);
    wireDialogLoopEvents(ctx.getDialogLoopManagerSnapshot(), (event, payload) => host.emit(event, payload));

    // F31.3/F31.4: Proxy token_budget_warning → DLM
    emitterHost.on('session.token_budget_warning', (rawEvt) => {
        ctx.handleDialogTokenBudget(normalizeTokenBudgetWarning(rawEvt));
    });

    // F31.3: Reset compaction flag
    emitterHost.on('session.compaction_complete', (rawEvt) => {
        if (normalizeCompactionComplete(rawEvt).success) ctx.resetDialogCompactionFlag();
    });
}
