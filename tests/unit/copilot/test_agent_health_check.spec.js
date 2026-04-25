// @ts-check

import * as assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { getAgentHealthSnapshot } from '../../../src/copilot/agent/health-check.js';

/**
 * @param {{
 *     status?: import('../../../src/copilot/agent/types.js').AgentStatus;
 *     sessionId?: string | null;
 *     queueSize?: number;
 *     oldestTaskWaitMs?: number;
 *     starvationAlert?: boolean;
 *     isResumed?: boolean;
 *     sdkResources?: import('../../../src/copilot/agent/types.js').AgentSdkAccessSnapshot | null;
 * }} [overrides]
 */
function createHost(overrides = {}) {
    return {
        getStatusSnapshot() {
            return /** @type {import('../../../src/copilot/agent/types.js').AgentStatusSnapshot} */ ({
                status: overrides.status ?? 'idle',
                sessionId: overrides.sessionId ?? 'session-1',
                model: 'gpt-5',
                reasoningEffort: 'high',
                queueSize: overrides.queueSize ?? 0,
                oldestTaskWaitMs: overrides.oldestTaskWaitMs ?? 0,
                starvationAlert: overrides.starvationAlert ?? false,
                pendingQuestion: null,
                isResumed: overrides.isResumed ?? false,
                resumeCount: 0,
                sendCount: 0,
                startedAt: Date.now() - 1000,
                contextWindow: null,
                lastCheckpointPath: null,
                permissionMode: 'approve_all',
            });
        },
        getSdkResourceSnapshot() {
            return overrides.sdkResources ?? null;
        },
    };
}

/**
 * @param {Partial<import('../../../src/copilot/agent/types.js').AgentSdkAccessSnapshot>} [overrides]
 * @returns {import('../../../src/copilot/agent/types.js').AgentSdkAccessSnapshot}
 */
function createSdkResources(overrides = {}) {
    return {
        handles: {
            client: /** @type {any} */ ({}),
            session: /** @type {any} */ ({}),
            serverRpc: /** @type {any} */ ({}),
            sessionRpc: /** @type {any} */ ({}),
            workspacePath: '/workspace',
        },
        resources: {
            clientAvailable: true,
            sessionAvailable: true,
            serverRpcAvailable: true,
            sessionRpcAvailable: true,
            workspacePathAvailable: true,
            permissionHandlerAvailable: true,
            userInputHandlerAvailable: true,
            hooksAvailable: true,
            toolRegistryAvailable: true,
            modelSwitchAvailable: true,
            abortAvailable: true,
            sessionLogAvailable: true,
            historyAvailable: true,
            serverModelsListAvailable: true,
            serverToolsListAvailable: true,
            quotaAvailable: true,
            lastSessionLookupAvailable: true,
            foregroundControlAvailable: true,
            workspaceRpcAvailable: true,
            compactionAvailable: true,
            shellAvailable: true,
            uiElicitationAvailable: true,
            pendingCommandsAvailable: true,
            pendingPermissionsAvailable: true,
            pendingToolsAvailable: true,
            customAgentsAvailable: true,
            experimentalAgentsAvailable: true,
            skillsAvailable: true,
            mcpAvailable: true,
            pluginsAvailable: true,
            extensionsAvailable: true,
            fleetAvailable: true,
        },
        missingResources: [],
        allCoreResourcesAvailable: true,
        allRuntimeResourcesAvailable: true,
        ...overrides,
    };
}

/**
 * @param {{
 *     hasClient?: boolean;
 *     hasSession?: boolean;
 *     dialogActive?: boolean;
 *     dialogAttached?: boolean;
 *     pendingQuestion?: boolean;
 *     pendingQuestionKind?: import('../../../src/copilot/agent/types.js').PendingQuestionKind;
 *     pendingQuestionShadow?: boolean;
 *     pendingQuestionShadowKind?: import('../../../src/copilot/agent/types.js').PendingQuestionKind;
 *     pendingQuestionShadowExpired?: boolean;
 *     keepaliveRunning?: boolean;
 *     backgroundPendingCount?: number;
 *     quotaMonitorRunning?: boolean;
 *     bootReport?: import('../../../src/copilot/agent/types.js').AgentBootReport | null;
 * }} [overrides]
 */
