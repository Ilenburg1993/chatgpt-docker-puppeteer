// @ts-check
/**
 * @module copilot/agent/facades/agent-runtime-controls
 * @file Facade canônica para controles/mutações auxiliares do runtime do agent.
 *
 *   Esta camada concentra helpers operacionais que antes eram importados de forma solta do barrel do `agent/` (snapshots,
 *   threshold de compaction e leitura do handoff manager), deixando as bordas consumirem uma superfície explícita e
 *   estável.
 */

import { setBackgroundCompactionThreshold } from '../session/initializer.js';
import { createSnapshot, listSnapshotsAsync, loadSnapshotAsync, saveSnapshotAsync } from '../session/snapshot.js';
import { readAgentRuntimeHealthSnapshot, readAgentRuntimeStatusSnapshot } from './agent-runtime-status.js';

/**
 * @typedef {{
 *     getHandoffManager?: (() => import('../infra/handoff-manager.js').HandoffManager | null) | undefined;
 *     start?: (() => Promise<void>) | undefined;
 *     abortCurrentMessage?: (() => Promise<void>) | undefined;
 *     answerPendingQuestion?: ((answer: string) => boolean) | undefined;
 *     clearPendingQuestionShadow?: (() => boolean) | undefined;
 *     on?: ((event: string, handler: (...args: any[]) => void) => unknown) | undefined;
 *     once?: ((event: string, handler: (...args: any[]) => void) => unknown) | undefined;
 *     off?: ((event: string, handler: (...args: any[]) => void) => unknown) | undefined;
 *     pauseDialogLoop?: (() => Promise<void>) | undefined;
 *     resumeDialogLoop?: (() => Promise<void>) | undefined;
 *     dialogLoopActive?: boolean | undefined;
 *     dialogPaused?: boolean | undefined;
 *     dialogPrMetrics?:
 *         | { boots: number; resumesWithPR: number; resumesZeroPR: number; totalPR: number }
 *         | null
 *         | undefined;
 *     lastPrInfo?:
 *         | { model?: string; cost?: number; quotaSnapshots?: Record<string, unknown>; ts: number }
 *         | null
 *         | undefined;
 *     pendingQuestion?: import('../types.js').PendingQuestion | null | undefined;
 *     pendingQuestionKind?: import('../types.js').PendingQuestionKind | null | undefined;
 *     pendingQuestionShadow?: import('../types.js').PendingQuestionShadow | null | undefined;
 *     pendingQuestionShadowKind?: import('../types.js').PendingQuestionKind | null | undefined;
 *     pendingQuestionShadowState?: import('../types.js').PendingQuestionShadowState | null | undefined;
 *     pendingQuestionShadowExpired?: boolean | undefined;
 *     pendingQuestionShadowAgeMs?: number | null | undefined;
 *     pendingQuestionShadowExpiresAt?: number | null | undefined;
 *     pendingQuestionShadowRemainingMs?: number | null | undefined;
 * }} AgentRuntimeControlsTarget
 *
 *
 * @typedef {{
 *     status: string;
 *     model: string;
 *     reasoningEffort: string;
 *     sessionId: string | null;
 *     dialogLoopActive: boolean;
 *     dialogPaused: boolean;
 *     queueSize: number;
 * }} AgentRuntimeControlState
 *
 *
 * @typedef {{
 *     sendCount: number;
 *     dialogLoopActive: boolean;
 *     sessionId: string | null;
 *     prMetrics: { boots: number; resumesWithPR: number; resumesZeroPR: number; totalPR: number };
 *     lastPrInfo: { model?: string; cost?: number; quotaSnapshots?: Record<string, unknown>; ts: number } | null;
 * }} AgentRuntimePrBudgetSnapshot
 *
 *
 * @typedef {{
 *     pendingQuestion: import('../types.js').PendingQuestion | null;
 *     pendingQuestionKind: import('../types.js').PendingQuestionKind | null;
 *     pendingQuestionShadow: import('../types.js').PendingQuestionShadow | null;
 *     pendingQuestionShadowKind: import('../types.js').PendingQuestionKind | null;
 *     pendingQuestionShadowState: import('../types.js').PendingQuestionShadowState | null;
 *     pendingQuestionShadowExpired: boolean;
 *     pendingQuestionShadowAgeMs: number | null;
 *     pendingQuestionShadowExpiresAt: number | null;
 *     pendingQuestionShadowRemainingMs: number | null;
 * }} AgentRuntimeInteractionState
 */

