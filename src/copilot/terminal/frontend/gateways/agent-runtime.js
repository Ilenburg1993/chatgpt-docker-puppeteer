// @ts-check
import { readAgentSessionBinding } from '#copilot/presentation/agent/runtime';
/**
 * @file Gateway: agent-runtime.
 *
 *   Wraps runtime state reads, lifecycle controls, pending questions, event subscriptions, handoff history, watchdog ping
 *   and snapshot I/O. Isolates `presentation/runtime/index.js` and `presentation/runtime/index.js`.
 */

import {
    abortAgentRuntimeCurrentMessage,
    answerAgentPendingQuestion,
    clearAgentPendingQuestionShadow,
    createAgentRuntimeSnapshot,
    listAgentRuntimeSnapshots,
    loadAgentRuntimeSnapshot,
    offAgentRuntimeEvent,
    onAgentRuntimeEvent,
    onceAgentRuntimeEvent,
    pauseAgentDialogLoop,
    pingDefaultAgentDialogWatchdog,
    readAgentHandoffHistory,
    readAgentRuntimeControlState,
    readAgentRuntimeOverviewProjection,
    readAgentRuntimePermissionMode,
    resumeAgentDialogLoop,
    saveAgentRuntimeSnapshot,
    setAgentRuntimePermissionMode,
    startAgentRuntime,
    steerAgentRuntimeMessage,
    stopAgentRuntime,
    stopAgentRuntimeDialogLoopAuthorized,
} from '#copilot/runtime';

// ---------------------------------------------------------------------------
// State reads
// ---------------------------------------------------------------------------

/**
 * Lê o estado mínimo do runtime para exibição/streaming no terminal.
 *
 * @param {string | null | undefined} [runtimeId]
 * @returns {{
 *     runtimeId: string;
 *     model: string;
 *     reasoningEffort: string;
 *     status: string;
 *     sessionId: string | null;
 *     dialogLoopActive: boolean;
 *     dialogPaused: boolean;
 *     queueSize: number;
 *     pendingQuestion: import('../../../presentation/contracts/index.js').RuntimePendingQuestion | null;
 *     pendingQuestionKind: import('../../../presentation/contracts/index.js').RuntimePendingQuestionKind | null;
 *     pendingQuestionShadow: import('../../../presentation/contracts/index.js').RuntimePendingQuestionShadow | null;
 *     pendingQuestionShadowKind: import('../../../presentation/contracts/index.js').RuntimePendingQuestionKind | null;
 *     pendingQuestionShadowState:
 *         import('../../../presentation/contracts/index.js').RuntimePendingQuestionShadowState | null;
 *     pendingQuestionShadowExpired: boolean;
 *     pendingQuestionShadowAgeMs: number | null;
 *     pendingQuestionShadowExpiresAt: number | null;
 *     pendingQuestionShadowRemainingMs: number | null;
 *     contextWindow: { tokens: number; tokenLimit: number; utilization: number } | null;
 *     lastPrInfo: { model?: string; cost?: number; quotaSnapshots?: Record<string, unknown>; ts: number } | null;
 *     lastLlmUsage: Record<string, unknown> | null;
 * }}
 */
export function readTerminalRuntimeState(runtimeId) {
    const runtime = readAgentRuntimeOverviewProjection(runtimeId);
    return {
        runtimeId: runtime.runtimeId,
        model: runtime.model,
        reasoningEffort: runtime.reasoningEffort,
        status: runtime.status,
        sessionId: runtime.sessionId,
        dialogLoopActive: runtime.dialogLoopActive,
        dialogPaused: runtime.dialogPaused,
        queueSize: runtime.queueSize,
        pendingQuestion: runtime.pendingQuestion,
        pendingQuestionKind: runtime.pendingQuestionKind,
        pendingQuestionShadow: runtime.pendingQuestionShadow,
        pendingQuestionShadowKind: runtime.pendingQuestionShadowKind,
        pendingQuestionShadowState: runtime.pendingQuestionShadowState,
        pendingQuestionShadowExpired: runtime.pendingQuestionShadowExpired,
        pendingQuestionShadowAgeMs: runtime.pendingQuestionShadowAgeMs,
        pendingQuestionShadowExpiresAt: runtime.pendingQuestionShadowExpiresAt,
        pendingQuestionShadowRemainingMs: runtime.pendingQuestionShadowRemainingMs,
        contextWindow: runtime.contextWindow,
        lastPrInfo:
            /**
             * @type {{
             *     model?: string;
             *     cost?: number;
             *     quotaSnapshots?: Record<string, unknown>;
             *     ts: number;
             * } | null}
             */ (runtime.lastPrInfo),
        lastLlmUsage: /** @type {Record<string, unknown> | null} */ (runtime.lastLlmUsage),
    };
}

