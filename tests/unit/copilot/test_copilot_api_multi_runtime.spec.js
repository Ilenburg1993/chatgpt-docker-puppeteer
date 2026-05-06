// @ts-check

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import { afterEach, beforeEach, describe, it } from 'vitest';

import { alwaysAliveAgent, clearAgentRuntimeRegistry, registerAgentRuntime } from '#copilot/agent';
import express from 'express';
import supertest from 'supertest';

import { createCopilotApiRouter } from '../../../src/copilot/server/routes/copilot-api/index.js';

/**
 * @param {string} sessionId
 * @param {string} model
 * @returns {any}
 */
function createRuntime(sessionId, model) {
    return {
        status: 'idle',
        sessionId,
        dialogLoopActive: true,
        dialogPaused: false,
        getPermissionMode: () => 'approve_all',
        getStatusSnapshot: () => ({
            status: 'idle',
            sessionId,
            model,
            permissionMode: 'approve_all',
            isResumed: true,
            resumeCount: 1,
            sendCount: 2,
            startedAt: 123,
            queueSize: 0,
            oldestTaskWaitMs: 0,
            starvationAlert: false,
        }),
        getHealthSnapshot: () => ({
            ok: true,
            healthy: true,
            status: 'healthy',
            agentStatus: 'idle',
            sessionId,
            model,
            reasoningEffort: 'medium',
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
            startReport: null,
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
        getToolRegistryEntriesSnapshot: () => [],
        listWebhooks: () => [],
        getHandoffManager: () => ({}),
        sendDialogTurn: async (/** @type {string} */ message) => `${sessionId}:${message}`,
    };
}

/**
 * @param {string} sessionId
 * @param {string} model
 * @returns {any}
 */
function createEmitterRuntime(sessionId, model) {
    const base = createRuntime(sessionId, model);
    const emitter = new EventEmitter();
    return Object.assign(emitter, base);
}

/**
 * @template T
 * @returns {{ promise: Promise<T>; resolve: (value: T) => void; reject: (reason?: unknown) => void }}
 */
function deferred() {
    /** @type {(value: T) => void} */
    let resolve = () => {};
    /** @type {(reason?: unknown) => void} */
    let reject = () => {};
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

/**
 * @param {string} baseUrl
 * @param {string} runtimeId
 * @param {(signal: AbortSignal) => void} onConnected
 * @returns {Promise<Record<string, unknown>>}
 */
async function waitStatusEvent(baseUrl, runtimeId, onConnected) {
    const controller = new AbortController();
    const response = await fetch(`${baseUrl}/stream?runtimeId=${encodeURIComponent(runtimeId)}`, {
        headers: { Accept: 'text/event-stream' },
        signal: controller.signal,
    });
    assert.equal(response.status, 200);
    assert.ok(response.body);

    const decoder = new TextDecoder();
    const reader = response.body.getReader();
    let buf = '';
    let connected = false;

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });

            const chunks = buf.split('\n\n');
            buf = chunks.pop() ?? '';

            for (const chunk of chunks) {
                const lines = chunk
                    .split('\n')
                    .map((line) => line.trimEnd())
                    .filter(Boolean);
                const evt =
                    lines
                        .find((line) => line.startsWith('event:'))
                        ?.slice(6)
                        .trim() ?? 'message';
                const dataLine =
                    lines
                        .find((line) => line.startsWith('data:'))
                        ?.slice(5)
                        .trim() ?? '{}';
                /** @type {Record<string, unknown>} */
                const data = JSON.parse(dataLine);
                if (evt === 'connected' && !connected) {
                    connected = true;
                    onConnected(controller.signal);
                }
                if (evt === 'status') {
                    controller.abort();
                    return data;
                }
            }
        }
    } finally {
        controller.abort();
    }

    throw new Error(`Status event não recebido para runtime '${runtimeId}'.`);
}

