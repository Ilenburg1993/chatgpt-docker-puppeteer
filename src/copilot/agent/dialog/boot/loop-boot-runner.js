// @ts-check
/**
 * @module copilot/agent/dialog/boot/loop-boot-runner
 * @file Execução do boot do dialog loop: boot prompt, READY tardio e persistência operacional.
 */

import { BOOT_LATE_PROTOCOL_GRACE_MS, LONG_TASK_TIMEOUT_MS } from '#copilot/config/agent';
import { toError } from '#copilot/core';
import { DialogProtocol } from '#copilot/dialog';
import { EMITTER_LOOP_CHANGED, EMITTER_LOOP_READY, EMITTER_LOOP_TURN_TIMEOUT } from '#copilot/events';
import { waitForAgentSdkEvent } from '../../facades/agent-sdk-runtime.js';
import { log } from '../../ports/logging/index.js';

/**
 * @typedef {import('node:events').EventEmitter} EventEmitter
 *
 * @typedef {import('../../types.js').DialogLoopHost} DialogLoopHost
 *
 * @typedef {import('./loop-boot-circuit.js').DialogBootCircuit} DialogBootCircuit
 *
 * @typedef {import('../policies/model-fallback.js').ModelFallbackState} ModelFallbackState
 *
 * @typedef {import('../state/cost-ledger.js').DialogCostLedger} DialogCostLedger
 *
 * @typedef {import('../state/state-machine.js').DialogLoopStateMachine} DialogLoopStateMachine
 *
 * @typedef {import('../watchdogs/watchdog-supervisor.js').DialogWatchdogSupervisor} DialogWatchdogSupervisor
 *
 * @typedef {{
 *     emitter: EventEmitter;
 *     host: DialogLoopHost;
 *     state: DialogLoopStateMachine;
 *     bootTimeoutMs: number;
 *     watchdogSupervisor: DialogWatchdogSupervisor;
 *     modelFallback: ModelFallbackState;
 *     costLedger: DialogCostLedger;
 *     bootCircuit: DialogBootCircuit;
 *     bootPrompt?: string;
 *     emit: (event: string, payload?: unknown) => boolean;
 *     trackPersistedState: (
 *         data: Record<string, unknown>,
 *         meta: { label?: string; description?: string },
 *     ) => Promise<void>;
 *     persistPrMetrics: (label: string, description: string) => Promise<void>;
 *     endLoopSpan: (success: boolean) => void;
 * }} DialogBootRunInput
 */

/**
 * @param {unknown} error
 * @returns {boolean}
 */
export function isBootTimeoutError(error) {
    const candidate = /** @type {{ code?: unknown; message?: unknown }} */ (error);
    const message = typeof candidate?.message === 'string' ? candidate.message : String(error);
    return (
        candidate?.code === 'DIALOG_TIMEOUT' ||
        candidate?.code === 'DIALOG_BOOT_TIMEOUT' ||
        message.includes('Boot timeout')
    );
}

/**
 * @param {DialogLoopHost} host
 * @returns {(msg: string, opts?: { timeoutMs?: number }) => Promise<unknown>}
 */
function resolveBootSendFn(host) {
    if (typeof (/** @type {{ sendMessageDialogBoot?: unknown }} */ (host).sendMessageDialogBoot) === 'function') {
        const sendMessageDialogBoot = /** @type {{ sendMessageDialogBoot: Function }} */ (host).sendMessageDialogBoot;
        return (msg, opts = {}) => Promise.resolve(sendMessageDialogBoot.call(host, msg, opts));
    }
    return (msg, opts = {}) => host.sendMessage(msg, { ...opts, timeoutMs: LONG_TASK_TIMEOUT_MS });
}

/**
 * @param {DialogBootRunInput} input
 * @returns {Promise<boolean>}
 */
