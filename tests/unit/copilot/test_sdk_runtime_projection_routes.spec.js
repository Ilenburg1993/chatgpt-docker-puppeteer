import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'vitest';

import { clearSharedSessionBinding, setSharedHubSessionId, setSharedSdkSessionId } from '#copilot/core';
import express from 'express';
import request from 'supertest';

import {
    paginateAgentRuntimeToolsProjection,
    readAgentRuntimeToolsProjection,
} from '../../../src/copilot/presentation/runtime-tools.js';
import { clearSdkRuntimeBinding, resolveSdkRuntimeProjection } from '../../../src/copilot/presentation/sdk-sessions.js';
import createAgentRouter from '../../../src/copilot/server/routes/sdk/agent.js';
import createClientRouter from '../../../src/copilot/server/routes/sdk/client.js';

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

/**
 * @param {Record<string, unknown>} overrides
 * @returns {any}
 */
function routeDeps(overrides = {}) {
    return {
        sdkSessionOwnership: {
            clearSdkRuntimeBinding,
            resolveSdkRuntimeProjection,
        },
        sdkRuntimeProjection: {
            paginateAgentRuntimeToolsProjection,
            readAgentRuntimeToolsProjection,
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
            res.body.tools.map((tool) => tool.name),
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
        });
    });
});
