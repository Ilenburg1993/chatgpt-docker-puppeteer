// @ts-check

import assert from 'node:assert/strict';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { ALWAYS_ALIVE_AGENT, alwaysAliveAgent } from '#copilot/agent';
import { CONVERSATION_STORE } from '#copilot/conversation-hub';
import { container } from '#copilot/core';
import express from 'express';
import request from 'supertest';

import { buildAgentModuleHealth, buildLegacyAgentHealth } from '../../../src/copilot/server/routes/agent-health.js';
import { registerControlRoutes } from '../../../src/copilot/server/routes/copilot-api/control.js';
import { createHealthRouter } from '../../../src/copilot/server/routes/health.js';

describe('agent health routes', () => {
    /** @type {unknown} */
    let previousAgent;

    /** @type {unknown} */
    let previousConversationStore;

    /** @type {boolean} */
    let hadAgent = false;

    /** @type {boolean} */
    let hadConversationStore = false;

    beforeEach(() => {
        hadAgent = container.has(ALWAYS_ALIVE_AGENT);
        hadConversationStore = container.has(CONVERSATION_STORE);
        previousAgent = hadAgent ? container.resolve(ALWAYS_ALIVE_AGENT) : undefined;
        previousConversationStore = hadConversationStore ? container.resolve(CONVERSATION_STORE) : undefined;
    });

    afterEach(() => {
        container.register(ALWAYS_ALIVE_AGENT, () => (hadAgent ? previousAgent : alwaysAliveAgent), 'singleton');
        container.register(
            CONVERSATION_STORE,
            () =>
                hadConversationStore
                    ? previousConversationStore
                    : {
                          db: {
                              prepare: () => ({ get: () => 1 }),
                          },
                      },
            'singleton',
        );
    });

    it('GET /health/agent retorna o snapshot canônico do agente', async () => {
        container.register(
            ALWAYS_ALIVE_AGENT,
            () =>
                /** @type {any} */ ({
                    status: 'idle',
                    sessionId: 'session-123',
                    dialogLoopActive: false,
                    queueSize: 0,
                    model: 'gpt-5',
                    reasoningEffort: 'high',
                    pendingQuestion: null,
                    dialogPaused: false,
                    getHealthSnapshot: () => ({
                        ok: true,
                        healthy: true,
                        status: 'healthy',
                        agentStatus: 'idle',
                        sessionId: 'session-123',
                        model: 'gpt-5',
                        reasoningEffort: 'high',
                        dialogLoopActive: false,
                        pendingQuestion: false,
                        pendingQuestionKind: null,
                        pendingQuestionShadow: false,
                        pendingQuestionShadowKind: null,
                        pendingQuestionShadowState: null,
                        pendingQuestionShadowExpired: false,
                        pendingQuestionShadowAgeMs: null,
                        pendingQuestionShadowExpiresAt: null,
                        pendingQuestionShadowRemainingMs: null,
                        queueSize: 0,
                        oldestTaskWaitMs: 0,
                        starvationAlert: false,
                        backgroundPendingCount: 0,
                        backgroundPendingLabels: [],
                        riskFlags: [],
                        recommendedAction: 'none',
                        uptime: 1234,
                        issues: [],
                        bootReport: null,
                        checks: {
                            runtime: { ok: true, status: 'idle', operational: true },
                            client: { ok: true, available: true },
                            session: { ok: true, active: true, resumed: false },
                            dialog: { ok: true, active: false, attached: true, paused: false },
                            queue: { ok: true, size: 0, oldestTaskWaitMs: 0, starvationAlert: false },
                            io: {
                                ok: true,
                                pendingQuestion: false,
                                pendingQuestionKind: null,
                                pendingQuestionShadow: false,
                                pendingQuestionShadowKind: null,
                                pendingQuestionShadowState: null,
                                pendingQuestionShadowExpired: false,
                                pendingQuestionShadowAgeMs: null,
                                pendingQuestionShadowExpiresAt: null,
                                pendingQuestionShadowRemainingMs: null,
                                waitingForInput: false,
                                keepaliveRunning: true,
                                backgroundPendingCount: 0,
                            },
                            background: { ok: true, pendingCount: 0, warnThreshold: 8, labels: [] },
                            boot: {
                                ok: true,
                                reportAvailable: false,
                                failedSteps: 0,
                                degradedSteps: 0,
                                lastCompletedAt: null,
                            },
                            quota: { ok: true, configured: true, running: true },
                        },
                        ts: Date.now(),
                    }),
                }),
            'singleton',
        );

        const app = express();
        app.use(createHealthRouter());

        const res = await request(app).get('/health/agent').expect(200);

        assert.equal(res.body.ok, true);
        assert.equal(res.body.status, 'healthy');
        assert.equal(res.body.sessionId, 'session-123');
        assert.equal(res.body.checks.client.ok, true);
    });

    it('GET /health/agent responde 503 quando o snapshot indica unhealthy', async () => {
        container.register(
            ALWAYS_ALIVE_AGENT,
            () =>
                /** @type {any} */ ({
                    status: 'stopped',
                    sessionId: null,
                    dialogLoopActive: false,
                    queueSize: 0,
                    model: 'gpt-5',
                    reasoningEffort: 'high',
                    pendingQuestion: null,
                    dialogPaused: false,
                    getHealthSnapshot: () => ({
                        ok: false,
                        healthy: false,
                        status: 'unhealthy',
                        agentStatus: 'stopped',
                        sessionId: null,
                        model: 'gpt-5',
                        reasoningEffort: 'high',
                        dialogLoopActive: false,
                        pendingQuestion: false,
                        pendingQuestionKind: null,
                        pendingQuestionShadow: false,
                        pendingQuestionShadowKind: null,
                        pendingQuestionShadowState: null,
                        pendingQuestionShadowExpired: false,
                        pendingQuestionShadowAgeMs: null,
                        pendingQuestionShadowExpiresAt: null,
                        pendingQuestionShadowRemainingMs: null,
                        queueSize: 0,
                        oldestTaskWaitMs: 0,
                        starvationAlert: false,
                        backgroundPendingCount: 0,
                        backgroundPendingLabels: [],
                        riskFlags: ['runtime.stopped', 'client.missing', 'session.missing'],
                        recommendedAction: 'restart_agent',
                        uptime: null,
                        issues: ['runtime.not_operational.stopped', 'client.unavailable', 'session.inactive'],
                        bootReport: null,
                        checks: {
                            runtime: { ok: false, status: 'stopped', operational: false },
                            client: { ok: false, available: false },
                            session: { ok: false, active: false, resumed: false },
                            dialog: { ok: true, active: false, attached: true, paused: false },
                            queue: { ok: true, size: 0, oldestTaskWaitMs: 0, starvationAlert: false },
                            io: {
                                ok: true,
                                pendingQuestion: false,
                                pendingQuestionKind: null,
                                pendingQuestionShadow: false,
                                pendingQuestionShadowKind: null,
                                pendingQuestionShadowState: null,
                                pendingQuestionShadowExpired: false,
                                pendingQuestionShadowAgeMs: null,
                                pendingQuestionShadowExpiresAt: null,
                                pendingQuestionShadowRemainingMs: null,
                                waitingForInput: false,
                                keepaliveRunning: false,
                                backgroundPendingCount: 0,
                            },
                            background: { ok: true, pendingCount: 0, warnThreshold: 8, labels: [] },
                            boot: {
                                ok: true,
                                reportAvailable: false,
                                failedSteps: 0,
                                degradedSteps: 0,
                                lastCompletedAt: null,
                            },
                            quota: { ok: false, configured: true, running: false },
                        },
                        ts: Date.now(),
                    }),
                }),
            'singleton',
        );

        const app = express();
        app.use(createHealthRouter());

        const res = await request(app).get('/health/agent').expect(503);

        assert.equal(res.body.ok, false);
        assert.equal(res.body.status, 'unhealthy');
    });

    it('GET /health do control router reutiliza getHealthSnapshot quando disponível', async () => {
        container.register(
            CONVERSATION_STORE,
            () =>
                /** @type {any} */ ({
                    db: {
                        prepare: () => ({ get: () => 1 }),
                    },
                }),
            'singleton',
        );

        const agent = /** @type {any} */ ({
            status: 'idle',
            sessionId: 'session-456',
            dialogLoopActive: true,
            queueSize: 1,
            getPermissionMode: () => 'selective',
            listenerDiagnostics: () => ({ ready: 1 }),
            getStatusSnapshot: () => ({
                status: 'idle',
                sessionId: 'session-456',
                model: 'gpt-5',
                queueSize: 1,
                pendingQuestion: null,
                isResumed: false,
                resumeCount: 0,
                sendCount: 0,
                startedAt: Date.now() - 1000,
                starvationAlert: false,
                oldestTaskWaitMs: 0,
            }),
            getHealthSnapshot: () => ({
                ok: true,
                healthy: true,
                status: 'healthy',
                agentStatus: 'idle',
                sessionId: 'session-456',
                model: 'gpt-5',
                reasoningEffort: 'medium',
                dialogLoopActive: true,
                pendingQuestion: false,
                pendingQuestionKind: null,
                pendingQuestionShadow: true,
                pendingQuestionShadowKind: 'ready',
                pendingQuestionShadowExpired: true,
                pendingQuestionShadowAgeMs: 90_000,
                pendingQuestionShadowExpiresAt: 123456789,
                queueSize: 1,
                oldestTaskWaitMs: 0,
                starvationAlert: false,
                backgroundPendingCount: 2,
                backgroundPendingLabels: ['bg.task.1'],
                riskFlags: [],
                recommendedAction: 'none',
                uptime: 1000,
                issues: [],
                bootReport: null,
                checks: {
                    runtime: { ok: true, status: 'idle', operational: true },
                    client: { ok: true, available: true },
                    session: { ok: true, active: true, resumed: false },
                    dialog: { ok: true, active: true, attached: true, paused: false },
                    queue: { ok: true, size: 1, oldestTaskWaitMs: 0, starvationAlert: false },
                    io: {
                        ok: true,
                        pendingQuestion: false,
                        pendingQuestionKind: null,
                        pendingQuestionShadow: true,
                        pendingQuestionShadowKind: 'ready',
                        pendingQuestionShadowExpired: true,
                        pendingQuestionShadowAgeMs: 90_000,
                        pendingQuestionShadowExpiresAt: 123456789,
                        waitingForInput: false,
                        keepaliveRunning: false,
                        backgroundPendingCount: 2,
                    },
                    background: { ok: true, pendingCount: 2, warnThreshold: 8, labels: ['bg.task.1'] },
                    boot: {
                        ok: true,
                        reportAvailable: false,
                        failedSteps: 0,
                        degradedSteps: 0,
                        lastCompletedAt: null,
                    },
                    quota: { ok: true, configured: true, running: true },
                },
                ts: Date.now(),
            }),
        });

        const app = express();
        const router = express.Router();
        registerControlRoutes(router, agent);
        app.use(express.json());
        app.use(router);

        const res = await request(app).get('/health').expect(200);

        assert.equal(res.body.ok, true);
        assert.equal(res.body.status, 'healthy');
        assert.equal(res.body.sessionId, 'session-456');
        assert.equal(res.body.backgroundPendingCount, 2);
        assert.equal(res.body.pendingQuestionShadow, true);
        assert.equal(res.body.pendingQuestionShadowKind, 'ready');
        assert.equal(res.body.pendingQuestionShadowExpired, true);
        assert.equal(res.body.permissionMode, 'selective');
        assert.equal(res.body.hubStore.ok, true);
    });

    it('buildLegacyAgentHealth cria fallback canônico com issues e checks expandidos', () => {
        const health = buildLegacyAgentHealth(
            /** @type {any} */ ({
                status: 'stopped',
                sessionId: null,
                dialogLoopActive: false,
                dialogPaused: false,
                queueSize: 0,
                getStatusSnapshot: () => ({
                    status: 'stopped',
                    sessionId: null,
                    model: 'gpt-5',
                    queueSize: 0,
                    pendingQuestion: null,
                    isResumed: false,
                    resumeCount: 0,
                    sendCount: 0,
                    startedAt: null,
                    starvationAlert: false,
                    oldestTaskWaitMs: 0,
                }),
            }),
        );

        assert.equal(health.ok, false);
        assert.ok(health.issues.includes('runtime.not_operational.stopped'));
        assert.equal(health.checks.runtime.ok, false);
        assert.equal(health.checks.background.warnThreshold, 8);
        assert.equal(health.pendingQuestionShadow, false);
        assert.equal(health.recommendedAction, 'restart_agent');
    });

    it('buildAgentModuleHealth projeta detalhes ricos para o registry', () => {
        const sdkResources = {
            handles: {
                client: null,
                session: null,
                serverRpc: null,
                sessionRpc: null,
                workspacePath: null,
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
                lastSessionLookupAvailable: true,
                foregroundControlAvailable: true,
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
        };

        const result = buildAgentModuleHealth(
            /** @type {any} */ ({
                getSdkResourceSnapshot: () => sdkResources,
                getHealthSnapshot: () => ({
                    ok: true,
                    healthy: true,
                    status: 'degraded',
                    agentStatus: 'processing',
                    sessionId: 'session-789',
                    model: 'gpt-5',
                    reasoningEffort: 'high',
                    dialogLoopActive: true,
                    pendingQuestion: true,
                    pendingQuestionKind: 'question',
                    pendingQuestionShadow: true,
                    pendingQuestionShadowKind: 'ready',
                    pendingQuestionShadowExpired: true,
                    pendingQuestionShadowAgeMs: 90_000,
                    pendingQuestionShadowExpiresAt: 123456789,
                    queueSize: 3,
                    oldestTaskWaitMs: 1200,
                    starvationAlert: false,
                    backgroundPendingCount: 4,
                    backgroundPendingLabels: ['bg.sync.1'],
                    riskFlags: ['io.keepalive_stopped'],
                    recommendedAction: 'restart_keepalive',
                    uptime: 999,
                    issues: ['io.keepalive_stopped'],
                    bootReport: null,
                    checks: {
                        runtime: { ok: true, status: 'processing', operational: true },
                        client: { ok: true, available: true },
                        session: { ok: true, active: true, resumed: true },
                        dialog: { ok: true, active: true, attached: true, paused: false },
                        queue: { ok: true, size: 3, oldestTaskWaitMs: 1200, starvationAlert: false },
                        io: {
                            ok: false,
                            pendingQuestion: true,
                            pendingQuestionKind: 'question',
                            pendingQuestionShadow: true,
                            pendingQuestionShadowKind: 'ready',
                            pendingQuestionShadowExpired: true,
                            pendingQuestionShadowAgeMs: 90_000,
                            pendingQuestionShadowExpiresAt: 123456789,
                            waitingForInput: false,
                            keepaliveRunning: false,
                            backgroundPendingCount: 4,
                        },
                        background: { ok: true, pendingCount: 4, warnThreshold: 8, labels: ['bg.sync.1'] },
                        boot: {
                            ok: true,
                            reportAvailable: false,
                            failedSteps: 0,
                            degradedSteps: 0,
                            lastCompletedAt: null,
                        },
                        quota: { ok: true, configured: true, running: true },
                    },
                    ts: Date.now(),
                }),
            }),
        );

        assert.equal(result.ok, true);
        assert.equal(result.details.keepaliveRunning, false);
        assert.equal(result.details.quotaMonitorRunning, true);
        assert.equal(result.details.pendingQuestionShadow, true);
        assert.equal(result.details.pendingQuestionShadowKind, 'ready');
        assert.equal(result.details.pendingQuestionShadowExpired, true);
        assert.equal(result.details.pendingQuestionShadowAgeMs, 90_000);
        assert.equal(result.details.recommendedAction, 'restart_keepalive');
        assert.deepEqual(result.details.riskFlags, ['io.keepalive_stopped']);
        assert.equal(result.details.bootDegradedSteps, 0);
        assert.equal(
            /** @type {{ allCoreResourcesAvailable?: boolean }} */ (result.details.sdkResources)
                .allCoreResourcesAvailable,
            true,
        );
        assert.deepEqual(result.details.issues, ['io.keepalive_stopped']);
    });
});