/**
 * Minimal runtime projection consumed by BYOK request-budget estimation.
 *
 * @param {string | null | undefined} [runtimeId]
 * @returns {ReturnType<typeof readTerminalRuntimeState>['contextWindow']}
 */
export function readTerminalRuntimeContextWindow(runtimeId) {
    return readTerminalRuntimeState(runtimeId).contextWindow;
}

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {ReturnType<typeof readAgentRuntimeControlState>}
 */
export function readTerminalRuntimeControlState(runtimeId) {
    return readAgentRuntimeControlState(runtimeId);
}

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {'approve_all' | 'audit_only' | 'selective'}
 */
export function readTerminalRuntimePermissionMode(runtimeId) {
    return readAgentRuntimePermissionMode(runtimeId);
}

/**
 * @param {'approve_all' | 'audit_only' | 'selective'} mode
 * @param {string | null | undefined} [runtimeId]
 * @returns {'approve_all' | 'audit_only' | 'selective'}
 */
export function setTerminalRuntimePermissionMode(mode, runtimeId) {
    return setAgentRuntimePermissionMode(mode, runtimeId);
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<void>}
 */
export async function startTerminalAgentRuntime(runtimeId) {
    await startAgentRuntime(runtimeId);
}

/**
 * @param {string | null | undefined} [runtimeId]
 * @param {{ shutdownTimeoutMs?: number; preserveDialogLoopIntent?: boolean }} [opts]
 * @returns {Promise<void>}
 */
export async function stopTerminalAgentRuntimeSession(runtimeId, opts = {}) {
    await stopAgentRuntime(runtimeId, opts);
}

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<void>}
 */
export async function abortTerminalCurrentMessage(runtimeId) {
    await abortAgentRuntimeCurrentMessage(runtimeId);
}

/**
 * Envia uma intervenção em modo SDK immediate para o turno ativo.
 *
 * @param {string} prompt
 * @param {string | null | undefined} [runtimeId]
 * @param {{ signal?: AbortSignal }} [opts]
 * @returns {Promise<string>}
 */
export async function steerTerminalMessage(prompt, runtimeId, opts = {}) {
    return steerAgentRuntimeMessage(prompt, runtimeId, opts);
}

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<void>}
 */
export async function pauseTerminalDialogLoop(runtimeId) {
    await pauseAgentDialogLoop(runtimeId);
}

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<void>}
 */
export async function resumeTerminalDialogLoop(runtimeId) {
    await resumeAgentDialogLoop(runtimeId);
}

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {Promise<void>}
 */
export async function stopTerminalAgentRuntime(runtimeId) {
    await stopAgentRuntimeDialogLoopAuthorized(runtimeId);
}

// ---------------------------------------------------------------------------
// Pending questions
// ---------------------------------------------------------------------------

/**
 * @param {string} answer
 * @param {string | null | undefined} [runtimeId]
 * @returns {boolean}
 */
export function answerTerminalPendingQuestion(answer, runtimeId) {
    return answerAgentPendingQuestion(answer, runtimeId);
}

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {boolean}
 */