describe('copilot-api multi-runtime propagation', () => {
    beforeEach(() => {
        clearAgentRuntimeRegistry();
    });

    afterEach(() => {
        clearAgentRuntimeRegistry();
        registerAgentRuntime(alwaysAliveAgent);
    });

    it('status/session/capabilities selecionam runtime explícito e fazem fallback declarativo', async () => {
        registerAgentRuntime(createRuntime('default-session', 'gpt-5-mini'), 'default');
        registerAgentRuntime(createRuntime('audit-session', 'gpt-5'), 'audit');

        const app = express();
        app.use(createCopilotApiRouter());
        const http = /** @type {any} */ (supertest(app));

        const status = await http.get('/status?runtimeId=audit').expect(200);
        assert.equal(status.body.runtimeId, 'audit');
        assert.equal(status.body.requestedRuntimeId, 'audit');
        assert.equal(status.body.runtimeFound, true);
        assert.equal(status.body.sessionId, 'audit-session');
        assert.equal(status.body.model, 'gpt-5');

        const session = await http.get('/session?runtimeId=audit').expect(200);
        assert.equal(session.body.runtimeId, 'audit');
        assert.equal(session.body.sessionId, 'audit-session');

        const capabilities = await http.get('/capabilities?runtimeId=audit').expect(200);
        assert.equal(capabilities.body.runtimeId, 'audit');
        assert.equal(capabilities.body.capabilities['sdk.session'].details.sessionId, 'audit-session');

        const fallback = await http.get('/status?runtimeId=missing').expect(200);
        assert.equal(fallback.body.runtimeId, 'default');
        assert.equal(fallback.body.requestedRuntimeId, 'missing');
        assert.equal(fallback.body.runtimeFound, false);
        assert.equal(fallback.body.usedDefaultRuntimeFallback, true);
        assert.equal(fallback.body.sessionId, 'default-session');
    });

    it('dialog/turn bloqueia concorrência por runtime sem serializar runtimes independentes', async () => {
        const defaultRuntime = createRuntime('default-session', 'gpt-5-mini');
        const auditRuntime = createRuntime('audit-session', 'gpt-5');
        const defaultReply = deferred();
        const defaultStarted = deferred();

        defaultRuntime.sendDialogTurn = async () => {
            defaultStarted.resolve(undefined);
            return defaultReply.promise;
        };
        auditRuntime.sendDialogTurn = async (/** @type {string} */ message) => `audit:${message}`;

        registerAgentRuntime(defaultRuntime, 'default');
        registerAgentRuntime(auditRuntime, 'audit');

        const app = express();
        app.use(express.json());
        app.use(createCopilotApiRouter());
        const http = /** @type {any} */ (supertest(app));

        const firstDefaultTurn = (async () => http.post('/dialog/turn?runtimeId=default').send({ message: 'um' }))();
        await defaultStarted.promise;

        const busyDefault = await http.post('/dialog/turn?runtimeId=default').send({ message: 'dois' }).expect(429);
        assert.equal(busyDefault.body.runtimeId, 'default');

        const auditTurn = await http.post('/dialog/turn?runtimeId=audit').send({ message: 'livre' }).expect(200);
        assert.equal(auditTurn.body.runtimeId, 'audit');
        assert.equal(auditTurn.body.reply, 'audit:livre');

        defaultReply.resolve('default:um');
        const firstDefault = await firstDefaultTurn;
        assert.equal(firstDefault.status, 200);
        assert.equal(firstDefault.body.runtimeId, 'default');
        assert.equal(firstDefault.body.reply, 'default:um');
    });

    it('stream entrega eventos isolados por runtimeId', async () => {
        const defaultRuntime = createEmitterRuntime('default-session', 'gpt-5-mini');
        const auditRuntime = createEmitterRuntime('audit-session', 'gpt-5');

        registerAgentRuntime(defaultRuntime, 'default');
        registerAgentRuntime(auditRuntime, 'audit');

        const app = express();
        app.use(createCopilotApiRouter());
        const server = createServer(app);

        await new Promise((resolve) => server.listen(0, () => resolve(undefined)));
        try {
            const address = server.address();
            assert.ok(address && typeof address === 'object' && 'port' in address);
            const baseUrl = `http://127.0.0.1:${address.port}`;

            const defaultConnected = deferred();
            const auditConnected = deferred();

            const defaultEventPromise = waitStatusEvent(baseUrl, 'default', () => defaultConnected.resolve(undefined));
            const auditEventPromise = waitStatusEvent(baseUrl, 'audit', () => auditConnected.resolve(undefined));

            await Promise.all([defaultConnected.promise, auditConnected.promise]);

            defaultRuntime.emit('status', {});
            auditRuntime.emit('status', {});

            const [defaultEvent, auditEvent] = await Promise.all([defaultEventPromise, auditEventPromise]);
            assert.equal(defaultEvent.runtimeId, 'default');
            assert.equal(defaultEvent.sourceRuntime, 'default');
            assert.equal(auditEvent.runtimeId, 'audit');
            assert.equal(auditEvent.sourceRuntime, 'audit');
        } finally {
            await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve(undefined))));
        }
    });
});
