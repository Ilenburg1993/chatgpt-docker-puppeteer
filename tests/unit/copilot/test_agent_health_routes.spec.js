// @ts-check

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { ALWAYS_ALIVE_AGENT, alwaysAliveAgent } from '#copilot/agent';
import { CONVERSATION_STORE } from '#copilot/conversation-hub';
import { container } from '#copilot/core';
import express from 'express';
import request from 'supertest';

import { buildAgentModuleHealth, buildLegacyAgentHealth } from '../../../src/copilot/server/routes/agent-health.js';
import { registerControlRoutes } from '../../../src/copilot/server/routes/copilot-api/control.js';
import { createHealthRouter } from '../../../src/copilot/server/routes/health.js';

describe('agent health routes', { concurrency: 1 }, () => {
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
                        queueSize: 0,
                        oldestTaskWaitMs: 0,
                        starvationAlert: false,
                        backgroundPendingCount: 0,
                        uptime: 1234,
                        issues: [],
                        checks: {
                            runtime: { ok: true, status: 'idle', operational: true },
                            client: { ok: true, available: true },
                            session: { ok: true, active: true, resumed: false },
                            dialog: { ok: true, active: false, attached: true, paused: false },
                            queue: { ok: true, size: 0, oldestTaskWaitMs: 0, starvationAlert: false },
                            io: {
                                ok: true,
                                pendingQuestion: false,
                                waitingForInput: false,
                                keepaliveRunning: true,
                                backgroundPendingCount: 0,
                            },
                            background: { ok: true, pendingCount: 0, warnThreshold: 8 },
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
                        queueSize: 0,
                        oldestTaskWaitMs: 0,
                        starvationAlert: false,
                        backgroundPendingCount: 0,
                        uptime: null,
                        issues: ['runtime.not_operational.stopped', 'client.unavailable', 'session.inactive'],
                        checks: {
                            runtime: { ok: false, status: 'stopped', operational: false },
                            client: { ok: false, available: false },
                            session: { ok: false, active: false, resumed: false },
                            dialog: { ok: true, active: false, attached: true, paused: false },
                            queue: { ok: true, size: 0, oldestTaskWaitMs: 0, starvationAlert: false },
                            io: {
                                ok: true,
                                pendingQuestion: false,
                                waitingForInput: false,
                                keepaliveRunning: false,
                                backgroundPendingCount: 0,
                            },
                            background: { ok: true, pendingCount: 0, warnThreshold: 8 },
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
                queueSize: 1,
                oldestTaskWaitMs: 0,
                starvationAlert: false,
                backgroundPendingCount: 2,
                uptime: 1000,
                issues: [],
                checks: {
                    runtime: { ok: true, status: 'idle', operational: true },
                    client: { ok: true, available: true },
                    session: { ok: true, active: true, resumed: false },
                    dialog: { ok: true, active: true, attached: true, paused: false },
                    queue: { ok: true, size: 1, oldestTaskWaitMs: 0, starvationAlert: false },
                    io: {
                        ok: true,
                        pendingQuestion: false,
                        waitingForInput: false,
                        keepaliveRunning: false,
                        backgroundPendingCount: 2,
                    },
                    background: { ok: true, pendingCount: 2, warnThreshold: 8 },
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
    });

    it('buildAgentModuleHealth projeta detalhes ricos para o registry', () => {
        const result = buildAgentModuleHealth(
            /** @type {any} */ ({
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
                    queueSize: 3,
                    oldestTaskWaitMs: 1200,
                    starvationAlert: false,
                    backgroundPendingCount: 4,
                    uptime: 999,
                    issues: ['io.keepalive_stopped'],
                    checks: {
                        runtime: { ok: true, status: 'processing', operational: true },
                        client: { ok: true, available: true },
                        session: { ok: true, active: true, resumed: true },
                        dialog: { ok: true, active: true, attached: true, paused: false },
                        queue: { ok: true, size: 3, oldestTaskWaitMs: 1200, starvationAlert: false },
                        io: {
                            ok: false,
                            pendingQuestion: true,
                            waitingForInput: false,
                            keepaliveRunning: false,
                            backgroundPendingCount: 4,
                        },
                        background: { ok: true, pendingCount: 4, warnThreshold: 8 },
                        quota: { ok: true, configured: true, running: true },
                    },
                    ts: Date.now(),
                }),
            }),
        );

        assert.equal(result.ok, true);
        assert.equal(result.details.keepaliveRunning, false);
        assert.equal(result.details.quotaMonitorRunning, true);
        assert.deepEqual(result.details.issues, ['io.keepalive_stopped']);
    });
});
