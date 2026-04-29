// @ts-check
/**
 * @module copilot/agent/facades/agent-health-access
 * @file Leitura canônica do estado do runtime para composição de snapshot de health.
 */

/**
 * @typedef {import('../agent-context.js').AgentContext} AgentContext
 *
 * @typedef {{
 *     getStatusSnapshot: () => import('../types.js').AgentStatusSnapshot;
 *     getSdkResourceSnapshot?: () => import('../types.js').AgentSdkAccessSnapshot | null;
 * }} HealthHost
 */

/**
 * Lê os sinais necessários para cálculo de health sem expor `AgentContext` cru aos consumers.
 *
 * @param {AgentContext} ctx
 * @param {HealthHost} host
 * @returns {{
 *     snap: import('../types.js').AgentStatusSnapshot;
 *     hasPendingQuestion: boolean;
 *     pendingQuestionKind: import('../types.js').PendingQuestionKind | null;
 *     hasPendingQuestionShadow: boolean;
 *     pendingQuestionShadowKind: import('../types.js').PendingQuestionKind | null;
 *     pendingQuestionShadowState: import('../types.js').PendingQuestionShadowState | null;
 *     pendingQuestionShadowExpired: boolean;
 *     pendingQuestionShadowAgeMs: number | null;
 *     pendingQuestionShadowExpiresAt: number | null;
 *     pendingQuestionShadowRemainingMs: number | null;
 *     backgroundPendingLabels: string[];
 *     backgroundPendingCount: number;
 *     bootReport: import('../types.js').AgentBootReport | null;
 *     startReport: import('../types.js').AgentStartReport | null;
 *     sdkResources: import('../types.js').AgentSdkAccessSnapshot | null;
 *     clientAvailable: boolean;
 *     sessionContextActive: boolean;
 *     dialogActive: boolean;
 *     dialogAttached: boolean;
 *     dialogPaused: boolean;
 *     keepaliveRunning: boolean;
 *     quotaMonitorRunning: boolean;
 * }}
 */
export function readAgentHealthInputSnapshot(ctx, host) {
    const snap = host.getStatusSnapshot();
    return {
        snap,
        hasPendingQuestion: ctx.hasPendingQuestion(),
        pendingQuestionKind: ctx.getPendingQuestionKind(),
        hasPendingQuestionShadow: ctx.hasPendingQuestionShadow(),
        pendingQuestionShadowKind: ctx.getPendingQuestionShadowKind(),
        pendingQuestionShadowState: ctx.getPendingQuestionShadowState(),
        pendingQuestionShadowExpired: ctx.isPendingQuestionShadowExpired(),
        pendingQuestionShadowAgeMs: ctx.getPendingQuestionShadowAgeMs(),
        pendingQuestionShadowExpiresAt: ctx.getPendingQuestionShadowExpiresAt(),
        pendingQuestionShadowRemainingMs: ctx.getPendingQuestionShadowRemainingMs(),
        backgroundPendingLabels: ctx.getBackgroundPendingLabels(5),
        backgroundPendingCount: ctx.getBackgroundPendingCount(),
        bootReport: ctx.getBootReportSnapshot(),
        startReport: typeof ctx.getStartReportSnapshot === 'function' ? ctx.getStartReportSnapshot() : null,
        sdkResources: typeof host.getSdkResourceSnapshot === 'function' ? host.getSdkResourceSnapshot() : null,
        clientAvailable: ctx.hasClient(),
        sessionContextActive: ctx.hasActiveSession(),
        dialogActive: ctx.isDialogLoopActive(),
        dialogAttached: ctx.getDialogLoopAttachedSnapshot(),
        dialogPaused: ctx.isDialogLoopPaused(),
        keepaliveRunning: ctx.isKeepaliveRunning(),
        quotaMonitorRunning: ctx.getQuotaMonitorSnapshot() !== null,
    };
}