export function clearTerminalPendingQuestionShadow(runtimeId) {
    return clearAgentPendingQuestionShadow(runtimeId);
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/**
 * @param {string} event
 * @param {(...args: any[]) => void} handler
 * @param {string | null | undefined} [runtimeId]
 * @returns {void}
 */
export function onTerminalAgentRuntimeEvent(event, handler, runtimeId) {
    onAgentRuntimeEvent(event, handler, runtimeId);
}

/**
 * @param {string} event
 * @param {(...args: any[]) => void} handler
 * @param {string | null | undefined} [runtimeId]
 * @returns {void}
 */
export function onceTerminalAgentRuntimeEvent(event, handler, runtimeId) {
    onceAgentRuntimeEvent(event, handler, runtimeId);
}

/**
 * @param {string} event
 * @param {(...args: any[]) => void} handler
 * @param {string | null | undefined} [runtimeId]
 * @returns {void}
 */
export function offTerminalAgentRuntimeEvent(event, handler, runtimeId) {
    offAgentRuntimeEvent(event, handler, runtimeId);
}

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {{
 *     on: (event: string, handler: (...args: any[]) => void) => void;
 *     once: (event: string, handler: (...args: any[]) => void) => void;
 *     off: (event: string, handler: (...args: any[]) => void) => void;
 * }}
 */
export function readTerminalAgentRuntimeEventHost(runtimeId) {
    return {
        on: (event, handler) => onTerminalAgentRuntimeEvent(event, handler, runtimeId),
        once: (event, handler) => onceTerminalAgentRuntimeEvent(event, handler, runtimeId),
        off: (event, handler) => offTerminalAgentRuntimeEvent(event, handler, runtimeId),
    };
}

// ---------------------------------------------------------------------------
// Binding, stream meta, handoff history, watchdog
// ---------------------------------------------------------------------------

/**
 * Binding canônico entre runtime, sessão SDK e hub conversacional.
 *
 * @param {string | null | undefined} [runtimeId]
 * @returns {{ hubSessionId: string | null; sdkSessionId: string | null }}
 */
export function readTerminalSessionBinding(runtimeId) {
    const binding = readAgentSessionBinding(runtimeId);
    return { hubSessionId: binding.hubSessionId, sdkSessionId: binding.sdkSessionId };
}

/**
 * Metadados de streaming/renderização para o frontend local.
 *
 * @param {string | null | undefined} [runtimeId]
 * @returns {{ model: string; reasoningEffort: string }}
 */
export function readTerminalDialogStreamMeta(runtimeId) {
    const state = readTerminalRuntimeState(runtimeId);
    return {
        model: state.model,
        reasoningEffort: state.reasoningEffort,
    };
}

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {import('../../../presentation/contracts/index.js').RuntimeHandoffRequest[]}
 */
export function readTerminalHandoffHistory(runtimeId) {
    return readAgentHandoffHistory(runtimeId);
}

/**
 * Mantém vivo o watchdog de diálogo do runtime.
 *
 * @returns {void}
 */
export function pingTerminalDialogWatchdog() {
    pingDefaultAgentDialogWatchdog();
}

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

/**
 * @param {Parameters<typeof createAgentRuntimeSnapshot>[0]} data
 * @returns {ReturnType<typeof createAgentRuntimeSnapshot>}
 */
export function createTerminalSnapshot(data) {
    return createAgentRuntimeSnapshot(data);
}

/**
 * @param {Parameters<typeof saveAgentRuntimeSnapshot>[0]} data
 * @returns {ReturnType<typeof saveAgentRuntimeSnapshot>}
 */
export function saveTerminalSnapshot(data) {
    return saveAgentRuntimeSnapshot(data);
}

/**
 * @returns {ReturnType<typeof listAgentRuntimeSnapshots>}
 */
export function listTerminalSnapshots() {
    return listAgentRuntimeSnapshots();
}

/**
 * @param {string} snapshotId
 * @returns {ReturnType<typeof loadAgentRuntimeSnapshot>}
 */
export function loadTerminalSnapshot(snapshotId) {
    return loadAgentRuntimeSnapshot(snapshotId);
}
