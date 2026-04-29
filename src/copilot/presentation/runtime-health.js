// @ts-check
/**
 * @module copilot/presentation/runtime-health
 * @file Projeções compartilhadas de health do runtime do agent para bordas HTTP/registry.
 *
 *   Esta camada retira de `server/routes/*` a responsabilidade de montar fallback/shape de health do runtime e mantém a
 *   semântica compartilhada próxima de `runtime-overview.js` e `runtime-status.js`.
 */

import {
    readAgentRuntimeHealthSnapshot,
    readAgentRuntimeSdkResourceSnapshot,
    readRuntimeControlState,
} from '#copilot/agent';
import { resolveAgentRuntimeSelection } from './agent-runtime.js';
import { readRuntimeLifecycleSnapshot } from './runtime-lifecycle.js';
import { buildRuntimeRouteMetaFromSelection } from './runtime-meta.js';
import { readAgentStatusSnapshot } from './runtime-status.js';

/**
 * @typedef {import('../agent/types.js').IAlwaysAliveAgent} AlwaysAliveAgentLike
 */

/**
 * @typedef {{
 *     status: string;
 *     sessionId: string | null;
 *     model: string;
 *     queueSize: number;
 *     pendingQuestion: object | null;
 *     isResumed: boolean;
 *     resumeCount: number;
 *     sendCount: number;
 *     startedAt: number | null;
 *     starvationAlert: boolean;
 *     oldestTaskWaitMs: number;
 * }} LegacyAgentSnap
 */

/**
 * @param {unknown} value
 * @returns {import('../agent/types.js').PendingQuestionKind | null}
 */
function normalizePendingQuestionKind(value) {
    return value === 'ready' || value === 'reply' || value === 'stopped' || value === 'question' ? value : null;
}

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {{
 *     agent: AlwaysAliveAgentLike;
 *     runtimeId: string;
 *     requestedRuntimeId: string | null;
 *     runtimeFound: boolean;
 *     usedDefaultRuntimeFallback: boolean;
 * }}
 */
function resolveRuntimeHealthTarget(runtimeId) {
    const selection = resolveAgentRuntimeSelection(runtimeId);
    return {
        agent: selection.runtime,
        ...buildRuntimeRouteMetaFromSelection(selection),
    };
}

/**
 * @param {AlwaysAliveAgentLike} agent
 * @returns {import('../agent/types.js').AgentHealthSnapshot}
 */
export function getAgentHealthSnapshotCompat(agent) {
    return readAgentRuntimeHealthSnapshot(agent) ?? buildLegacyAgentHealth(agent);
}

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {import('../agent/types.js').AgentHealthSnapshot}
 */
export function getDefaultAgentHealthSnapshotCompat(runtimeId) {
    return getAgentHealthSnapshotCompat(resolveRuntimeHealthTarget(runtimeId).agent);
}

/**
 * Resolve health + metadata de seleção do runtime para bordas HTTP e troubleshooting.
 *
 * @param {string | null | undefined} [runtimeId]
 * @returns {{
 *     health: import('../agent/types.js').AgentHealthSnapshot;
 *     runtimeId: string;
 *     requestedRuntimeId: string | null;
 *     runtimeFound: boolean;
 *     usedDefaultRuntimeFallback: boolean;
 * }}
 */
export function resolveAgentHealthSelection(runtimeId) {
    const target = resolveRuntimeHealthTarget(runtimeId);
    return {
        health: getAgentHealthSnapshotCompat(target.agent),
        runtimeId: target.runtimeId,
        requestedRuntimeId: target.requestedRuntimeId,
        runtimeFound: target.runtimeFound,
        usedDefaultRuntimeFallback: target.usedDefaultRuntimeFallback,
    };
}

/**
 * @param {import('../agent/types.js').AgentHealthSnapshot} health
 * @returns {number}
 */
export function getAgentHealthHttpStatus(health) {
    return health.ok ? 200 : 503;
}

/**
 * @param {AlwaysAliveAgentLike} agent
 * @returns {{ ok: boolean; details: Record<string, unknown> }}
 */