/**
 * @param {AgentRuntimeControlsTarget} runtime
 * @returns {AgentRuntimeControlState}
 */
export function readRuntimeControlState(runtime) {
    const snap = readAgentRuntimeStatusSnapshot(/** @type {import('../types.js').IAlwaysAliveAgent} */ (runtime));
    const health = readAgentRuntimeHealthSnapshot(/** @type {import('../types.js').IAlwaysAliveAgent} */ (runtime));
    const dialogChecks =
        health && typeof health.checks?.dialog === 'object' ? health.checks.dialog : /** @type {any} */ (null);

    return {
        status: String(snap['status'] ?? 'unknown'),
        model: String(snap['model'] ?? 'unknown'),
        reasoningEffort: String(snap['reasoningEffort'] ?? 'off'),
        sessionId: typeof snap['sessionId'] === 'string' ? snap['sessionId'] : null,
        dialogLoopActive: Boolean(health?.dialogLoopActive ?? runtime.dialogLoopActive),
        dialogPaused: Boolean(dialogChecks?.paused ?? runtime.dialogPaused),
        queueSize: Number(snap['queueSize'] ?? 0),
    };
}

/**
 * @param {AgentRuntimeControlsTarget} runtime
 * @returns {AgentRuntimePrBudgetSnapshot}
 */
export function readRuntimePrBudgetSnapshot(runtime) {
    const snap = readAgentRuntimeStatusSnapshot(/** @type {import('../types.js').IAlwaysAliveAgent} */ (runtime));
    const controlState = readRuntimeControlState(runtime);
    return {
        sendCount: Number(snap['sendCount'] ?? 0),
        dialogLoopActive: controlState.dialogLoopActive,
        sessionId: controlState.sessionId,
        prMetrics: runtime.dialogPrMetrics ?? { boots: 0, resumesWithPR: 0, resumesZeroPR: 0, totalPR: 0 },
        lastPrInfo: runtime.lastPrInfo ?? null,
    };
}

/**
 * @param {AgentRuntimeControlsTarget} runtime
 * @returns {AgentRuntimeInteractionState}
 */
export function readRuntimeInteractionState(runtime) {
    const snap = readAgentRuntimeStatusSnapshot(/** @type {import('../types.js').IAlwaysAliveAgent} */ (runtime));
    const pendingQuestion =
        runtime.pendingQuestion ??
        /** @type {import('../types.js').PendingQuestion | null} */ (snap['pendingQuestion'] ?? null);
    const pendingQuestionShadow = runtime.pendingQuestionShadow ?? null;
    const pendingQuestionKind =
        runtime.pendingQuestionKind ??
        (pendingQuestion && typeof pendingQuestion === 'object' && typeof pendingQuestion.kind === 'string'
            ? pendingQuestion.kind
            : null);
    const pendingQuestionShadowKind =
        runtime.pendingQuestionShadowKind ??
        (pendingQuestionShadow &&
        typeof pendingQuestionShadow === 'object' &&
        pendingQuestionShadow.meta &&
        typeof pendingQuestionShadow.meta === 'object' &&
        typeof pendingQuestionShadow.meta.kind === 'string'
            ? pendingQuestionShadow.meta.kind
            : null);
    const pendingQuestionShadowState =
        runtime.pendingQuestionShadowState ??
        (pendingQuestionShadow !== null ? (runtime.pendingQuestionShadowExpired ? 'expired' : 'active') : null);

    return {
        pendingQuestion,
        pendingQuestionKind,
        pendingQuestionShadow,
        pendingQuestionShadowKind,
        pendingQuestionShadowState,
        pendingQuestionShadowExpired: Boolean(runtime.pendingQuestionShadowExpired),
        pendingQuestionShadowAgeMs: runtime.pendingQuestionShadowAgeMs ?? null,
        pendingQuestionShadowExpiresAt: runtime.pendingQuestionShadowExpiresAt ?? null,
        pendingQuestionShadowRemainingMs: runtime.pendingQuestionShadowRemainingMs ?? null,
    };
}

/**
 * @param {AgentRuntimeControlsTarget} runtime
 * @returns {Promise<void>}
 */
