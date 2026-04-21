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

/** @typedef {{ getStatusSnapshot: () => import('./types.js').AgentStatusSnapshot }} HealthHost */

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
    const snap = host.getStatusSnapshot();

    const dialogLoop = ctx.dialogLoop ?? {};
    const dialogState = ctx.dialogState ?? {};
    const runtimeState = ctx.runtimeState ?? {};

    const pendingQuestion =
        typeof ctx.getPendingQuestionSnapshot === 'function'
            ? ctx.getPendingQuestionSnapshot()
            : (dialogState.pendingQuestion ?? null);
    const pendingQuestionShadow =
        typeof ctx.getPendingQuestionShadowSnapshot === 'function'
            ? ctx.getPendingQuestionShadowSnapshot()
            : (dialogState.pendingQuestionShadow ?? null);

    const hasPendingQuestion =
        typeof ctx.hasPendingQuestion === 'function' ? ctx.hasPendingQuestion() : pendingQuestion !== null;
    const pendingQuestionKind =
        typeof ctx.getPendingQuestionKind === 'function'
            ? ctx.getPendingQuestionKind()
            : (pendingQuestion?.kind ?? null);
    const hasPendingQuestionShadow =
        typeof ctx.hasPendingQuestionShadow === 'function'
            ? ctx.hasPendingQuestionShadow()
            : pendingQuestionShadow !== null;
    const pendingQuestionShadowKind =
        typeof ctx.getPendingQuestionShadowKind === 'function'
            ? ctx.getPendingQuestionShadowKind()
            : (pendingQuestionShadow?.meta?.kind ?? null);
    const pendingQuestionShadowState =
        typeof ctx.getPendingQuestionShadowState === 'function' ? ctx.getPendingQuestionShadowState() : null;
    const pendingQuestionShadowExpired =
        typeof ctx.isPendingQuestionShadowExpired === 'function' ? ctx.isPendingQuestionShadowExpired() : false;
    const pendingQuestionShadowAgeMs =
        typeof ctx.getPendingQuestionShadowAgeMs === 'function' ? ctx.getPendingQuestionShadowAgeMs() : null;
    const pendingQuestionShadowExpiresAt =
        typeof ctx.getPendingQuestionShadowExpiresAt === 'function' ? ctx.getPendingQuestionShadowExpiresAt() : null;
    const pendingQuestionShadowRemainingMs =
        typeof ctx.getPendingQuestionShadowRemainingMs === 'function'
            ? ctx.getPendingQuestionShadowRemainingMs()
            : null;
    const backgroundPendingLabels =
        typeof ctx.getBackgroundPendingLabels === 'function'
            ? ctx.getBackgroundPendingLabels(5)
            : typeof ctx.backgroundTasks?.getPendingLabels === 'function'
              ? ctx.backgroundTasks.getPendingLabels(5)
              : [];
    const bootReport =
        typeof ctx.getBootReportSnapshot === 'function'
            ? ctx.getBootReportSnapshot()
            : (runtimeState.lastBootReport ?? null);

    const runtimeOperational =
        snap.status === 'idle' || snap.status === 'processing' || snap.status === 'waiting_for_input';

    const clientAvailable = ctx.hasClient();
    const sessionActive = ctx.hasActiveSession() && Boolean(snap.sessionId);
    const dialogActive = Boolean(dialogLoop.active);
    const dialogAttached =
        typeof ctx.dialogLoopAttached === 'boolean'
            ? ctx.dialogLoopAttached
            : typeof dialogState.dialogLoopAttached === 'boolean'
              ? dialogState.dialogLoopAttached
              : false;
    const dialogOk = !dialogActive || dialogAttached;
    const queueOk = !snap.starvationAlert;
    const waitingForInput = snap.status === 'waiting_for_input';
    const ioOk = !hasPendingQuestion || waitingForInput || dialogActive;
    const keepaliveRunning = ctx.keepalive.running;
    const keepaliveOk = !sessionActive || keepaliveRunning;
    const backgroundPendingCount = ctx.getBackgroundPendingCount();
    const backgroundOk = backgroundPendingCount < BACKGROUND_PENDING_WARN_THRESHOLD;
    const failedBootSteps = bootReport?.failedCount ?? 0;
    const degradedBootSteps = bootReport?.degradedCount ?? 0;
    const bootOk = bootReport === null || bootReport.ok;
    const bootNeedsAttention = degradedBootSteps > 0;
    const quotaMonitorRunning = ctx.quotaMonitor !== null;
    const quotaConfigured = clientAvailable || sessionActive;
    const quotaOk = !quotaConfigured || quotaMonitorRunning;

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
        !quotaOk
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
                paused: ctx.dialogLoop.paused,
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
