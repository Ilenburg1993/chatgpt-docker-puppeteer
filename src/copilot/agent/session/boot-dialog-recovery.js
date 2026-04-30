// @ts-check
/**
 * @module copilot/agent/session/boot-dialog-recovery
 * @file Seams de recuperação do dialog loop durante boot/resume.
 */

import { EMITTER_DIALOG_BOOT_RECOVERY } from '#copilot/events';
import { BOOT_RECOVERY_DELAY_MS } from '../../config/agent.js';
import { logSwallowed, toError } from '../../core/error-handlers.js';
import { registerTimer } from '../../core/timer-registry.js';
import {
    clearAgentRuntimePendingQuestionShadow,
    markAgentRuntimeDialogPausedForRecovery,
    shouldReapAgentRuntimePendingQuestionShadow,
    shouldScheduleAgentRuntimeDialogBootRecovery,
} from '../facades/agent-runtime-state.js';
import { log } from '../ports/logging-port.js';

/**
 * @typedef {import('./boot-session-prep.js').BootWiringContext} BootWiringContext
 */

/**
 * @param {BootWiringContext} ctx
 * @returns {void}
 */
export function scheduleDialogBootRecovery(ctx) {
    log('DEBUG', '[AlwaysAlive] F53/F42.1: Recovery do dialog loop agendado após resume.');
    const bootRecoveryTimer = setTimeout(() => {
        if (ctx.getStatus() === 'stopped') {
            return;
        }

        void ctx.trackBackgroundTask(runDialogBootRecovery(ctx), {
            label: 'dialog.boot_recovery.run',
            description: 'Retry dialog loop recovery after resumed session boot',
        });
    }, BOOT_RECOVERY_DELAY_MS);
    bootRecoveryTimer.unref?.();
    registerTimer('agent.dialogBootRecovery', 'timeout', bootRecoveryTimer);
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
        const pausedPersist = await markAgentRuntimeDialogPausedForRecovery();
        if (!pausedPersist.ok) {
            logSwallowed(pausedPersist.error, 'agent.bootWiring.persistDialogPaused');
        }
        await ctx.resumeDialogLoop();
        log('INFO', '[AlwaysAlive] F53: Dialog loop retomado após boot recovery.');
        ctx.emit(EMITTER_DIALOG_BOOT_RECOVERY, { zeroPR: !ctx.dialogLoopActive(), ts: Date.now() });
    } catch (e) {
        log('WARN', `[AlwaysAlive] F53: Boot recovery falhou (${toError(e).message}) — fallback para startDialogLoop.`);
        try {
            await ctx.startDialogLoop();
        } catch (e2) {
            log('WARN', `[AlwaysAlive] F53: Fallback startDialogLoop também falhou: ${toError(e2).message}`);
        }
    }
}

/**
 * @param {boolean} isResumed
 * @param {BootWiringContext} ctx
 * @returns {void}
 */
export function stepScheduleDialogRecovery(isResumed, ctx) {
    if (!isResumed) {
        return;
    }

    void ctx.trackBackgroundTask(
        shouldScheduleAgentRuntimeDialogBootRecovery().then((shouldSchedule) => {
            if (shouldSchedule) {
                scheduleDialogBootRecovery(ctx);
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
