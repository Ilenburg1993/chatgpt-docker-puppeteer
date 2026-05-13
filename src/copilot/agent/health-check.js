// @ts-check
/**
 * @module copilot/agent/health-check
 * @file Health check canônico do AlwaysAliveAgent. Consolida sinais de runtime, sessão, diálogo, fila e consistência de
 *   I/O em um snapshot operacional reutilizável por rotas e observability.
 * @see EventBus
 */

/**
 * @typedef {import('./agent-context.js').AgentContext} AgentContext
 */

import { readAgentHealthInputSnapshot } from './facades/index.js';

/**
 * @typedef {{
 *     getStatusSnapshot: () => import('./types.js').AgentStatusSnapshot;
 *     getSdkResourceSnapshot?: () => import('./types.js').AgentSdkAccessSnapshot | null;
 * }} HealthHost
 */

const BACKGROUND_PENDING_WARN_THRESHOLD = 8;

/**
 * @param {{
 *     runtimeOperational: boolean;
 *     clientAvailable: boolean;
 *     sessionActive: boolean;
 *     dialogOk: boolean;
 *     queueOk: boolean;
 *     ioOk: boolean;
 *     pendingQuestionShadow: boolean;
 *     pendingQuestionShadowExpired: boolean;
 *     keepaliveOk: boolean;
 *     backgroundOk: boolean;
 *     bootOk: boolean;
 *     bootNeedsAttention: boolean;
 *     quotaOk: boolean;
 *     sdkResourcesOk: boolean;
 * }} state
 * @returns {import('./types.js').AgentRecommendedAction}
 */
function selectRecommendedAction(state) {
    if (!state.runtimeOperational) return 'restart_agent';
    if (!state.clientAvailable) return 'recreate_client';
    if (!state.sessionActive) return 'recreate_session';
    if (!state.dialogOk) return 'reattach_dialog';
    if (!state.ioOk) return 'resolve_pending_question';
    if (state.pendingQuestionShadowExpired) return 'clear_pending_question_shadow';
    if (state.pendingQuestionShadow) return 'review_pending_question_shadow';
    if (!state.keepaliveOk) return 'restart_keepalive';
    if (!state.bootOk || state.bootNeedsAttention) return 'inspect_boot_report';
    if (!state.quotaOk) return 'restart_quota_monitor';
    if (!state.sdkResourcesOk) return 'inspect_sdk_resources';
    if (!state.backgroundOk) return 'drain_background_tasks';
    if (!state.queueOk) return 'inspect_queue_starvation';
    return 'none';
}

/**
 * Monta um snapshot de health do agente a partir do contexto interno e do snapshot público de status.
 *
 * - `healthy`/`ok` indica se o agente segue operacional para chamadas externas.
 * - `status` indica granularidade operacional: `healthy`, `degraded` ou `unhealthy`.
 *
 * @param {AgentContext} ctx
 * @param {HealthHost} host
 * @returns {import('./types.js').AgentHealthSnapshot}
 */