function createContext(overrides = {}) {
    const pendingQuestion = overrides.pendingQuestion
        ? /** @type {any} */ ({
              question: 'Q?',
              kind: overrides.pendingQuestionKind ?? 'ready',
              allowFreeform: true,
              askedAt: Date.now(),
              protocolControlled: true,
          })
        : null;
    const pendingQuestionShadow = overrides.pendingQuestionShadow
        ? /** @type {any} */ ({
              question: 'READY: aguardando próxima mensagem',
              meta: {
                  kind: overrides.pendingQuestionShadowKind ?? 'ready',
                  askedAt: Date.now(),
                  allowFreeform: true,
                  protocolControlled: true,
              },
              restoredAt: Date.now(),
              expiresAt: Date.now() + 60_000,
          })
        : null;
    return /** @type {import('../../../src/copilot/agent/agent-context.js').AgentContext} */ ({
        ioState: {
            client: overrides.hasClient === false ? null : /** @type {any} */ ({}),
        },
        sessionState: {
            session: overrides.hasSession === false ? null : /** @type {any} */ ({}),
        },
        dialogState: {
            pendingQuestion,
            pendingQuestionShadow,
            dialogLoopAttached: overrides.dialogAttached ?? true,
        },
        dialogLoop: {
            active: overrides.dialogActive ?? false,
            paused: false,
        },
        keepalive: {
            running: overrides.keepaliveRunning ?? true,
        },
        backgroundTasks: {
            pendingCount: overrides.backgroundPendingCount ?? 0,
            getPendingLabels: () => ((overrides.backgroundPendingCount ?? 0) > 0 ? ['bg.task.1', 'bg.task.2'] : []),
        },
        getBackgroundPendingLabels: () =>
            (overrides.backgroundPendingCount ?? 0) > 0 ? ['bg.task.1', 'bg.task.2'] : [],
        runtimeState: {
            lastBootReport: /** @type {any} */ (overrides.bootReport ?? null),
        },
        quotaMonitor: overrides.quotaMonitorRunning ? /** @type {any} */ ({ stop() {} }) : null,
        hasClient: () => overrides.hasClient !== false,
        hasActiveSession: () => overrides.hasSession !== false,
        getPendingQuestionSnapshot: () =>
            pendingQuestion
                ? {
                      question: pendingQuestion.question,
                      allowFreeform: pendingQuestion.allowFreeform,
                      askedAt: pendingQuestion.askedAt,
                      kind: pendingQuestion.kind,
                      protocolControlled: pendingQuestion.protocolControlled,
                      ...(pendingQuestion.choices !== undefined ? { choices: pendingQuestion.choices } : {}),
                  }
                : null,
        hasPendingQuestion: () => pendingQuestion !== null,
        getPendingQuestionKind: () => pendingQuestion?.kind ?? null,
        getPendingQuestionShadowSnapshot: () => (pendingQuestionShadow ? { ...pendingQuestionShadow } : null),
        hasPendingQuestionShadow: () => pendingQuestionShadow !== null,
        getPendingQuestionShadowKind: () => pendingQuestionShadow?.meta.kind ?? null,
        getPendingQuestionShadowState: () =>
            pendingQuestionShadow !== null ? (overrides.pendingQuestionShadowExpired ? 'expired' : 'active') : null,
        isPendingQuestionShadowExpired: () => overrides.pendingQuestionShadowExpired ?? false,
        getPendingQuestionShadowAgeMs: () => (pendingQuestionShadow !== null ? 1_000 : null),
        getPendingQuestionShadowExpiresAt: () => (pendingQuestionShadow !== null ? Date.now() + 60_000 : null),
        getPendingQuestionShadowRemainingMs: () => (pendingQuestionShadow !== null ? 60_000 : null),
        getDialogLoopAttachedSnapshot: () => overrides.dialogAttached ?? true,
        isDialogLoopActive: () => overrides.dialogActive ?? false,
        isDialogLoopPaused: () => false,
        isKeepaliveRunning: () => overrides.keepaliveRunning ?? true,
        getBackgroundPendingCount: () => overrides.backgroundPendingCount ?? 0,
        getBootReportSnapshot: () => /** @type {any} */ (overrides.bootReport ?? null),
        getQuotaMonitorSnapshot: () => (overrides.quotaMonitorRunning ? /** @type {any} */ ({ stop() {} }) : null),
    });
}

