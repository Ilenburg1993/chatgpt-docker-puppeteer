// @ts-check
/**
 * @module copilot/agent/dialog/boot/loop-runtime-kit
 * @file Kit de inicialização estrutural do DialogLoopManager.
 *
 *   Consolida a criação de componentes internos (state machine, queue, watchdog, fallback e ledger) para reduzir
 *   concentração no construtor do manager principal.
 */

import { getCopilotFallbackModel } from '#copilot/config';
import { BOOT_TIMEOUT_MS, DIALOG_QUEUE_MAX, WATCHDOG_INTERVAL_MS, WATCHDOG_STALL_MS } from '#copilot/config/agent';
import { readAgentRuntimeDialogBootstrapState } from '../../facades/agent-runtime-state.js';
import { DialogCompactionPolicy, ModelFallbackState } from '../policies/index.js';
import { DialogCostLedger, DialogLoopStateMachine, TurnQueue } from '../state/index.js';
import { DialogWatchdogSupervisor } from '../watchdogs/index.js';

/**
 * @typedef {{
 *     maxQueueSize?: number;
 *     bootTimeoutMs?: number;
 *     watchdogIntervalMs?: number;
 *     watchdogStallMs?: number;
 *     fallbackModel?: string | null;
 * }} DialogLoopManagerOptions
 */

/**
 * @typedef {{
 *     turnQueue: TurnQueue;
 *     bootTimeoutMs: number;
 *     watchdogSupervisor: DialogWatchdogSupervisor;
 *     modelFallback: ModelFallbackState;
 *     compactionPolicy: DialogCompactionPolicy;
 *     costLedger: DialogCostLedger;
 *     state: DialogLoopStateMachine;
 * }} DialogLoopRuntimeKit
 */

/**
 * Cria o conjunto estrutural usado pelo DialogLoopManager.
 *
 * @param {DialogLoopManagerOptions} options
 * @param {{
 *     onStall: (stalledMs: number) => void;
 *     onPreStallWarning: (stalledMs: number) => void;
 * }} handlers
 * @returns {DialogLoopRuntimeKit}
 */
export function createDialogLoopRuntimeKit(options, handlers) {
    const turnQueue = new TurnQueue({ maxSize: options.maxQueueSize ?? DIALOG_QUEUE_MAX });
    const bootTimeoutMs = options.bootTimeoutMs ?? BOOT_TIMEOUT_MS;

    const watchdogSupervisor = new DialogWatchdogSupervisor({
        intervalMs: options.watchdogIntervalMs ?? WATCHDOG_INTERVAL_MS,
        stallThresholdMs: options.watchdogStallMs ?? WATCHDOG_STALL_MS,
        onStall: handlers.onStall,
        onPreStallWarning: handlers.onPreStallWarning,
    });

    const modelFallback = new ModelFallbackState({
        defaultModel: options.fallbackModel ?? getCopilotFallbackModel(),
    });

    const compactionPolicy = new DialogCompactionPolicy();

    const persistedBootstrap = readAgentRuntimeDialogBootstrapState();
    const state = new DialogLoopStateMachine({ paused: persistedBootstrap.dialogPaused });
    const saved = persistedBootstrap.usageMetrics ?? persistedBootstrap.prMetrics;
    const costLedger = new DialogCostLedger(saved && typeof saved === 'object' ? saved : null);

    return {
        turnQueue,
        bootTimeoutMs,
        watchdogSupervisor,
        modelFallback,
        compactionPolicy,
        costLedger,
        state,
    };
}
