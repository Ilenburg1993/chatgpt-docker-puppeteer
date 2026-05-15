// @ts-check
/**
 * src/copilot/agent/dialog/controllers/agent-dialog-controller.js
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
import { EMITTER_DIALOG_LOOP_CHANGED, EMITTER_DIALOG_RECOVERY, EMITTER_SESSION_KEEPALIVE } from '#copilot/events';
import { CONTEXT_UTIL_BLOCK_THRESHOLD, CONTEXT_UTIL_WARN_THRESHOLD } from '#copilot/config/agent';
import { withAgentErrorPolicy } from '../../error/index.js';
import { log, METRICS_STORE } from '../../ports/index.js';
import {
    assertEmitterHost,
    normalizeCompactionComplete,
    normalizeTokenBudgetWarning,
    trySetLiveSessionModel,
} from '../../runtime/contracts/index.js';
import { wireDialogLoopEvents } from '../orchestrators/index.js';

/**
 * @typedef {import('../../agent-context.js').AgentContext} AgentContext
 */

/** @typedef {import('../../types.js').DialogHost} DialogHost */

/**
 * @typedef {object} DialogInputRecoveryResult
 * @property {boolean} recovered
 * @property {string} reason
 * @property {'not_needed' | 'paused' | 'zero_pr_ready' | 'restart_with_pr'} strategy
 * @property {boolean} prConsumed
 * @property {number} durationMs
 */

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
        onKeepalive: (/** @type {{ ts: number; strategy: 'client.ping' | 'session.send' }} */ info) => {
            container.resolve(METRICS_STORE).recordKeepalivePing();
            host.emit(EMITTER_SESSION_KEEPALIVE, { ts: info.ts, strategy: info.strategy });
        },
    });
}

/**
 * Inicia o dialog loop com validações de estado e health check de contexto.
 *
 * @param {AgentContext} ctx
 * @param {DialogHost} host
 * @param {string} [bootPrompt]
 * @param {{ resumeSessionAttach?: boolean }} [opts]
 * @returns {Promise<void>}
 */
export async function dialogStart(ctx, host, bootPrompt, opts = {}) {
    if (ctx.isWaitingForInput() && ctx.getPendingQuestionKind() === 'ready' && ctx.isDialogLoopActive()) {
        log('WARN', '[AlwaysAlive] startDialogLoop() idempotente: READY pendente já mantém o loop ativo.');
        host.emit(EMITTER_DIALOG_LOOP_CHANGED, { active: true, ts: Date.now(), reason: 'ready_already_waiting' });
        return;
    }
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
        const operation = opts.resumeSessionAttach === true ? 'dialog.start.resumed_session_attach' : 'dialog.start';
        await runDialogOperationWithPolicy(operation, () => ctx.startDialogLoop(bootPrompt, opts));
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
 *     reason?: 'watchdog_restart' | 'authorized_stop' | 'recovery_restart';
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
 * Recupera semanticamente o canal de input do dialog loop quando a borda detecta `active + idle + sem READY`.
 *
 * Regra de custo: se ainda houver `READY` pendente, a recuperação é 0 PR; só reiniciamos o loop quando o canal de input
 * está de fato ausente. A decisão pertence ao Agent, não à presentation.
 *
 * @param {AgentContext} ctx
 * @param {DialogHost} host
 * @param {{ reason?: string; traceId?: string }} [opts]
 * @returns {Promise<DialogInputRecoveryResult>}
 */
export async function dialogRecoverInputChannel(ctx, host, opts = {}) {
    const startedAt = Date.now();
    const reason = opts.reason ?? 'input_channel_missing';
    const emitRecovery = (
        /** @type {Omit<DialogInputRecoveryResult, 'durationMs' | 'reason'> & { success?: boolean }} */ event,
    ) => {
        const durationMs = Date.now() - startedAt;
        host.emit(EMITTER_DIALOG_RECOVERY, {
            reason,
            durationMs,
            ...(opts.traceId ? { traceId: opts.traceId } : {}),
            ...event,
        });
        return durationMs;
    };

    if (ctx.isDialogLoopPaused()) {
        const durationMs = emitRecovery({
            recovered: false,
            strategy: 'paused',
            prConsumed: false,
            success: true,
        });
        return { recovered: false, reason, strategy: 'paused', prConsumed: false, durationMs };
    }

    if (ctx.isDialogLoopActive() && ctx.isWaitingForInput() && ctx.getPendingQuestionKind() === 'ready') {
        const durationMs = emitRecovery({
            recovered: true,
            strategy: 'zero_pr_ready',
            prConsumed: false,
            success: true,
        });
        return { recovered: true, reason, strategy: 'zero_pr_ready', prConsumed: false, durationMs };
    }

    const mustRestart = ctx.isDialogLoopActive() && ctx.isIdle() && !ctx.hasPendingQuestion();
    if (!mustRestart) {
        const durationMs = emitRecovery({
            recovered: false,
            strategy: 'not_needed',
            prConsumed: false,
            success: true,
        });
        return { recovered: false, reason, strategy: 'not_needed', prConsumed: false, durationMs };
    }

    try {
        await dialogStop(ctx, host, { authorized: true, reason: 'recovery_restart' });
        await dialogStart(ctx, host);
        const durationMs = emitRecovery({
            recovered: true,
            strategy: 'restart_with_pr',
            prConsumed: true,
            success: true,
        });
        return { recovered: true, reason, strategy: 'restart_with_pr', prConsumed: true, durationMs };
    } catch (error) {
        emitRecovery({
            recovered: false,
            strategy: 'restart_with_pr',
            prConsumed: true,
            success: false,
        });
        throw error;
    }
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

    /** @type {import('../../types.js').DialogLoopHost} */
    const agentHost = {
        sendMessage: (msg, opts) => host.sendMessage(msg, opts),
        sendMessageDialogBoot: (msg, opts) => host.sendMessageDialogBoot(msg, opts),
        answerPendingQuestion: (answer) => host.answerPendingQuestion(answer),
        getPendingQuestionSnapshot: () => ctx.getPendingQuestionSnapshot(),
        getPendingQuestionShadowSnapshot: () => ctx.getPendingQuestionShadowSnapshot(),
        isPendingQuestionShadowExpired: () => ctx.isPendingQuestionShadowExpired(),
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