export function getAgentHealthSnapshot(ctx, host) {
    const healthInput = readAgentHealthInputSnapshot(ctx, host);
    const {
        snap,
        hasPendingQuestion,
        pendingQuestionKind,
        hasPendingQuestionShadow,
        pendingQuestionShadowKind,
        pendingQuestionShadowState,
        pendingQuestionShadowExpired,
        pendingQuestionShadowAgeMs,
        pendingQuestionShadowExpiresAt,
        pendingQuestionShadowRemainingMs,
        backgroundPendingLabels,
        backgroundPendingCount,
        bootReport,
        startReport,
        sdkResources,
        clientAvailable,
        sessionContextActive,
        dialogActive,
        dialogAttached,
        dialogPaused,
        keepaliveRunning,
        quotaMonitorRunning,
    } = healthInput;

    const runtimeOperational =
        snap.status === 'idle' || snap.status === 'processing' || snap.status === 'waiting_for_input';

    const sessionActive = sessionContextActive && Boolean(snap.sessionId);
    const dialogOk = !dialogActive || dialogAttached;
    const queueOk = !snap.starvationAlert;
    const waitingForInput = snap.status === 'waiting_for_input';
    const ioOk = !hasPendingQuestion || waitingForInput || dialogActive;
    const keepaliveSuppressedByDialog = sessionActive && dialogActive;
    const keepaliveOk = !sessionActive || keepaliveRunning || keepaliveSuppressedByDialog;
    const backgroundOk = backgroundPendingCount < BACKGROUND_PENDING_WARN_THRESHOLD;
    const failedBootSteps = bootReport?.failedCount ?? 0;
    const degradedBootSteps = bootReport?.degradedCount ?? 0;
    const bootOk = bootReport === null || bootReport.ok;
    const bootNeedsAttention = degradedBootSteps > 0;
    const quotaConfigured = clientAvailable || sessionActive;
    const quotaOk = !quotaConfigured || quotaMonitorRunning;
    const sdkResourcesOk = sdkResources === null || sdkResources.allCoreResourcesAvailable;

    /** @type {import('./types.js').AgentHealthRiskFlag[]} */
    const riskFlags = [];

    /** @type {string[]} */
    const issues = [];
    if (!runtimeOperational) {
        issues.push(`runtime.not_operational.${snap.status}`);
        riskFlags.push('runtime.stopped');
    }
    if (!clientAvailable) {
        issues.push('client.unavailable');
        riskFlags.push('client.missing');
    }
    if (!sessionActive) {
        issues.push('session.inactive');
        riskFlags.push('session.missing');
    }
    if (!dialogOk) {
        issues.push('dialog.detached_while_active');
        riskFlags.push('dialog.detached');
    }
    if (!queueOk) {
        issues.push('queue.starvation');
        riskFlags.push('queue.starvation');
    }
    if (!ioOk) {
        issues.push('io.pending_question_mismatch');
        riskFlags.push('io.pending_question_drift');
    }
    if (!hasPendingQuestion && hasPendingQuestionShadow) {
        issues.push('io.pending_question_shadow');
        riskFlags.push('io.pending_question_shadow');
        if (pendingQuestionShadowExpired) {
            issues.push('io.pending_question_shadow_expired');
            riskFlags.push('io.pending_question_shadow_expired');
        } else if (pendingQuestionShadowState === 'expiring_soon') {
            issues.push('io.pending_question_shadow_expiring_soon');
            riskFlags.push('io.pending_question_shadow_expiring_soon');
        }
    }
    if (!keepaliveOk) {
        issues.push('io.keepalive_stopped');
        riskFlags.push('io.keepalive_stopped');
    }
    if (!backgroundOk) {
        issues.push('background.backlog_high');
        riskFlags.push('background.backlog_high');
    }
    if (!bootOk) {
        issues.push('boot.steps_failed');
        riskFlags.push('boot.failed');
    } else if (bootNeedsAttention) {
        issues.push('boot.steps_degraded');
        riskFlags.push('boot.degraded');
    }
    if (!quotaOk) {
        issues.push('quota.monitor_missing');
        riskFlags.push('quota.monitor_missing');
    }
    if (!sdkResourcesOk) {
        issues.push('sdk.resources_incomplete');
        riskFlags.push('sdk.resources_incomplete');
    }

    /** @type {import('./types.js').AgentHealthStatus} */
    let status = 'healthy';
    if (!runtimeOperational || !clientAvailable || !sessionActive) {
        status = 'unhealthy';
    } else if (
        !dialogOk ||
        !queueOk ||
        !ioOk ||
        hasPendingQuestionShadow ||
        !keepaliveOk ||
        !backgroundOk ||
        !bootOk ||
        bootNeedsAttention ||
        !quotaOk ||
        !sdkResourcesOk
    ) {
        status = 'degraded';
    }

    const ok = status !== 'unhealthy';
    const recommendedAction = selectRecommendedAction({
        runtimeOperational,
        clientAvailable,
        sessionActive,
        dialogOk,
        queueOk,
        ioOk,
        pendingQuestionShadow: hasPendingQuestionShadow,
        pendingQuestionShadowExpired,
        keepaliveOk,
        backgroundOk,
        bootOk,
        bootNeedsAttention,
        quotaOk,
        sdkResourcesOk,
    });

    return {
        ok,
        healthy: ok,
        status,
        agentStatus: /** @type {import('./types.js').AgentStatus} */ (snap.status),
        sessionId: snap.sessionId,
        model: snap.model,
        reasoningEffort: snap.reasoningEffort,
        dialogLoopActive: dialogActive,
        pendingQuestion: hasPendingQuestion,
        pendingQuestionKind,
        pendingQuestionShadow: hasPendingQuestionShadow,
        pendingQuestionShadowKind,
        pendingQuestionShadowState,
        pendingQuestionShadowExpired,
        pendingQuestionShadowAgeMs,
        pendingQuestionShadowExpiresAt,
        pendingQuestionShadowRemainingMs,
        queueSize: snap.queueSize,
        oldestTaskWaitMs: snap.oldestTaskWaitMs,
        starvationAlert: snap.starvationAlert,
        backgroundPendingCount,
        backgroundPendingLabels,
        riskFlags,
        recommendedAction,
        uptime: snap.startedAt !== null ? Date.now() - snap.startedAt : null,
        issues,
        bootReport,
        startReport,
        sdkResources,
        checks: {
            runtime: {
                ok: runtimeOperational,
                status: /** @type {import('./types.js').AgentStatus} */ (snap.status),
                operational: runtimeOperational,
            },
            client: {
                ok: clientAvailable && runtimeOperational,
                available: clientAvailable,
            },
            session: {
                ok: sessionActive && runtimeOperational,
                active: sessionActive,
                resumed: snap.isResumed,
            },
            dialog: {
                ok: dialogOk,
                active: dialogActive,
                attached: dialogAttached,
                paused: dialogPaused,
            },
            queue: {
                ok: queueOk,
                size: snap.queueSize,
                oldestTaskWaitMs: snap.oldestTaskWaitMs,
                starvationAlert: snap.starvationAlert,
            },
            io: {
                ok: ioOk && keepaliveOk,
                pendingQuestion: hasPendingQuestion,
                pendingQuestionKind,
                pendingQuestionShadow: hasPendingQuestionShadow,
                pendingQuestionShadowKind,
                pendingQuestionShadowState,
                pendingQuestionShadowExpired,
                pendingQuestionShadowAgeMs,
                pendingQuestionShadowExpiresAt,
                pendingQuestionShadowRemainingMs,
                waitingForInput,
                keepaliveRunning,
                backgroundPendingCount,
            },
            background: {
                ok: backgroundOk,
                pendingCount: backgroundPendingCount,
                warnThreshold: BACKGROUND_PENDING_WARN_THRESHOLD,
                labels: backgroundPendingLabels,
            },
            sdkResources: {
                ok: sdkResourcesOk,
                available: sdkResources !== null,
                allCoreResourcesAvailable: sdkResources?.allCoreResourcesAvailable ?? null,
                allRuntimeResourcesAvailable: sdkResources?.allRuntimeResourcesAvailable ?? null,
                missingResources: sdkResources?.missingResources ?? [],
            },
            boot: {
                ok: bootOk && !bootNeedsAttention,
                reportAvailable: bootReport !== null,
                failedSteps: failedBootSteps,
                degradedSteps: degradedBootSteps,
                lastCompletedAt: bootReport?.completedAt ?? null,
            },
            quota: {
                ok: quotaOk,
                configured: quotaConfigured,
                running: quotaMonitorRunning,
            },
        },
        ts: Date.now(),
    };
}
