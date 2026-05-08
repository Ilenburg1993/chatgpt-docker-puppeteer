// @ts-check
/**
 * @module copilot/agent/facades/agent-runtime-controls
 * @file Facade canônica para controles/mutações auxiliares do runtime do agent.
 *
 *   Esta camada concentra helpers operacionais que antes eram importados de forma solta do barrel do `agent/` (snapshots,
 *   threshold de compaction e leitura do handoff manager), deixando as bordas consumirem uma superfície explícita e
 *   estável.
 */

import {
    readRuntimeContextFactoryCapabilities,
    readRuntimePermissionCapability,
    readRuntimePermissionMode,
    readRuntimeToolRegistry,
    readRuntimeToolRegistryEntries,
} from '../runtime/governance-readers.js';
import { readAgentRuntimeHealthSnapshot, readAgentRuntimeStatusSnapshot } from '../runtime/status-readers.js';
import { setBackgroundCompactionThreshold } from '../session/initializers/initializer.js';
import { createSnapshot, listSnapshotsAsync, loadSnapshotAsync, saveSnapshotAsync } from '../session/state/snapshot.js';

/**
 * @typedef {{
 *     getHandoffManager?: (() => import('../infra/handoff-manager.js').HandoffManager | null) | undefined;
 *     getHandoffManagerSnapshot?: (() => import('../infra/handoff-manager.js').HandoffManager | null) | undefined;
 *     getRuntimeStatus?: (() => string) | undefined;
 *     getModelSnapshot?: (() => string) | undefined;
 *     getReasoningEffortSnapshot?: (() => string | undefined) | undefined;
 *     getQueueSnapshot?: (() => { size: number }) | undefined;
 *     getPendingQuestionForStatusSnapshot?: (() => import('../types.js').PendingQuestion | null) | undefined;
 *     getPendingQuestionKind?: (() => import('../types.js').PendingQuestionKind | null) | undefined;
 *     getPendingQuestionShadowSnapshot?: (() => import('../types.js').PendingQuestionShadow | null) | undefined;
 *     getPendingQuestionShadowKind?: (() => import('../types.js').PendingQuestionKind | null) | undefined;
 *     getPendingQuestionShadowState?: (() => import('../types.js').PendingQuestionShadowState | null) | undefined;
 *     isPendingQuestionShadowExpired?: (() => boolean) | undefined;
 *     getPendingQuestionShadowAgeMs?: (() => number | null) | undefined;
 *     getPendingQuestionShadowExpiresAt?: (() => number | null) | undefined;
 *     getPendingQuestionShadowRemainingMs?: (() => number | null) | undefined;
 *     isDialogLoopActive?: (() => boolean) | undefined;
 *     isDialogLoopPaused?: (() => boolean) | undefined;
 *     start?: (() => Promise<void>) | undefined;
 *     abortCurrentMessage?: (() => Promise<void>) | undefined;
 *     steerMessage?: ((prompt: string, opts?: { signal?: AbortSignal }) => Promise<string>) | undefined;
 *     answerPendingQuestion?: ((answer: string) => boolean) | undefined;
 *     clearPendingQuestionShadow?: (() => void) | undefined;
 *     on?: ((event: string, handler: (...args: any[]) => void) => unknown) | undefined;
 *     once?: ((event: string, handler: (...args: any[]) => void) => unknown) | undefined;
 *     off?: ((event: string, handler: (...args: any[]) => void) => unknown) | undefined;
 *     pauseDialogLoop?: ((sessionId: string | null) => Promise<void>) | undefined;
 *     resumeDialogLoop?: (() => Promise<void>) | undefined;
 *     dialogLoopActive?: boolean | undefined;
 *     dialogPaused?: boolean | undefined;
 *     dialogPrMetrics?:
 *         | { boots: number; resumesWithPR: number; resumesZeroPR: number; totalPR: number }
 *         | null
 *         | undefined;
 *     lastPrInfo?:
 *         | {
 *               model?: string;
 *               configuredModel?: string;
 *               effectiveModel?: string;
 *               modelMismatch?: boolean;
 *               sessionId?: string | null;
 *               cost?: number;
 *               quotaSnapshots?: Record<string, unknown>;
 *               ts: number;
 *           }
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
 *     lastPrInfo: {
 *         model?: string;
 *         configuredModel?: string;
 *         effectiveModel?: string;
 *         modelMismatch?: boolean;
 *         sessionId?: string | null;
 *         cost?: number;
 *         quotaSnapshots?: Record<string, unknown>;
 *         ts: number;
 *     } | null;
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
 *
 *
 * @typedef {{
 *     getPermissionModeSnapshot?: (() => 'approve_all' | 'audit_only' | 'selective') | undefined;
 *     getPermissionMode?: (() => 'approve_all' | 'audit_only' | 'selective') | undefined;
 *     setPermissionMode?:
 *         | ((
 *               mode: 'approve_all' | 'audit_only' | 'selective',
 *               opts?: { allowTools?: string[]; denyTools?: string[]; denyShell?: boolean },
 *           ) => void)
 *         | undefined;
 *     getPermissionCapabilitySnapshot?:
 *         | (() => ReturnType<import('../agent-context.js').AgentContext['getPermissionCapabilitySnapshot']>)
 *         | undefined;
 *     getContextFactoryCapabilitiesSnapshot?:
 *         | (() => ReturnType<import('../agent-context.js').AgentContext['getContextFactoryCapabilitiesSnapshot']>)
 *         | undefined;
 *     getToolRegistrySnapshot?:
 *         | (() => ReturnType<import('../agent-context.js').AgentContext['getToolRegistrySnapshot']>)
 *         | undefined;
 *     getToolRegistryEntriesSnapshot?:
 *         | (() => ReturnType<import('../agent-context.js').AgentContext['getToolRegistryEntriesSnapshot']>)
 *         | undefined;
 * }} AgentRuntimeGovernanceTarget
 *
 *
 * @typedef {{
 *     permissionMode: 'approve_all' | 'audit_only' | 'selective';
 *     permissionCapability: ReturnType<import('../agent-context.js').AgentContext['getPermissionCapabilitySnapshot']>;
 *     contextFactoryCapabilities: ReturnType<
 *         import('../agent-context.js').AgentContext['getContextFactoryCapabilitiesSnapshot']
 *     >;
 *     toolRegistry: ReturnType<import('../agent-context.js').AgentContext['getToolRegistrySnapshot']>;
 *     toolRegistryEntries: ReturnType<import('../agent-context.js').AgentContext['getToolRegistryEntriesSnapshot']>;
 * }} AgentRuntimeGovernanceState
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
    const queueSnapshot = runtime.getQueueSnapshot?.();

    return {
        status: String(runtime.getRuntimeStatus?.() ?? snap['status'] ?? 'unknown'),
        model: String(runtime.getModelSnapshot?.() ?? snap['model'] ?? 'unknown'),
        reasoningEffort: String(runtime.getReasoningEffortSnapshot?.() ?? snap['reasoningEffort'] ?? 'off'),
        sessionId: typeof snap['sessionId'] === 'string' ? snap['sessionId'] : null,
        dialogLoopActive: Boolean(
            health?.dialogLoopActive ?? runtime.isDialogLoopActive?.() ?? runtime.dialogLoopActive,
        ),
        dialogPaused: Boolean(dialogChecks?.paused ?? runtime.isDialogLoopPaused?.() ?? runtime.dialogPaused),
        queueSize: Number(queueSnapshot?.size ?? snap['queueSize'] ?? 0),
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
        runtime.getPendingQuestionForStatusSnapshot?.() ??
        runtime.pendingQuestion ??
        /** @type {import('../types.js').PendingQuestion | null} */ (snap['pendingQuestion'] ?? null);
    const pendingQuestionShadow = runtime.getPendingQuestionShadowSnapshot?.() ?? runtime.pendingQuestionShadow ?? null;
    const pendingQuestionKind =
        runtime.getPendingQuestionKind?.() ??
        runtime.pendingQuestionKind ??
        (pendingQuestion && typeof pendingQuestion === 'object' && typeof pendingQuestion.kind === 'string'
            ? pendingQuestion.kind
            : null);
    const pendingQuestionShadowKind =
        runtime.getPendingQuestionShadowKind?.() ??
        runtime.pendingQuestionShadowKind ??
        (pendingQuestionShadow &&
        typeof pendingQuestionShadow === 'object' &&
        pendingQuestionShadow.meta &&
        typeof pendingQuestionShadow.meta === 'object' &&
        typeof pendingQuestionShadow.meta.kind === 'string'
            ? pendingQuestionShadow.meta.kind
            : null);
    const pendingQuestionShadowState =
        runtime.getPendingQuestionShadowState?.() ??
        runtime.pendingQuestionShadowState ??
        (pendingQuestionShadow !== null
            ? (runtime.isPendingQuestionShadowExpired?.() ?? runtime.pendingQuestionShadowExpired)
                ? 'expired'
                : 'active'
            : null);

    return {
        pendingQuestion,
        pendingQuestionKind,
        pendingQuestionShadow,
        pendingQuestionShadowKind,
        pendingQuestionShadowState,
        pendingQuestionShadowExpired: Boolean(
            runtime.isPendingQuestionShadowExpired?.() ?? runtime.pendingQuestionShadowExpired,
        ),
        pendingQuestionShadowAgeMs:
            runtime.getPendingQuestionShadowAgeMs?.() ?? runtime.pendingQuestionShadowAgeMs ?? null,
        pendingQuestionShadowExpiresAt:
            runtime.getPendingQuestionShadowExpiresAt?.() ?? runtime.pendingQuestionShadowExpiresAt ?? null,
        pendingQuestionShadowRemainingMs:
            runtime.getPendingQuestionShadowRemainingMs?.() ?? runtime.pendingQuestionShadowRemainingMs ?? null,
    };
}

