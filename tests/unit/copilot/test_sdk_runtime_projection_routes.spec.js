import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'vitest';

import { clearSharedSessionBinding, setSharedHubSessionId, setSharedSdkSessionId } from '#copilot/core';
import express from 'express';
import request from 'supertest';

import { buildRuntimeRouteMetaPayload } from '../../../src/copilot/presentation/runtime-meta.js';
import {
    paginateAgentRuntimeToolsProjection,
    readAgentRuntimeToolsProjection,
} from '../../../src/copilot/presentation/runtime-tools.js';
import { clearSdkRuntimeBinding, resolveSdkRuntimeProjection } from '../../../src/copilot/presentation/sdk-sessions.js';
import createAgentRouter from '../../../src/copilot/server/routes/sdk/agent.js';
import createClientRouter from '../../../src/copilot/server/routes/sdk/client.js';
import createObservabilityRouter from '../../../src/copilot/server/routes/sdk/observability.js';

/** @returns {any} */
function createMockClient() {
    return {
        getState: () => 'connected',
        getForegroundSessionId: async () => 'sdk-foreground',
        getLastSessionId: async () => 'sdk-last',
        getStatus: async () => ({ version: '1.2.3', cliPath: '/tmp/copilot-cli' }),
        getAuthStatus: async () => ({ authenticated: true }),
        ping: async () => ({ message: 'pong', timestamp: 123 }),
        listModels: async () => [],
        on: () => () => {},
    };
}

/** @returns {any} */
function createMockAgent() {
    return {
        status: 'running',
        sessionId: 'sdk-runtime',
        getToolRegistryEntriesSnapshot: () => [
            {
                name: 'read_file',
                description: 'Read a file',
                category: 'file',
                tags: ['read'],
                readOnly: true,
                skipPermission: true,
            },
            {
                name: 'write_file',
                description: 'Write a file',
                category: 'file',
                tags: ['write'],
                readOnly: false,
                skipPermission: false,
            },
            {
                name: 'shell_exec',
                description: 'Run shell',
                category: 'shell',
                tags: ['exec'],
                readOnly: false,
                skipPermission: false,
            },
        ],
    };
}

/** @returns {any} */
function createMockObservability() {
    return {
        defaultAuditLog: {
            flush: async () => {},
            getLast: () => [],
        },
        getAuditTail: () => [],
        isOtelEnabled: () => true,
        otelExporterOtlpEndpoint: 'http://otel.local',
        defaultOtelFile: '/tmp/otel.jsonl',
        getCatalog: () => ({ 'session.boot': { version: 1 } }),
        getDeadLetters: () => [],
        log: () => {},
    };
}

/**
 * @param {Record<string, unknown>} overrides
 * @returns {any}
 */
function routeDeps(overrides = {}) {
    const agent = overrides.agent ?? createMockAgent();
    return {
        sdkSystemPrompt: {
            readAgentSdkSystemPromptProjection: async () => ({
                sessionId: 'sdk-runtime',
                sessionAvailable: true,
                instructionSources: { sources: [{ type: 'system', origin: 'sdk' }] },
                instructionSourcesError: null,
                systemPrompt: {
                    effectiveMode: 'append',
                    effectiveLiveMode: 'customize',
                    liveReloadMechanism: 'sdk-transform',
                    revision: { digest: 'route-digest' },
                },
            }),
        },
        sdkSessionOwnership: {
            clearSdkRuntimeBinding,
            resolveSdkRuntimeProjection,
            resolveSdkRuntimeProjectionForRuntime: (
                /** @type {string | null | undefined} */ _runtimeId,
                /** @type {Parameters<typeof resolveSdkRuntimeProjection>[1]} */ client,
                /** @type {string | null} */ connectionState,
            ) => resolveSdkRuntimeProjection(agent, client, connectionState),
        },
        sdkRuntimeProjection: {
            buildRuntimeRouteMetaPayload,
            paginateAgentRuntimeToolsProjection,
            readAgentRuntimeToolsProjection,
            readAgentStatusSnapshotForRuntime: () => ({
                status: typeof agent.status === 'string' ? agent.status : 'stopped',
                sessionId: typeof agent.sessionId === 'string' ? agent.sessionId : null,
                runtimeId: 'default',
                requestedRuntimeId: null,
                runtimeFound: true,
                usedDefaultRuntimeFallback: false,
            }),
            readAgentRuntimeToolsProjectionForRuntime: (
                /** @type {string | null | undefined} */ runtimeId,
                /** @type {{ allTools?: unknown[]; requireRegistry?: boolean }} */ options = {},
            ) => ({
                ...readAgentRuntimeToolsProjection(agent, options),
                requestedRuntimeId: runtimeId ?? null,
                runtimeId: runtimeId ?? 'default',
                runtimeFound: true,
                usedDefaultRuntimeFallback: false,
                defaultRuntimeId: 'default',
            }),
        },
        sdkObservability: {
            log: () => {},
        },
        ...overrides,
    };
}

