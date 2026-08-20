// @ts-check

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'vitest';

import { alwaysAliveAgent } from '#copilot/agent/always-alive';
import { ALWAYS_ALIVE_AGENT } from '#copilot/agent/di-tokens';
import { clearAgentRuntimeRegistry, registerAgentRuntime } from '#copilot/agent/runtime-registry';
import { CONVERSATION_STORE } from '#copilot/conversation-hub';
import { container } from '#copilot/core';
import express from 'express';
import supertest from 'supertest';

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
        clearAgentRuntimeRegistry();
        hadAgent = container.has(ALWAYS_ALIVE_AGENT);
        hadConversationStore = container.has(CONVERSATION_STORE);
        previousAgent = hadAgent ? container.resolve(ALWAYS_ALIVE_AGENT) : undefined;
        previousConversationStore = hadConversationStore ? container.resolve(CONVERSATION_STORE) : undefined;
    });

    afterEach(() => {
        clearAgentRuntimeRegistry();
        registerAgentRuntime(/** @type {any} */ (hadAgent ? previousAgent : alwaysAliveAgent));
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
        const agent = /** @type {any} */ ({
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
        });
        container.register(ALWAYS_ALIVE_AGENT, () => agent, 'singleton');
        registerAgentRuntime(agent);

        const app = express();
        app.use(createHealthRouter());

        const res = await supertest(app).get('/health/agent').expect(200);

        assert.equal(res.body.ok, true);
        assert.equal(res.body.status, 'healthy');
        assert.equal(res.body.sessionId, 'session-123');
        assert.equal(res.body.checks.client.ok, true);
    });

    it('GET /health/agent aceita runtimeId explícito via query string', async () => {
        const defaultAgent = /** @type {any} */ ({
            status: 'idle',
            sessionId: 'default-session',
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
                sessionId: 'default-session',
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
                uptime: 100,
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
                    boot: { ok: true, reportAvailable: false, failedSteps: 0, degradedSteps: 0, lastCompletedAt: null },
                    quota: { ok: true, configured: true, running: true },
                },
                ts: Date.now(),
            }),
        });
        const altAgent = /** @type {any} */ ({
            ...defaultAgent,
            sessionId: 'alt-session',
            getHealthSnapshot: () => ({
                ...defaultAgent.getHealthSnapshot(),
                sessionId: 'alt-session',
            }),
        });

        container.register(ALWAYS_ALIVE_AGENT, () => defaultAgent, 'singleton');
        registerAgentRuntime(defaultAgent, 'default');
        registerAgentRuntime(altAgent, 'alt');

        const app = express();
        app.use(createHealthRouter());

        const res = await supertest(app).get('/health/agent?runtimeId=alt').expect(200);

        assert.equal(res.body.runtimeId, 'alt');
        assert.equal(res.body.requestedRuntimeId, 'alt');
        assert.equal(res.body.runtimeFound, true);
        assert.equal(res.body.usedDefaultRuntimeFallback, false);
        assert.equal(res.body.sessionId, 'alt-session');
    });

    it('GET /health/agent explicita fallback quando o runtime pedido não existe', async () => {
        const defaultAgent = /** @type {any} */ ({
            status: 'idle',
            sessionId: 'default-session',
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
                sessionId: 'default-session',
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
                uptime: 100,
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
                    boot: { ok: true, reportAvailable: false, failedSteps: 0, degradedSteps: 0, lastCompletedAt: null },
                    quota: { ok: true, configured: true, running: true },
                },
                ts: Date.now(),
            }),
        });

        container.register(ALWAYS_ALIVE_AGENT, () => defaultAgent, 'singleton');
        registerAgentRuntime(defaultAgent, 'default');

        const app = express();
        app.use(createHealthRouter());

        const res = await supertest(app).get('/health/agent?runtimeId=missing').expect(200);

        assert.equal(res.body.runtimeId, 'default');
        assert.equal(res.body.requestedRuntimeId, 'missing');
        assert.equal(res.body.runtimeFound, false);
        assert.equal(res.body.usedDefaultRuntimeFallback, true);
        assert.equal(res.body.sessionId, 'default-session');
    });

    it('GET /health/agent responde 503 quando o snapshot indica unhealthy', async () => {
        const agent = /** @type {any} */ ({
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
        });
        container.register(ALWAYS_ALIVE_AGENT, () => agent, 'singleton');
        registerAgentRuntime(agent);

        const app = express();
        app.use(createHealthRouter());

        const res = await supertest(app).get('/health/agent').expect(503);

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

        const res = await supertest(app).get('/health').expect(200);

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

    it('GET /status e /session expõem metadata de fallback quando o runtime pedido não existe', async () => {
        const defaultAgent = /** @type {any} */ ({
            status: 'idle',
            sessionId: 'default-session',
            dialogLoopActive: false,
            getStatusSnapshot: () => ({
                status: 'idle',
                sessionId: 'default-session',
                model: 'gpt-5',
                isResumed: false,
                resumeCount: 0,
                sendCount: 3,
                startedAt: 123,
            }),
        });

        const app = express();
        const router = express.Router();
        registerControlRoutes(router, () => ({
            agent: defaultAgent,
            runtimeId: 'default',
            requestedRuntimeId: 'missing',
            runtimeFound: false,
            usedDefaultRuntimeFallback: true,
        }));
        app.use(express.json());
        app.use(router);

        const statusRes = await supertest(app).get('/status').expect(200);
        const sessionRes = await supertest(app).get('/session').expect(200);

        assert.equal(statusRes.body.runtimeId, 'default');
        assert.equal(statusRes.body.requestedRuntimeId, 'missing');
        assert.equal(statusRes.body.runtimeFound, false);
        assert.equal(statusRes.body.usedDefaultRuntimeFallback, true);

        assert.equal(sessionRes.body.runtimeId, 'default');
        assert.equal(sessionRes.body.requestedRuntimeId, 'missing');
        assert.equal(sessionRes.body.runtimeFound, false);
        assert.equal(sessionRes.body.usedDefaultRuntimeFallback, true);
        assert.equal(sessionRes.body.sessionId, 'default-session');
    });

    it('GET /capabilities expõe capability map canônico com metadata de runtime', async () => {
        const agent = /** @type {any} */ ({
            status: 'idle',
            sessionId: 'cap-session',
            dialogLoopActive: true,
            dialogPaused: false,
            startDialogLoop: async () => {},
            getPermissionMode: () => 'selective',
            getPermissionCapabilitySnapshot: () => ({
                mode: 'selective',
                handlerAvailable: true,
                provider: 'agent/ports/permission-port',
                factory: 'test.createPermissions',
                sdkFirst: true,
                stableHandler: true,
                runtimeAuthority: 'agent',
            }),
            getContextFactoryCapabilitiesSnapshot: () => ({
                'runtime.queue': {
                    provider: 'agent/infra/message-queue',
                    factory: 'test.createMessageQueue',
                    runtimeAuthority: 'agent',
                },
                'dialog.loop': {
                    provider: 'agent/dialog/loop-manager',
                    factory: 'test.createDialogLoop',
                    runtimeAuthority: 'agent',
                },
                'tools.registry': {
                    provider: 'sdk/tools-registry',
                    factory: 'test.createToolsRegistry',
                    sdkFirst: true,
                    runtimeAuthority: 'agent',
                },
                'integration.webhooks': {
                    provider: 'infra/webhooks',
                    factory: 'test.createWebhooks',
                    runtimeAuthority: 'agent',
                },
                'integration.handoff': {
                    provider: 'agent/infra/handoff-manager',
                    factory: 'test.createHandoff',
                    runtimeAuthority: 'agent',
                },
            }),
            listWebhooks: () => [{ url: 'https://example.test/hook' }],
            getHandoffManager: () => ({}),
            getToolRegistryEntriesSnapshot: () => [
                {
                    name: 'read_file',
                    description: 'Read a file',
                    category: 'file',
                    tags: ['read'],
                    readOnly: true,
                    skipPermission: true,
                },
            ],
            getStatusSnapshot: () => ({
                status: 'idle',
                sessionId: 'cap-session',
                model: 'gpt-5',
                permissionMode: 'selective',
                isResumed: true,
                resumeCount: 2,
                queueSize: 0,
                oldestTaskWaitMs: 0,
                starvationAlert: false,
                startedAt: 123,
            }),
            getSdkResourceSnapshot: () => ({
                resources: {
                    clientAvailable: true,
                    sessionAvailable: true,
                    toolRegistryAvailable: true,
                },
                missingResources: [],
                allCoreResourcesAvailable: true,
                allRuntimeResourcesAvailable: true,
            }),
            getHealthSnapshot: () => ({
                ok: true,
                healthy: true,
                status: 'healthy',
                agentStatus: 'idle',
                sessionId: 'cap-session',
                model: 'gpt-5',
                reasoningEffort: 'high',
                dialogLoopActive: true,
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
                uptime: 100,
                issues: [],
                bootReport: null,
                sdkResources: null,
                checks: {
                    runtime: { ok: true, status: 'idle', operational: true },
                    client: { ok: true, available: true },
                    session: { ok: true, active: true, resumed: true },
                    dialog: { ok: true, active: true, attached: true, paused: false },
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
                    sdkResources: {
                        ok: true,
                        available: true,
                        allCoreResourcesAvailable: true,
                        allRuntimeResourcesAvailable: true,
                        missingResources: [],
                    },
                    boot: {
                        ok: true,
                        reportAvailable: true,
                        failedSteps: 0,
                        degradedSteps: 0,
                        lastCompletedAt: 456,
                    },
                    quota: { ok: true, configured: true, running: true },
                },
                ts: Date.now(),
            }),
        });

        const app = express();
        const router = express.Router();
        registerControlRoutes(router, () => ({
            agent,
            runtimeId: 'default',
            requestedRuntimeId: 'default',
            runtimeFound: true,
            usedDefaultRuntimeFallback: false,
        }));
        app.use(express.json());
        app.use(router);

        const res = await supertest(app).get('/capabilities').expect(200);

        assert.equal(res.body.ok, true);
        assert.equal(res.body.runtimeId, 'default');
        assert.equal(res.body.capabilities['runtime.lifecycle'].state, 'ready');
        assert.equal(res.body.capabilities['sdk.session'].details.sessionId, 'cap-session');
        assert.equal(res.body.capabilities['governance.permissions'].details.mode, 'selective');
        assert.equal(res.body.capabilities['governance.permissions'].details.handlerAvailable, true);
        assert.equal(res.body.capabilities['governance.permissions'].details.sdkFirst, true);
        assert.equal(res.body.capabilities['governance.permissions'].details.runtimeAuthority, 'agent');
        assert.equal(res.body.capabilities['tools.registry'].details.count, 1);
        assert.equal(res.body.capabilities['tools.registry'].details.factory, 'test.createToolsRegistry');
        assert.equal(res.body.capabilities['tools.registry'].details.sdkFirst, true);
        assert.equal(res.body.capabilities['runtime.queue'].details.provider, 'agent/infra/message-queue');
        assert.equal(res.body.capabilities['dialog.loop'].details.factory, 'test.createDialogLoop');
        assert.equal(res.body.capabilities['integration.webhooks'].details.registered, 1);
        assert.equal(res.body.capabilities['integration.webhooks'].details.factory, 'test.createWebhooks');
        assert.ok(res.body.readyCount > 0);
        assert.equal(res.body.capabilityCount, res.body.list.length);
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
        assert.equal(result.details['keepaliveRunning'], false);
        assert.equal(result.details['quotaMonitorRunning'], true);
        assert.equal(result.details['pendingQuestionShadow'], true);
        assert.equal(result.details['pendingQuestionShadowKind'], 'ready');
        assert.equal(result.details['pendingQuestionShadowExpired'], true);
        assert.equal(result.details['pendingQuestionShadowAgeMs'], 90_000);
        assert.equal(result.details['recommendedAction'], 'restart_keepalive');
        assert.deepEqual(result.details['riskFlags'], ['io.keepalive_stopped']);
        assert.equal(result.details['bootDegradedSteps'], 0);
        assert.equal(
            /** @type {{ allCoreResourcesAvailable?: boolean }} */ (result.details['sdkResources'])
                .allCoreResourcesAvailable,
            true,
        );
        assert.deepEqual(result.details['issues'], ['io.keepalive_stopped']);
    });
});