/**
 * @param {AgentRuntimeGovernanceTarget} runtime
 * @returns {AgentRuntimeGovernanceState}
 */
export function readRuntimeGovernanceState(runtime) {
    return {
        permissionMode: readRuntimePermissionMode(runtime),
        permissionCapability: readRuntimePermissionCapability(runtime),
        contextFactoryCapabilities: readRuntimeContextFactoryCapabilities(runtime),
        toolRegistry: readRuntimeToolRegistry(runtime),
        toolRegistryEntries: readRuntimeToolRegistryEntries(runtime),
    };
}

export {
    readRuntimeContextFactoryCapabilities,
    readRuntimePermissionCapability,
    readRuntimePermissionMode,
    readRuntimeToolRegistry,
    readRuntimeToolRegistryEntries,
};

/**
 * @param {AgentRuntimeGovernanceTarget} runtime
 * @param {'approve_all' | 'audit_only' | 'selective'} mode
 * @param {{ allowTools?: string[]; denyTools?: string[]; denyShell?: boolean }} [opts]
 * @returns {void}
 */
export function setRuntimePermissionMode(runtime, mode, opts = {}) {
    runtime.setPermissionMode?.(mode, opts);
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
 * @param {string} prompt
 * @param {{ signal?: AbortSignal }} [opts]
 * @returns {Promise<string>}
 */
export async function steerRuntimeMessage(runtime, prompt, opts = {}) {
    if (typeof runtime.steerMessage !== 'function') throw new Error('AGENT_RUNTIME_STEER_UNAVAILABLE');
    return runtime.steerMessage(prompt, opts);
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
    if (typeof runtime.clearPendingQuestionShadow !== 'function') {
        return false;
    }
    runtime.clearPendingQuestionShadow();
    return true;
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
    await runtime.pauseDialogLoop(null);
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
    return runtime.getHandoffManagerSnapshot?.() ?? runtime.getHandoffManager?.() ?? null;
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
