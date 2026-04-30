// @ts-check
/**
 * @module copilot/agent/runtime/shutdown-snapshot-state
 * @file Seams de governança de snapshot operacional e shutdown gracioso.
 */

import { persistStateWithPolicy } from '../lifecycle/state-io.js';
import { createSnapshot, saveSnapshotAsync } from '../session/snapshot.js';

/**
 * @typedef {import('../facades/agent-runtime-state.js').AgentRuntimeStateContext} AgentRuntimeStateContext
 */

/**
 * Reseta a flag persistida de shutdown gracioso no começo do boot do runtime.
 *
 * @returns {Promise<
 *     import('../error-policy.js').AgentPolicyResult<import('../lifecycle/state-io.js').AliveAgentState>
 * >}
 */
export async function resetAgentRuntimeGracefulShutdownFlag() {
    return persistStateWithPolicy({ gracefulShutdown: false }, { label: 'state.gracefulShutdown.reset' });
}

/**
 * Persiste o último snapshot de consumo PR do runtime.
 *
 * @param {{ model?: string; cost?: number; quotaSnapshots?: Record<string, unknown>; ts: number }} info
 * @returns {Promise<
 *     import('../error-policy.js').AgentPolicyResult<import('../lifecycle/state-io.js').AliveAgentState>
 * >}
 */
export async function persistAgentRuntimePrConsumptionSnapshot(info) {
    return persistStateWithPolicy(
        {
            pendingTurnConsumedPR: true,
            lastPrConsumedAt: info.ts,
            lastPrModel: info.model ?? '',
            lastPrCost: info.cost ?? 0,
            lastQuotaSnapshots: info.quotaSnapshots ?? null,
        },
        { label: 'state.pr_consumed.persist' },
    );
}

/**
 * Salva snapshot operacional do runtime antes do shutdown.
 *
 * @param {AgentRuntimeStateContext} ctx
 * @param {{
 *     sessionId?: string | null;
 *     dialogLoopActive: boolean;
 *     dialogPrMetrics?: { boots: number; resumesWithPR: number; resumesZeroPR: number; totalPR: number } | null;
 *     reason?: string;
 * }} options
 * @returns {Promise<string>}
 */
export async function saveAgentRuntimeShutdownSnapshot(ctx, options) {
    const pendingQuestion = ctx.getPendingQuestionSnapshot?.() ?? null;
    const snap = createSnapshot({
        sessionId: options.sessionId ?? null,
        model: ctx.getModelSnapshot?.() ?? 'unknown',
        status: ctx.getRuntimeStatus?.() ?? 'unknown',
        sendCount: ctx.getSendCountSnapshot?.() ?? 0,
        dialogLoopActive: options.dialogLoopActive,
        dialogPaused: ctx.isDialogLoopPaused?.() ?? false,
        pendingQuestion: pendingQuestion?.question ?? null,
        pendingQuestionMeta:
            pendingQuestion !== null
                ? {
                      kind: pendingQuestion.kind,
                      askedAt: pendingQuestion.askedAt,
                      allowFreeform: pendingQuestion.allowFreeform,
                      protocolControlled: pendingQuestion.protocolControlled,
                      ...(pendingQuestion.choices !== undefined ? { choices: pendingQuestion.choices } : {}),
                  }
                : null,
        prMetrics: options.dialogPrMetrics ?? null,
        reason: options.reason ?? 'auto-shutdown',
    });
    return saveSnapshotAsync(snap);
}

/**
 * Persiste o state mínimo de shutdown gracioso para o próximo boot.
 *
 * @param {AgentRuntimeStateContext} ctx
 * @param {{ dialogLoopActive: boolean }} options
 * @returns {Promise<
 *     import('../error-policy.js').AgentPolicyResult<import('../lifecycle/state-io.js').AliveAgentState>
 * >}
 */
export async function persistAgentRuntimeGracefulShutdownState(ctx, options) {
    return persistStateWithPolicy(
        {
            sendCount: ctx.getSendCountSnapshot?.() ?? 0,
            gracefulShutdown: true,
            dialogLoopActive: options.dialogLoopActive,
            dialogPaused: ctx.isDialogLoopPaused?.() ?? false,
        },
        { label: 'state.gracefulShutdown.persist' },
    );
}
