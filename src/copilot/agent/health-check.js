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

    const runtimeOperational =
        snap.status === 'idle' || snap.status === 'processing' || snap.status === 'waiting_for_input';

    const clientAvailable = ctx.ioState.client !== null;
    const sessionActive = ctx.sessionState.session !== null && Boolean(snap.sessionId);
    const dialogActive = ctx.dialogLoop.active;
    const dialogAttached = ctx.dialogState.dialogLoopAttached;
    const dialogOk = !dialogActive || dialogAttached;
    const queueOk = !snap.starvationAlert;
    const hasPendingQuestion = ctx.dialogState.pendingQuestion !== null;
    const waitingForInput = snap.status === 'waiting_for_input';
    const ioOk = !hasPendingQuestion || waitingForInput || dialogActive;
    const keepaliveRunning = ctx.keepalive.running;
    const keepaliveOk = !sessionActive || keepaliveRunning;
    const backgroundPendingCount = ctx.backgroundTasks.pendingCount;
    const backgroundOk = backgroundPendingCount < BACKGROUND_PENDING_WARN_THRESHOLD;
    const quotaMonitorRunning = ctx.quotaMonitor !== null;
    const quotaConfigured = clientAvailable || sessionActive;
    const quotaOk = !quotaConfigured || quotaMonitorRunning;

    /** @type {string[]} */
    const issues = [];
    if (!runtimeOperational) issues.push(`runtime.not_operational.${snap.status}`);
    if (!clientAvailable) issues.push('client.unavailable');
    if (!sessionActive) issues.push('session.inactive');
    if (!dialogOk) issues.push('dialog.detached_while_active');
    if (!queueOk) issues.push('queue.starvation');
    if (!ioOk) issues.push('io.pending_question_mismatch');
    if (!keepaliveOk) issues.push('io.keepalive_stopped');
    if (!backgroundOk) issues.push('background.backlog_high');
    if (!quotaOk) issues.push('quota.monitor_missing');

    /** @type {import('./types.js').AgentHealthStatus} */
    let status = 'healthy';
    if (!runtimeOperational || !clientAvailable || !sessionActive) {
        status = 'unhealthy';
    } else if (!dialogOk || !queueOk || !ioOk || !keepaliveOk || !backgroundOk || !quotaOk) {
        status = 'degraded';
    }

    const ok = status !== 'unhealthy';

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
        queueSize: snap.queueSize,
        oldestTaskWaitMs: snap.oldestTaskWaitMs,
        starvationAlert: snap.starvationAlert,
        backgroundPendingCount,
        uptime: snap.startedAt !== null ? Date.now() - snap.startedAt : null,
        issues,
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
                waitingForInput,
                keepaliveRunning,
                backgroundPendingCount,
            },
            background: {
                ok: backgroundOk,
                pendingCount: backgroundPendingCount,
                warnThreshold: BACKGROUND_PENDING_WARN_THRESHOLD,
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
