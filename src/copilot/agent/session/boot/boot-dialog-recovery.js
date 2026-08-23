// @ts-check
/**
 * @module copilot/agent/session/boot-dialog-recovery
 * @file Seams de recuperação do dialog loop durante boot/resume.
 */

import { cancelApplicationTimer, registerApplicationTimeout } from '#copilot/boot/process-runtime';
import { BOOT_RECOVERY_DELAY_MS, DIALOG_BOOT_RECOVERY_ALLOW_PR_FALLBACK } from '#copilot/config/agent';
import { EMITTER_DIALOG_BOOT_RECOVERY } from '#copilot/events';
import { toError } from '#copilot/infra/public/platform/error';
import {
    clearAgentRuntimePendingQuestionShadow,
    markAgentRuntimeDialogPausedForRecovery,
    shouldReapAgentRuntimePendingQuestionShadow,
    shouldScheduleAgentRuntimeDialogBootRecovery,
} from '../../facades/agent-runtime-state.js';
import { log } from '../../ports/logging/index.js';

/**
 * @typedef {import('./boot-session-prep.js').BootWiringContext} BootWiringContext
 *
 * @typedef {import('./boot-session-prep.js').BootWiringPipelineState} BootWiringPipelineState
 */

/**
 * @param {BootWiringContext} ctx
 * @returns {() => void}
 */
export function scheduleDialogBootRecovery(ctx) {
    log('DEBUG', '[AlwaysAlive] F53/F42.1: Recovery do dialog loop agendado após resume.');
    const timerId = 'agent.dialogBootRecovery';
    const bootRecoveryTimer = registerApplicationTimeout(
        timerId,
        () => {
            cancelApplicationTimer(timerId);
            if (ctx.getStatus() === 'stopped') {
                return;
            }

            void ctx.trackBackgroundTask(runDialogBootRecovery(ctx), {
                label: 'dialog.boot_recovery.run',
                description: 'Retry dialog loop recovery after resumed session boot',
            });
        },
        BOOT_RECOVERY_DELAY_MS,
    );
    bootRecoveryTimer.unref?.();
    return () => {
        cancelApplicationTimer(timerId);
    };
}

/**
 * Executa a rotina assíncrona de boot recovery do dialog loop.
 *
 * @param {BootWiringContext} ctx
 * @returns {Promise<void>}
 */
export async function runDialogBootRecovery(ctx) {
    const status = ctx.getStatus();
    if (ctx.dialogLoopActive()) {
        log('DEBUG', '[AlwaysAlive] F53: Boot recovery dispensado — dialog loop já está ativo.');
        return;
    }
    if (status === 'processing') {
        log('DEBUG', '[AlwaysAlive] F53: Boot recovery dispensado — boot normal ainda está processando.');
        return;
    }
    if (status !== 'idle' && status !== 'waiting_for_input') {
        log('DEBUG', `[AlwaysAlive] F53: Boot recovery dispensado — status atual '${status}' não permite resume.`);
        return;
    }

    try {
        ctx.ensureDialogLoopAttached();
        await ctx.startDialogLoop(undefined, { resumeSessionAttach: true });
        log('INFO', '[AlwaysAlive] F53: Dialog loop reanexado à sessão retomada sem boot prompt.');
        ctx.emit(EMITTER_DIALOG_BOOT_RECOVERY, { zeroPR: true, ts: Date.now() });
    } catch (e) {
        const error = toError(e);
        if (!DIALOG_BOOT_RECOVERY_ALLOW_PR_FALLBACK) {
            log(
                'WARN',
                `[AlwaysAlive] F53: Boot recovery zero-PR falhou (${error.message}) — fallback com PR bloqueado por política.`,
            );
            ctx.emit(EMITTER_DIALOG_BOOT_RECOVERY, {
                zeroPR: false,
                skippedPrFallback: true,
                reason: 'zero_pr_resume_failed',
                error: error.message,
                ts: Date.now(),
            });
            return;
        }

        log('WARN', `[AlwaysAlive] F53: Boot recovery zero-PR falhou (${error.message}) — fallback com PR permitido.`);
        try {
            await ctx.startDialogLoop();
            ctx.emit(EMITTER_DIALOG_BOOT_RECOVERY, {
                zeroPR: false,
                prFallback: true,
                reason: 'zero_pr_resume_failed',
                ts: Date.now(),
            });
        } catch (e2) {
            log('WARN', `[AlwaysAlive] F53: Fallback startDialogLoop também falhou: ${toError(e2).message}`);
        }
    }
}

/**
 * @param {boolean} isResumed
 * @param {BootWiringContext} ctx
 * @param {BootWiringPipelineState} state
 * @returns {void}
 */
export function stepScheduleDialogRecovery(isResumed, ctx, state) {
    if (!isResumed) {
        return;
    }

    void ctx.trackBackgroundTask(
        shouldScheduleAgentRuntimeDialogBootRecovery().then(async (shouldSchedule) => {
            if (shouldSchedule) {
                const pauseResult = await markAgentRuntimeDialogPausedForRecovery();
                if (!pauseResult.ok) {
                    log(
                        'WARN',
                        `[AlwaysAlive] F53: Falha ao marcar dialogPaused para boot recovery: ${toError(pauseResult.error).message}`,
                    );
                }
                const cancelBootRecovery = scheduleDialogBootRecovery(ctx);
                state.unsubs.push(cancelBootRecovery);
            }
        }),
        {
            label: 'dialog.boot_recovery.schedule',
            description: 'Read persisted state to schedule dialog boot recovery',
        },
    );
}

/**
 * Reap contínuo da shadow persistida de `ask_user` quando ela já expirou em runtime.
 *
 * Mantém a regra: nunca limpar pergunta viva do SDK; apenas a shadow restaurada do disco.
 *
 * @param {BootWiringContext} ctx
 * @returns {boolean}
 */
export function reapExpiredPendingQuestionShadow(ctx) {
    if (!shouldReapAgentRuntimePendingQuestionShadow(ctx)) {
        return false;
    }

    return clearAgentRuntimePendingQuestionShadow(ctx, {
        label: 'state.pendingQuestionShadow.reap',
        description: 'Reap expired ask_user shadow during runtime metrics tick',
    });
}