export function buildAgentModuleHealth(agent) {
    const health = getAgentHealthSnapshotCompat(agent);
    const sdkResources = readAgentRuntimeSdkResourceSnapshot(agent);
    const lifecycle = readRuntimeLifecycleSnapshot();

    return {
        ok: health.ok && !lifecycle.shuttingDown,
        details: {
            status: health.agentStatus,
            healthStatus: health.status,
            shuttingDown: lifecycle.shuttingDown,
            dialogLoopActive: health.dialogLoopActive,
            dialogAttached: health.checks.dialog.attached,
            dialogPaused: health.checks.dialog.paused,
            pendingQuestionKind: health.pendingQuestionKind,
            pendingQuestionShadow: health.pendingQuestionShadow,
            pendingQuestionShadowKind: health.pendingQuestionShadowKind,
            pendingQuestionShadowState: health.pendingQuestionShadowState,
            pendingQuestionShadowExpired: health.pendingQuestionShadowExpired,
            pendingQuestionShadowAgeMs: health.pendingQuestionShadowAgeMs,
            pendingQuestionShadowExpiresAt: health.pendingQuestionShadowExpiresAt,
            pendingQuestionShadowRemainingMs: health.pendingQuestionShadowRemainingMs,
            model: health.model,
            queueSize: health.queueSize,
            oldestTaskWaitMs: health.oldestTaskWaitMs,
            starvationAlert: health.starvationAlert,
            keepaliveRunning: health.checks.io.keepaliveRunning,
            backgroundPendingCount: health.backgroundPendingCount,
            backgroundPendingLabels: health.backgroundPendingLabels,
            riskFlags: health.riskFlags,
            recommendedAction: health.recommendedAction,
            startReport: health.startReport,
            bootFailedSteps: health.checks.boot.failedSteps,
            bootDegradedSteps: health.checks.boot.degradedSteps,
            bootLastCompletedAt: health.checks.boot.lastCompletedAt,
            quotaMonitorRunning: health.checks.quota.running,
            sdkResources,
            lifecycle,
            issues: health.issues,
        },
    };
}

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {{ ok: boolean; details: Record<string, unknown> }}
 */
export function buildDefaultAgentModuleHealth(runtimeId) {
    return buildAgentModuleHealth(resolveRuntimeHealthTarget(runtimeId).agent);
}

/**
 * @param {AlwaysAliveAgentLike} agent
 * @returns {import('../agent/types.js').AgentHealthSnapshot}
 */
export function buildLegacyAgentHealth(agent) {
    const snap = /** @type {LegacyAgentSnap} */ (readAgentStatusSnapshot(agent));
    const controlState = readRuntimeControlState(agent);
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
        agentStatus: /** @type {import('../agent/types.js').AgentStatus} */ (snap.status),
        sessionId: snap.sessionId,
        model: snap.model,
        reasoningEffort: undefined,
        dialogLoopActive: controlState.dialogLoopActive,
        pendingQuestion: snap.pendingQuestion !== null,
        pendingQuestionKind:
            snap.pendingQuestion && typeof snap.pendingQuestion === 'object'
                ? normalizePendingQuestionKind(/** @type {{ kind?: unknown }} */ (snap.pendingQuestion).kind ?? null)
                : null,
        pendingQuestionShadow: false,
        pendingQuestionShadowKind: null,
        pendingQuestionShadowState: null,
        pendingQuestionShadowExpired: false,
        pendingQuestionShadowAgeMs: null,
        pendingQuestionShadowExpiresAt: null,
        pendingQuestionShadowRemainingMs: null,
        queueSize: snap.queueSize,
        oldestTaskWaitMs: snap.oldestTaskWaitMs,
        starvationAlert: snap.starvationAlert,
        backgroundPendingCount: 0,
        backgroundPendingLabels: [],
        riskFlags: operational ? ['session.missing'] : ['runtime.stopped', 'session.missing', 'client.missing'],
        recommendedAction: operational ? 'recreate_session' : 'restart_agent',
        uptime: snap.startedAt !== null ? Date.now() - snap.startedAt : null,
        issues,
        bootReport: null,
        startReport: null,
        sdkResources: null,
        checks: {
            runtime: {
                ok: operational,
                status: /** @type {import('../agent/types.js').AgentStatus} */ (snap.status),
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
                active: controlState.dialogLoopActive,
                attached: true,
                paused: controlState.dialogPaused,
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
                pendingQuestionKind:
                    snap.pendingQuestion && typeof snap.pendingQuestion === 'object'
                        ? normalizePendingQuestionKind(
                              /** @type {{ kind?: unknown }} */ (snap.pendingQuestion).kind ?? null,
                          )
                        : null,
                pendingQuestionShadow: false,
                pendingQuestionShadowKind: null,
                pendingQuestionShadowState: null,
                pendingQuestionShadowExpired: false,
                pendingQuestionShadowAgeMs: null,
                pendingQuestionShadowExpiresAt: null,
                pendingQuestionShadowRemainingMs: null,
                waitingForInput: snap.status === 'waiting_for_input',
                keepaliveRunning: false,
                backgroundPendingCount: 0,
            },
            background: {
                ok: true,
                pendingCount: 0,
                warnThreshold: 8,
                labels: [],
            },
            sdkResources: {
                ok: true,
                available: false,
                allCoreResourcesAvailable: null,
                allRuntimeResourcesAvailable: null,
                missingResources: [],
            },
            boot: {
                ok: true,
                reportAvailable: false,
                failedSteps: 0,
                degradedSteps: 0,
                lastCompletedAt: null,
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