describe('agent/health-check', () => {
    it('retorna healthy quando runtime, sessão e fila estão consistentes', () => {
        const health = getAgentHealthSnapshot(createContext({ quotaMonitorRunning: true }), createHost());

        assert.equal(health.ok, true);
        assert.equal(health.healthy, true);
        assert.equal(health.status, 'healthy');
        assert.deepEqual(health.issues, []);
        assert.equal(health.checks.runtime.ok, true);
        assert.equal(health.agentStatus, 'idle');
        assert.equal(health.checks.client.ok, true);
        assert.equal(health.checks.session.ok, true);
        assert.equal(health.checks.queue.ok, true);
        assert.equal(health.checks.io.ok, true);
        assert.equal(health.pendingQuestionKind, null);
        assert.equal(health.pendingQuestionShadow, false);
        assert.equal(health.pendingQuestionShadowKind, null);
        assert.equal(health.pendingQuestionShadowState, null);
        assert.equal(health.pendingQuestionShadowExpired, false);
        assert.equal(health.checks.quota.ok, true);
        assert.equal(health.checks.background.ok, true);
        assert.deepEqual(health.backgroundPendingLabels, []);
        assert.deepEqual(health.riskFlags, []);
        assert.equal(health.recommendedAction, 'none');
        assert.equal(health.checks.boot.ok, true);
        assert.equal(health.checks.boot.degradedSteps, 0);
        assert.equal(health.sdkResources, null);
        assert.equal(health.checks.sdkResources.ok, true);
        assert.equal(health.checks.sdkResources.available, false);
    });

    it('retorna degraded quando há inconsistência de dialog, starvation e backlog alto', () => {
        const health = getAgentHealthSnapshot(
            createContext({ dialogActive: true, dialogAttached: false, backgroundPendingCount: 12 }),
            createHost({ starvationAlert: true, oldestTaskWaitMs: 65_000, queueSize: 2 }),
        );

        assert.equal(health.ok, true);
        assert.equal(health.status, 'degraded');
        assert.equal(health.checks.dialog.ok, false);
        assert.equal(health.checks.queue.ok, false);
        assert.equal(health.checks.background.ok, false);
        assert.equal(health.checks.quota.ok, false);
        assert.ok(health.issues.includes('dialog.detached_while_active'));
        assert.ok(health.issues.includes('queue.starvation'));
        assert.ok(health.issues.includes('background.backlog_high'));
        assert.ok(health.issues.includes('quota.monitor_missing'));
        assert.equal(health.starvationAlert, true);
        assert.deepEqual(health.backgroundPendingLabels, ['bg.task.1', 'bg.task.2']);
        assert.ok(health.riskFlags.includes('dialog.detached'));
        assert.ok(health.riskFlags.includes('background.backlog_high'));
        assert.equal(health.recommendedAction, 'reattach_dialog');
    });

    it('nao degrada keepalive parado quando o dialog loop esta ativo', () => {
        const health = getAgentHealthSnapshot(
            createContext({ dialogActive: true, keepaliveRunning: false, quotaMonitorRunning: true }),
            createHost({ status: 'waiting_for_input' }),
        );

        assert.equal(health.ok, true);
        assert.equal(health.dialogLoopActive, true);
        assert.equal(health.checks.io.keepaliveRunning, false);
        assert.equal(health.checks.io.ok, true);
        assert.equal(health.issues.includes('io.keepalive_stopped'), false);
        assert.notEqual(health.recommendedAction, 'restart_keepalive');
    });

    it('marca shadow expiring_soon sem tratá-la como expirada', () => {
        const health = getAgentHealthSnapshot(
            /** @type {any} */ ({
                ...createContext({ pendingQuestionShadow: true, quotaMonitorRunning: true }),
                getPendingQuestionShadowState: () => 'expiring_soon',
                getPendingQuestionShadowRemainingMs: () => 15_000,
            }),
            createHost(),
        );

        assert.equal(health.pendingQuestionShadowState, 'expiring_soon');
        assert.equal(health.pendingQuestionShadowExpired, false);
        assert.equal(health.pendingQuestionShadowRemainingMs, 15_000);
        assert.ok(health.issues.includes('io.pending_question_shadow_expiring_soon'));
        assert.equal(health.recommendedAction, 'review_pending_question_shadow');
    });

    it('retorna degraded quando o boot conclui com steps degradados', () => {
        const health = getAgentHealthSnapshot(
            createContext({
                quotaMonitorRunning: true,
                bootReport: {
                    startedAt: 1,
                    completedAt: 2,
                    ok: true,
                    stepCount: 2,
                    degradedCount: 1,
                    failedCount: 0,
                    steps: [
                        { name: 'wireSessionEvents', phase: 'session', status: 'ok', durationMs: 1, ts: 1 },
                        {
                            name: 'startQuotaMonitor',
                            phase: 'quota',
                            status: 'degraded',
                            durationMs: 1,
                            ts: 2,
                            error: 'quota unavailable',
                        },
                    ],
                },
            }),
            createHost(),
        );

        assert.equal(health.status, 'degraded');
        assert.ok(health.issues.includes('boot.steps_degraded'));
        assert.equal(health.checks.boot.ok, false);
        assert.equal(health.checks.boot.failedSteps, 0);
        assert.equal(health.checks.boot.degradedSteps, 1);
        assert.ok(health.riskFlags.includes('boot.degraded'));
        assert.equal(health.recommendedAction, 'inspect_boot_report');
    });

    it('retorna unhealthy quando runtime não está operacional ou sessão/client faltam', () => {
        const health = getAgentHealthSnapshot(
            createContext({ hasClient: false, hasSession: false, pendingQuestion: true }),
            createHost({ status: 'stopped', sessionId: null }),
        );

        assert.equal(health.ok, false);
        assert.equal(health.healthy, false);
        assert.equal(health.status, 'unhealthy');
        assert.equal(health.pendingQuestionKind, 'ready');
        assert.ok(health.issues.includes('runtime.not_operational.stopped'));
        assert.ok(health.issues.includes('client.unavailable'));
        assert.ok(health.issues.includes('session.inactive'));
        assert.equal(health.checks.client.ok, false);
        assert.equal(health.checks.session.ok, false);
        assert.ok(health.riskFlags.includes('runtime.stopped'));
        assert.equal(health.recommendedAction, 'restart_agent');
    });

    it('retorna degraded acionável quando recursos SDK core estão incompletos', () => {
        const sdkResources = createSdkResources({
            missingResources: ['sessionRpc'],
            allCoreResourcesAvailable: false,
            allRuntimeResourcesAvailable: false,
        });
        const health = getAgentHealthSnapshot(
            createContext({ quotaMonitorRunning: true }),
            createHost({ sdkResources }),
        );

        assert.equal(health.ok, true);
        assert.equal(health.status, 'degraded');
        assert.equal(health.sdkResources, sdkResources);
        assert.ok(health.issues.includes('sdk.resources_incomplete'));
        assert.ok(health.riskFlags.includes('sdk.resources_incomplete'));
        assert.equal(health.recommendedAction, 'inspect_sdk_resources');
        assert.equal(health.checks.sdkResources.ok, false);
        assert.equal(health.checks.sdkResources.available, true);
        assert.deepEqual(health.checks.sdkResources.missingResources, ['sessionRpc']);
    });

    it('retorna degraded quando existe sombra persistida de ask_user sem pergunta viva', () => {
        const health = getAgentHealthSnapshot(
            createContext({
                quotaMonitorRunning: true,
                pendingQuestionShadow: true,
                pendingQuestionShadowKind: 'ready',
            }),
            createHost(),
        );

        assert.equal(health.status, 'degraded');
        assert.equal(health.pendingQuestion, false);
        assert.equal(health.pendingQuestionShadow, true);
        assert.equal(health.pendingQuestionShadowKind, 'ready');
        assert.equal(health.pendingQuestionShadowExpired, false);
        assert.ok(health.issues.includes('io.pending_question_shadow'));
        assert.ok(health.riskFlags.includes('io.pending_question_shadow'));
        assert.equal(health.recommendedAction, 'review_pending_question_shadow');
        assert.equal(health.checks.io.pendingQuestionShadow, true);
    });

    it('retorna ação de limpeza quando a shadow restaurada já expirou', () => {
        const health = getAgentHealthSnapshot(
            createContext({
                quotaMonitorRunning: true,
                pendingQuestionShadow: true,
                pendingQuestionShadowKind: 'ready',
                pendingQuestionShadowExpired: true,
            }),
            createHost(),
        );

        assert.equal(health.status, 'degraded');
        assert.equal(health.pendingQuestionShadow, true);
        assert.equal(health.pendingQuestionShadowExpired, true);
        assert.ok(health.issues.includes('io.pending_question_shadow_expired'));
        assert.ok(health.riskFlags.includes('io.pending_question_shadow_expired'));
        assert.equal(health.recommendedAction, 'clear_pending_question_shadow');
        assert.equal(health.checks.io.pendingQuestionShadowExpired, true);
    });

    it('retorna degraded quando o último boot teve steps com falha', () => {
        const health = getAgentHealthSnapshot(
            createContext({
                quotaMonitorRunning: true,
                bootReport: {
                    startedAt: 1,
                    completedAt: 2,
                    ok: false,
                    stepCount: 2,
                    degradedCount: 0,
                    failedCount: 1,
                    steps: [
                        { name: 'wireSessionEvents', phase: 'session', status: 'ok', durationMs: 1, ts: 1 },
                        {
                            name: 'startQuotaMonitor',
                            phase: 'quota',
                            status: 'failed',
                            durationMs: 1,
                            ts: 2,
                            error: 'boom',
                        },
                    ],
                },
            }),
            createHost(),
        );

        assert.equal(health.status, 'degraded');
        assert.ok(health.issues.includes('boot.steps_failed'));
        assert.equal(health.checks.boot.ok, false);
        assert.equal(health.checks.boot.failedSteps, 1);
        assert.equal(health.checks.boot.degradedSteps, 0);
        assert.equal(health.bootReport?.ok, false);
        assert.ok(health.riskFlags.includes('boot.failed'));
        assert.equal(health.recommendedAction, 'inspect_boot_report');
    });
});