async function waitForLateBootReady(input) {
    log(
        'WARN',
        `[DialogLoopManager] Boot timeout atingido; aguardando READY tardio por ${BOOT_LATE_PROTOCOL_GRACE_MS}ms antes de falhar.`,
    );
    try {
        await waitForAgentSdkEvent(input.emitter, EMITTER_LOOP_READY, {
            timeoutMs: BOOT_LATE_PROTOCOL_GRACE_MS,
            timeoutError: `[DialogLoopManager] READY tardio não chegou após ${BOOT_LATE_PROTOCOL_GRACE_MS}ms`,
        });
        return true;
    } catch (lateErr) {
        log('WARN', `[DialogLoopManager] READY tardio ausente: ${toError(lateErr).message}`);
        return false;
    }
}

/**
 * @param {DialogBootRunInput} input
 * @param {unknown} bootErr
 * @returns {void}
 */
function markBootFailed(input, bootErr) {
    input.bootCircuit.recordFailure();
    const reason = toError(bootErr).message;
    input.state.deactivate();
    input.watchdogSupervisor.clear();
    input.endLoopSpan(false);
    input.emit(EMITTER_LOOP_CHANGED, { active: false, ts: Date.now() });
    input.emit('stopped', { reason });
    void input.trackPersistedState(
        { dialogLoopActive: false },
        {
            label: 'dialog.state.boot_failed',
            description: 'Persist dialogLoopActive=false after boot failure',
        },
    );
}

/**
 * @param {DialogBootRunInput} input
 * @param {unknown} bootErr
 * @throws {unknown}
 */
function failBoot(input, bootErr) {
    markBootFailed(input, bootErr);
    throw bootErr;
}

/**
 * Executa o boot do dialog loop após o manager validar attach/circuit/estado ativo.
 *
 * @param {DialogBootRunInput} input
 * @returns {Promise<void>}
 */
export async function runDialogLoopBoot(input) {
    await Promise.resolve(input.modelFallback.applyIfPending(input.host, input.emit));

    const metaPrompt = input.bootPrompt ?? DialogProtocol.buildBootPrompt();
    const bootPromise = waitForAgentSdkEvent(input.emitter, EMITTER_LOOP_READY, {
        timeoutMs: input.bootTimeoutMs,
        timeoutError: `[DialogLoopManager] Boot timeout após ${input.bootTimeoutMs}ms`,
    });

    input.watchdogSupervisor.start();

    const bootSendFn = resolveBootSendFn(input.host);
    let bootFailureHandled = false;
    /** @type {Error | null} */
    let bootSendError = null;
    const bootSendFailure = Promise.resolve(bootSendFn(metaPrompt, { timeoutMs: LONG_TASK_TIMEOUT_MS })).then(
        () => new Promise(() => {}),
        (/** @type {Error} */ e) => {
            if (input.state.active) {
                bootFailureHandled = true;
                bootSendError = e;
                markBootFailed(input, e);
            }
            throw e;
        },
    );

    bootPromise.catch((e) => {
        if (!input.state.active) {
            return;
        }
        if (isBootTimeoutError(e)) {
            input.emit(EMITTER_LOOP_TURN_TIMEOUT, { phase: 'boot', timeoutMs: input.bootTimeoutMs, ts: Date.now() });
            log('WARN', `[DialogLoopManager] Boot timeout (${input.bootTimeoutMs}ms) — evento turn_timeout emitido.`);
        }
    });

    try {
        await Promise.race([bootPromise, bootSendFailure]);
    } catch (bootErr) {
        if (bootFailureHandled) {
            throw bootSendError ?? bootErr;
        }
        if (isBootTimeoutError(bootErr) && (await waitForLateBootReady(input))) {
            log(
                'WARN',
                `[DialogLoopManager] Boot READY recuperado dentro da janela zero-PR (${BOOT_LATE_PROTOCOL_GRACE_MS}ms).`,
            );
        } else {
            failBoot(input, bootErr);
        }
    }

    input.bootCircuit.recordSuccess();
    input.costLedger.recordBoot();
    void input.persistPrMetrics('dialog.prMetrics.boot', 'Persist dialog loop PR metrics after boot');
    log('INFO', '[DialogLoopManager] Dialog loop iniciado.');
}
