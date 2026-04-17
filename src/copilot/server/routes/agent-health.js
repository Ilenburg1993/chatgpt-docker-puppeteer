// @ts-check
/**
 * @module copilot/server/routes/agent-health
 * @file Projeções compartilhadas do snapshot de health do agente para rotas HTTP e registries.
 */

/**
 * @typedef {import('../../agent/types.js').IAlwaysAliveAgent} AlwaysAliveAgentLike
 */

/**
 * Normaliza o snapshot de health do agente, usando a implementação canônica quando disponível e aplicando fallback de
 * compatibilidade quando necessário.
 *
 * @param {AlwaysAliveAgentLike} agent
 * @returns {import('../../agent/types.js').AgentHealthSnapshot}
 */
export function getAgentHealthSnapshotCompat(agent) {
    return typeof agent.getHealthSnapshot === 'function' ? agent.getHealthSnapshot() : buildLegacyAgentHealth(agent);
}

/**
 * @param {import('../../agent/types.js').AgentHealthSnapshot} health
 * @returns {number}
 */
export function getAgentHealthHttpStatus(health) {
    return health.ok ? 200 : 503;
}

/**
 * Projeta o snapshot do agente para o registry agregado de health por módulos.
 *
 * @param {AlwaysAliveAgentLike} agent
 * @returns {{ ok: boolean; details: Record<string, unknown> }}
 */
export function buildAgentModuleHealth(agent) {
    const health = getAgentHealthSnapshotCompat(agent);

    return {
        ok: health.ok,
        details: {
            status: health.agentStatus,
            healthStatus: health.status,
            dialogLoopActive: health.dialogLoopActive,
            dialogAttached: health.checks.dialog.attached,
            dialogPaused: health.checks.dialog.paused,
            model: health.model,
            queueSize: health.queueSize,
            oldestTaskWaitMs: health.oldestTaskWaitMs,
            starvationAlert: health.starvationAlert,
            keepaliveRunning: health.checks.io.keepaliveRunning,
            backgroundPendingCount: health.backgroundPendingCount,
            quotaMonitorRunning: health.checks.quota.running,
            issues: health.issues,
        },
    };
}

/**
 * Fallback de compatibilidade para instâncias que ainda não expõem `getHealthSnapshot()`.
 *
 * @param {AlwaysAliveAgentLike} agent
 * @returns {import('../../agent/types.js').AgentHealthSnapshot}
 */
export function buildLegacyAgentHealth(agent) {
    const snap = agent.getStatusSnapshot();
    const operational = snap.status === 'idle' || snap.status === 'processing' || snap.status === 'waiting_for_input';

    /** @type {string[]} */
    const issues = [];
    if (!operational) {
        issues.push(`runtime.not_operational.${snap.status}`);
    }
    if (snap.sessionId === null) {
        issues.push('session.inactive');
    }

    return {
        ok: operational,
        healthy: operational,
        status: operational ? 'healthy' : 'unhealthy',
        agentStatus: /** @type {import('../../agent/types.js').AgentStatus} */ (snap.status),
        sessionId: snap.sessionId,
        model: snap.model,
        reasoningEffort: undefined,
        dialogLoopActive: Boolean(agent.dialogLoopActive),
        pendingQuestion: snap.pendingQuestion !== null,
        queueSize: snap.queueSize,
        oldestTaskWaitMs: snap.oldestTaskWaitMs,
        starvationAlert: snap.starvationAlert,
        backgroundPendingCount: 0,
        uptime: snap.startedAt !== null ? Date.now() - snap.startedAt : null,
        issues,
        checks: {
            runtime: {
                ok: operational,
                status: /** @type {import('../../agent/types.js').AgentStatus} */ (snap.status),
                operational,
            },
            client: {
                ok: operational,
                available: operational,
            },
            session: {
                ok: snap.sessionId !== null && operational,
                active: snap.sessionId !== null,
                resumed: snap.isResumed,
            },
            dialog: {
                ok: true,
                active: Boolean(agent.dialogLoopActive),
                attached: true,
                paused: Boolean(agent.dialogPaused),
            },
            queue: {
                ok: !snap.starvationAlert,
                size: snap.queueSize,
                oldestTaskWaitMs: snap.oldestTaskWaitMs,
                starvationAlert: snap.starvationAlert,
            },
            io: {
                ok: true,
                pendingQuestion: snap.pendingQuestion !== null,
                waitingForInput: snap.status === 'waiting_for_input',
                keepaliveRunning: false,
                backgroundPendingCount: 0,
            },
            background: {
                ok: true,
                pendingCount: 0,
                warnThreshold: 8,
            },
            quota: {
                ok: true,
                configured: false,
                running: false,
            },
        },
        ts: Date.now(),
    };
}