export async function startRuntime(runtime) {
    if (typeof runtime.start !== 'function') throw new Error('AGENT_RUNTIME_START_UNAVAILABLE');
    await runtime.start();
}

/**
 * @param {AgentRuntimeControlsTarget} runtime
 * @returns {Promise<void>}
 */
export async function abortRuntimeCurrentMessage(runtime) {
    if (typeof runtime.abortCurrentMessage !== 'function') throw new Error('AGENT_RUNTIME_ABORT_UNAVAILABLE');
    await runtime.abortCurrentMessage();
}

/**
 * @param {AgentRuntimeControlsTarget} runtime
 * @param {string} answer
 * @returns {boolean}
 */
export function answerRuntimePendingQuestion(runtime, answer) {
    return typeof runtime.answerPendingQuestion === 'function' ? runtime.answerPendingQuestion(answer) : false;
}

/**
 * @param {AgentRuntimeControlsTarget} runtime
 * @returns {boolean}
 */
export function clearRuntimePendingQuestionShadow(runtime) {
    return typeof runtime.clearPendingQuestionShadow === 'function' ? runtime.clearPendingQuestionShadow() : false;
}

/**
 * @param {AgentRuntimeControlsTarget} runtime
 * @param {string} event
 * @param {(...args: any[]) => void} handler
 * @returns {void}
 */
export function onRuntimeEvent(runtime, event, handler) {
    runtime.on?.(event, handler);
}

/**
 * @param {AgentRuntimeControlsTarget} runtime
 * @param {string} event
 * @param {(...args: any[]) => void} handler
 * @returns {void}
 */
export function onceRuntimeEvent(runtime, event, handler) {
    runtime.once?.(event, handler);
}

/**
 * @param {AgentRuntimeControlsTarget} runtime
 * @param {string} event
 * @param {(...args: any[]) => void} handler
 * @returns {void}
 */
export function offRuntimeEvent(runtime, event, handler) {
    runtime.off?.(event, handler);
}

/**
 * @param {AgentRuntimeControlsTarget} runtime
 * @returns {Promise<void>}
 */
export async function pauseRuntimeDialogLoop(runtime) {
    if (typeof runtime.pauseDialogLoop !== 'function') throw new Error('AGENT_RUNTIME_DIALOG_PAUSE_UNAVAILABLE');
    await runtime.pauseDialogLoop();
}

/**
 * @param {AgentRuntimeControlsTarget} runtime
 * @returns {Promise<void>}
 */
export async function resumeRuntimeDialogLoop(runtime) {
    if (typeof runtime.resumeDialogLoop !== 'function') throw new Error('AGENT_RUNTIME_DIALOG_RESUME_UNAVAILABLE');
    await runtime.resumeDialogLoop();
}

/**
 * @param {AgentRuntimeControlsTarget} runtime
 * @returns {import('../infra/handoff-manager.js').HandoffManager | null}
 */
export function getRuntimeHandoffManager(runtime) {
    return runtime.getHandoffManager?.() ?? null;
}

/**
 * @param {AgentRuntimeControlsTarget} runtime
 * @returns {import('../infra/handoff-manager.js').HandoffRequest[]}
 */
export function getRuntimeHandoffHistory(runtime) {
    return getRuntimeHandoffManager(runtime)?.getHistory?.() ?? [];
}

/**
 * @param {number} threshold
 * @returns {void}
 */
export function setRuntimeBackgroundCompactionThreshold(threshold) {
    setBackgroundCompactionThreshold(threshold);
}

/**
 * @param {Parameters<typeof createSnapshot>[0]} data
 * @returns {ReturnType<typeof createSnapshot>}
 */
export function createRuntimeSnapshot(data) {
    return createSnapshot(data);
}

/**
 * @param {Parameters<typeof saveSnapshotAsync>[0]} snapshot
 * @returns {ReturnType<typeof saveSnapshotAsync>}
 */
export function saveRuntimeSnapshot(snapshot) {
    return saveSnapshotAsync(snapshot);
}

/**
 * @returns {ReturnType<typeof listSnapshotsAsync>}
 */
export function listRuntimeSnapshots() {
    return listSnapshotsAsync();
}

/**
 * @param {string} snapshotId
 * @returns {ReturnType<typeof loadSnapshotAsync>}
 */
export function loadRuntimeSnapshot(snapshotId) {
    return loadSnapshotAsync(snapshotId);
}