describe('sdk runtime projection routes', () => {
    beforeEach(() => {
        clearSharedSessionBinding();
        setSharedHubSessionId('hub-shared');
        setSharedSdkSessionId('sdk-shared');
    });

    afterEach(() => {
        clearSharedSessionBinding();
    });

    it('GET /status retorna projection canônica de binding e canonical session', async () => {
        const app = express();
        app.use(
            createClientRouter(
                routeDeps({
                    agent: createMockAgent(),
                    getClient: async () => createMockClient(),
                    getClientState: () => 'connected',
                    stopClient: async () => [],
                    forceStopClient: async () => {},
                    allTools: [],
                }),
            ),
        );

        const res = await request(app).get('/status').expect(200);

        assert.equal(res.body.connectionState, 'connected');
        assert.equal(res.body.runtimeSessionId, 'sdk-runtime');
        assert.equal(res.body.foregroundSessionId, 'sdk-foreground');
        assert.equal(res.body.lastSessionId, 'sdk-last');
        assert.equal(res.body.canonicalSessionId, 'sdk-shared');
        assert.equal(res.body.runtimeMatchesShared, false);
        assert.deepEqual(res.body.sharedBinding, {
            hubSessionId: 'hub-shared',
            sdkSessionId: 'sdk-shared',
            isBound: true,
        });
    });

    it('rotas client globais propagam fallback explícito de runtime', async () => {
        const app = express();
        app.use(
            createClientRouter(
                routeDeps({
                    agent: createMockAgent(),
                    getClient: async () => createMockClient(),
                    getClientState: () => 'connected',
                    stopClient: async () => [],
                    forceStopClient: async () => {},
                    allTools: [],
                    runtimeId: 'default',
                    requestedRuntimeId: 'missing-runtime',
                    runtimeFound: false,
                    usedDefaultRuntimeFallback: true,
                }),
            ),
        );

        const res = await request(app).get('/models').expect(200);

        assert.equal(res.body.runtimeId, 'default');
        assert.equal(res.body.requestedRuntimeId, 'missing-runtime');
        assert.equal(res.body.runtimeFound, false);
        assert.equal(res.body.usedDefaultRuntimeFallback, true);
    });

    it('POST /client/stop limpa o sdk binding preservando hubSessionId', async () => {
        const app = express();
        app.use(
            createClientRouter(
                routeDeps({
                    agent: createMockAgent(),
                    getClient: async () => createMockClient(),
                    getClientState: () => 'connected',
                    stopClient: async () => [],
                    forceStopClient: async () => {},
                    allTools: [],
                }),
            ),
        );

        const res = await request(app).post('/client/stop').expect(200);

        assert.deepEqual(res.body.sharedBinding, {
            hubSessionId: 'hub-shared',
            sdkSessionId: null,
            isBound: false,
        });
    });

    it('POST /client/force-stop usa a superfície canônica e limpa o binding', async () => {
        /** @type {{ called: number }} */
        const forceStop = { called: 0 };

        const app = express();
        app.use(
            createClientRouter(
                routeDeps({
                    agent: createMockAgent(),
                    getClient: async () => ({
                        ...createMockClient(),
                        forceStop: async () => {
                            throw new Error('should-not-be-called');
                        },
                    }),
                    getClientState: () => 'connected',
                    stopClient: async () => [],
                    forceStopClient: async () => {
                        forceStop.called += 1;
                    },
                    allTools: [],
                }),
            ),
        );

        const res = await request(app).post('/client/force-stop').expect(200);

        assert.equal(forceStop.called, 1);
        assert.deepEqual(res.body.sharedBinding, {
            hubSessionId: 'hub-shared',
            sdkSessionId: null,
            isBound: false,
        });
    });

    it('GET /agent/info expõe a mesma projection canônica de runtime', async () => {
        const app = express();
        app.use(
            createAgentRouter(
                routeDeps({
                    agent: createMockAgent(),
                    metrics: /** @type {any} */ ({ getSummary: () => ({}) }),
                    getClient: async () => createMockClient(),
                }),
            ),
        );

        const res = await request(app).get('/agent/info').expect(200);

        assert.equal(res.body.sessionId, 'sdk-runtime');
        assert.equal(res.body.runtimeSessionId, 'sdk-runtime');
        assert.equal(res.body.canonicalSessionId, 'sdk-shared');
        assert.deepEqual(res.body.sharedBinding, {
            hubSessionId: 'hub-shared',
            sdkSessionId: 'sdk-shared',
            isBound: true,
        });
    });

    it('GET /agent/system-prompt expõe status do prompt e instruction sources da sessão ativa', async () => {
        const app = express();
        app.use(
            createAgentRouter(
                routeDeps({
                    agent: createMockAgent(),
                    metrics: /** @type {any} */ ({ getSummary: () => ({}) }),
                    getClient: async () => createMockClient(),
                }),
            ),
        );

        const res = await request(app).get('/agent/system-prompt').expect(200);

        assert.equal(res.body.sessionId, 'sdk-runtime');
        assert.equal(res.body.systemPrompt.effectiveMode, 'append');
        assert.equal(res.body.systemPrompt.effectiveLiveMode, 'customize');
        assert.equal(res.body.systemPrompt.revision.digest, 'route-digest');
        assert.deepEqual(res.body.instructionSources, { sources: [{ type: 'system', origin: 'sdk' }] });
    });

    it('GET /agent/state expõe state + binding canônico na mesma resposta', async () => {
        const app = express();
        app.use(
            createAgentRouter(
                routeDeps({
                    agent: createMockAgent(),
                    metrics: /** @type {any} */ ({ getSummary: () => ({}) }),
                    getClient: async () => createMockClient(),
                }),
            ),
        );

        const res = await request(app).get('/agent/state').expect(200);

        assert.equal(res.body.state, 'connected');
        assert.equal(res.body.canonicalSessionId, 'sdk-shared');
        assert.equal(res.body.runtimeSessionId, 'sdk-runtime');
        assert.deepEqual(res.body.sharedBinding, {
            hubSessionId: 'hub-shared',
            sdkSessionId: 'sdk-shared',
            isBound: true,
        });
    });

    it('GET /tools usa a projeção semântica de tools do agent', async () => {
        const app = express();
        app.use(
            createClientRouter(
                routeDeps({
                    agent: createMockAgent(),
                    getClient: async () => createMockClient(),
                    getClientState: () => 'connected',
                    stopClient: async () => [],
                    forceStopClient: async () => {},
                    allTools: [{ name: 'static_tool' }],
                }),
            ),
        );

        const res = await request(app).get('/tools').expect(200);

        assert.equal(res.body.source, 'registry');
        assert.equal(res.body.count, 3);
        assert.deepEqual(
            res.body.tools.map((/** @type {{ name: string }} */ tool) => tool.name),
            ['read_file', 'write_file', 'shell_exec'],
        );
    });

    it('GET /tools usa fallback estático quando o registry runtime não está disponível', async () => {
        const app = express();
        app.use(
            createClientRouter(
                routeDeps({
                    agent: { status: 'stopped', sessionId: null, toolsRegistry: null },
                    getClient: async () => createMockClient(),
                    getClientState: () => 'connected',
                    stopClient: async () => [],
                    forceStopClient: async () => {},
                    allTools: [{ name: 'static_tool', description: 'Static', skipPermission: true }],
                }),
            ),
        );

        const res = await request(app).get('/tools').expect(200);

        assert.equal(res.body.source, 'static');
        assert.equal(res.body.count, 1);
        assert.equal(res.body.tools[0].name, 'static_tool');
        assert.equal(res.body.tools[0].skipPermission, true);
    });

    it('GET /agent/tools filtra e pagina a projeção semanticamente governada pelo agent', async () => {
        const app = express();
        app.use(
            createAgentRouter(
                routeDeps({
                    agent: createMockAgent(),
                    metrics: /** @type {any} */ ({ getSummary: () => ({}) }),
                    getClient: async () => createMockClient(),
                }),
            ),
        );

        const res = await request(app).get('/agent/tools?category=file&page=1&limit=1').expect(200);

        assert.equal(res.body.source, 'registry');
        assert.equal(res.body.total, 2);
        assert.equal(res.body.count, 1);
        assert.equal(res.body.pages, 2);
        assert.deepEqual(res.body.tools[0], {
            name: 'read_file',
            description: 'Read a file',
            category: 'file',
            tags: ['read'],
            readOnly: true,
            skipPermission: true,
            hasParameters: false,
        });
    });

    it('rotas observability remanescentes propagam metadata runtime canônica', async () => {
        const app = express();
        app.use(express.json());
        app.use(
            createObservabilityRouter(
                routeDeps({
                    sdkObservability: createMockObservability(),
                    runtimeId: 'default',
                    requestedRuntimeId: 'audit',
                    runtimeFound: false,
                    usedDefaultRuntimeFallback: true,
                }),
            ),
        );

        const requests = [
            request(app).post('/observability/log-level').send({ level: 'TRACE' }).expect(400),
            request(app).post('/observability/audit/flush').send({}).expect(200),
            request(app).get('/observability/audit-tail').expect(200),
            request(app).get('/observability/otel-status').expect(200),
            request(app).get('/observability/events/catalog').expect(200),
            request(app).get('/observability/events/dead-letter').expect(200),
        ];

        const responses = await Promise.all(requests);
        for (const res of responses) {
            assert.equal(res.body.runtimeId, 'default');
            assert.equal(res.body.requestedRuntimeId, 'audit');
            assert.equal(res.body.runtimeFound, false);
            assert.equal(res.body.usedDefaultRuntimeFallback, true);
        }
    });
});
