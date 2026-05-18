import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, vi } from 'vitest';

import { CONVERSATION_STORE } from '#copilot/conversation-hub';
import {
    clearSharedSessionBinding,
    container,
    getSharedSdkSessionId,
    setSharedHubSessionId,
    setSharedSdkSessionId,
} from '#copilot/core';
import { _injectClientForTest, _resetClientState } from '#copilot/sdk';
import express from 'express';
import request from 'supertest';

import { registerActiveSdkSession } from '../../../src/copilot/sdk/session/session-registry.js';
import sessionsRouter from '../../../src/copilot/server/routes/sdk/sessions.js';

/**
 * @param {string} sessionId
 * @returns {any}
 */
function makeSession(sessionId) {
    return {
        sessionId,
        workspacePath: `/tmp/${sessionId}`,
        capabilities: { ui: { elicitation: true } },
        disconnect: async () => {},
        setModel: async () => {},
        abort: async () => {},
        log: async () => {},
        getMessages: async () => [],
        send: async () => `${sessionId}-msg`,
        sendAndWait: async () => ({ data: { content: 'ok', messageId: `${sessionId}-reply` } }),
        ui: {
            elicitation: async (/** @type {{ message: string; requestedSchema: object }} */ params) => ({
                action: 'accept',
                content: { answer: params.message },
            }),
            confirm: async () => true,
            select: async (/** @type {string} */ _message, /** @type {string[]} */ options) => options[0] ?? null,
            input: async (/** @type {string} */ message) => `${message}:typed`,
        },
        rpc: {
            model: {
                getCurrent: async () => ({ modelId: 'gpt-4.1' }),
                switchTo: async () => ({ ok: true }),
            },
            ui: {
                elicitation: async (/** @type {{ message: string; requestedSchema: object }} */ params) => ({
                    action: 'accept',
                    content: { answer: params.message },
                }),
            },
        },
        on: () => () => {},
    };
}

/**
 * @returns {import('express').Express}
 */
function createApp() {
    const app = express();
    app.use(express.json());
    app.use('/', sessionsRouter);
    return app;
}

describe('sdk routes session ownership SSOT', () => {
    /** @type {unknown} */
    let previousConversationStore;

    /** @type {boolean} */
    let hadConversationStore = false;

    /** @type {string | null} */
    let foregroundSessionId = null;

    /** @type {string | null} */
    let lastSessionId = null;

    /** @type {ReturnType<typeof vi.fn>} */
    let listSessionsSpy;

    /** @type {ReturnType<typeof vi.fn>} */
    let getSessionMetadataSpy;

    /** @type {any[]} */
    let persistedBindings;
    /** @type {any[]} */
    let createdConfigs;
    /** @type {any[]} */
    let resumedConfigs;

    beforeEach(() => {
        hadConversationStore = container.has(CONVERSATION_STORE);
        previousConversationStore = hadConversationStore ? container.resolve(CONVERSATION_STORE) : undefined;
        foregroundSessionId = null;
        lastSessionId = null;
        listSessionsSpy = vi.fn(async () => []);
        getSessionMetadataSpy = vi.fn(async () => undefined);
        persistedBindings = [];
        createdConfigs = [];
        resumedConfigs = [];
        clearSharedSessionBinding();

        container.register(
            CONVERSATION_STORE,
            () =>
                /** @type {any} */ ({
                    updateSdkSession(/** @type {string} */ hubSessionId, /** @type {string} */ sdkSessionId) {
                        persistedBindings.push({ hubSessionId, sdkSessionId });
                    },
                    createHubSession: () => 'hub-test',
                    getHubSession: () => null,
                    closeHubSession: () => {},
                }),
            'singleton',
        );

        _resetClientState();
        _injectClientForTest(
            /** @type {any} */ ({
                getState: () => 'connected',
                getForegroundSessionId: async () => foregroundSessionId,
                getLastSessionId: async () => lastSessionId,
                setForegroundSessionId: async (/** @type {string} */ id) => {
                    foregroundSessionId = id;
                    lastSessionId = id;
                },
                getSessionMetadata: getSessionMetadataSpy,
                listSessions: listSessionsSpy,
                createSession: async (/** @type {{ sessionId?: string }} */ config) => {
                    createdConfigs.push(config);
                    const session = makeSession(config.sessionId ?? 'sdk-created');
                    lastSessionId = session.sessionId;
                    return session;
                },
                resumeSession: async (/** @type {string} */ id, /** @type {unknown} */ config) => {
                    resumedConfigs.push(config);
                    const session = makeSession(id);
                    lastSessionId = session.sessionId;
                    return session;
                },
                deleteSession: async () => {},
            }),
        );
    });

    afterEach(() => {
        clearSharedSessionBinding();
        _resetClientState();
        container.register(
            CONVERSATION_STORE,
            () =>
                hadConversationStore
                    ? previousConversationStore
                    : {
                          createHubSession: () => 'fallback',
                          getHubSession: () => null,
                          closeHubSession: () => {},
                      },
            'singleton',
        );
    });

    it('GET /sessions/binding prioriza a SSOT compartilhada sobre foreground/last', async () => {
        setSharedHubSessionId('hub-shared');
        setSharedSdkSessionId('sdk-shared');
        foregroundSessionId = 'sdk-foreground';
        lastSessionId = 'sdk-last';

        const res = await request(createApp()).get('/sessions/binding').expect(200);

        assert.equal(res.body.canonicalSessionId, 'sdk-shared');
        assert.equal(res.body.foregroundSessionId, 'sdk-foreground');
        assert.equal(res.body.lastSessionId, 'sdk-last');
        assert.deepEqual(res.body.sharedBinding, {
            hubSessionId: 'hub-shared',
            sdkSessionId: 'sdk-shared',
            isBound: true,
        });
    });

    it('POST /sessions sincroniza sdkSessionId compartilhado e persiste o binding no store', async () => {
        setSharedHubSessionId('hub-1');

        const res = await request(createApp()).post('/sessions').send({ model: 'gpt-4.1' }).expect(201);

        assert.equal(res.body.sessionId, 'sdk-created');
        assert.equal(getSharedSdkSessionId(), 'sdk-created');
        assert.equal(res.body.isSharedSdkSession, true);
        assert.equal(res.body.boundHubSessionId, 'hub-1');
        assert.deepEqual(persistedBindings, [{ hubSessionId: 'hub-1', sdkSessionId: 'sdk-created' }]);
    });

    it('POST /sessions repassa a superfície JSON-serializável do SDK', async () => {
        const body = {
            sessionId: 'sdk-rich',
            model: 'gpt-4.1',
            clientName: 'test-client',
            reasoningEffort: 'high',
            modelCapabilities: { supports: { reasoningEffort: true } },
            configDir: '/tmp/copilot-config',
            enableConfigDiscovery: true,
            includeSubAgentStreamingEvents: false,
            systemMessage: { mode: 'customize', content: 'contexto' },
            availableTools: ['read_file'],
            excludedTools: ['shell'],
            provider: { type: 'openai', baseUrl: 'http://localhost:11434/v1/' },
            workingDirectory: '/workspaces/project',
            streaming: true,
            mcpServers: { local: { type: 'stdio', command: 'node', args: ['server.js'], tools: ['*'] } },
            customAgents: [{ name: 'reviewer', prompt: 'revise' }],
            defaultAgent: { excludedTools: ['heavy_tool'] },
            agent: 'reviewer',
            skillDirectories: ['.github/skills'],
            disabledSkills: ['old-skill'],
            infiniteSessions: { enabled: true, backgroundCompactionThreshold: 0.8 },
            gitHubToken: 'ghs_session_token',
        };

        const res = await request(createApp()).post('/sessions').send(body).expect(201);

        assert.equal(res.body.sessionId, 'sdk-rich');
        assert.equal(createdConfigs.length, 1);
        assert.deepEqual(createdConfigs[0], {
            onPermissionRequest: createdConfigs[0].onPermissionRequest,
            ...body,
            provider: { type: 'openai', baseUrl: 'http://localhost:11434/v1' },
        });
        assert.equal(typeof createdConfigs[0].onPermissionRequest, 'function');
    });

    it('POST /sessions rejeita provider inválido antes de chegar ao SDK', async () => {
        const res = await request(createApp())
            .post('/sessions')
            .send({ model: 'gpt-4.1', provider: { type: 'openai', baseUrl: '' } })
            .expect(400);

        assert.match(String(res.body.error), /baseUrl is required/);
        assert.equal(createdConfigs.length, 0);
    });

    it('PUT /sessions/foreground/:id promove a sessão para a SSOT compartilhada', async () => {
        setSharedHubSessionId('hub-2');

        const res = await request(createApp()).put('/sessions/foreground/sdk-foreground').expect(200);

        assert.equal(res.body.foregroundSessionId, 'sdk-foreground');
        assert.equal(getSharedSdkSessionId(), 'sdk-foreground');
        assert.equal(res.body.boundHubSessionId, 'hub-2');
        assert.deepEqual(persistedBindings, [{ hubSessionId: 'hub-2', sdkSessionId: 'sdk-foreground' }]);
    });

    it('GET /sessions/:id usa getSessionMetadata dedicado sem varrer listSessions', async () => {
        getSessionMetadataSpy.mockResolvedValue({ sessionId: 'sdk-meta', summary: 'metadata-dedicated' });

        const res = await request(createApp()).get('/sessions/sdk-meta').expect(200);

        assert.equal(res.body.sessionId, 'sdk-meta');
        assert.equal(res.body.metadata.sessionId, 'sdk-meta');
        assert.equal(res.body.metadata.summary, 'metadata-dedicated');
        assert.equal(getSessionMetadataSpy.mock.calls.length, 1);
        assert.equal(listSessionsSpy.mock.calls.length, 0);
    });

    it('POST /sessions/:id/resume sincroniza a sessão retomada na SSOT compartilhada', async () => {
        setSharedHubSessionId('hub-3');

        const res = await request(createApp()).post('/sessions/sdk-resume/resume').send({}).expect(200);

        assert.equal(res.body.sessionId, 'sdk-resume');
        assert.equal(getSharedSdkSessionId(), 'sdk-resume');
        assert.equal(res.body.boundHubSessionId, 'hub-3');
        assert.deepEqual(persistedBindings, [{ hubSessionId: 'hub-3', sdkSessionId: 'sdk-resume' }]);
    });

    it('POST /sessions/:id/resume repassa opções SDK de retomada', async () => {
        const body = {
            clientName: 'resume-client',
            model: 'gpt-4.1',
            reasoningEffort: 'medium',
            modelCapabilities: { supports: { reasoningEffort: true } },
            configDir: '/tmp/copilot-resume',
            enableConfigDiscovery: true,
            includeSubAgentStreamingEvents: false,
            systemMessage: { mode: 'append', content: 'resume' },
            availableTools: ['read_file'],
            excludedTools: ['shell'],
            provider: { type: 'openai', baseUrl: 'http://localhost:11434/v1/' },
            workingDirectory: '/workspaces/project',
            streaming: false,
            mcpServers: { local: { type: 'stdio', command: 'node', args: ['server.js'], tools: ['*'] } },
            customAgents: [{ name: 'reviewer', prompt: 'revise' }],
            defaultAgent: { excludedTools: ['heavy_tool'] },
            agent: 'reviewer',
            skillDirectories: ['.github/skills'],
            disabledSkills: ['old-skill'],
            infiniteSessions: { enabled: false },
            gitHubToken: 'ghs_session_token',
            disableResume: true,
        };

        const res = await request(createApp()).post('/sessions/sdk-rich/resume').send(body).expect(200);

        assert.equal(res.body.sessionId, 'sdk-rich');
        assert.equal(resumedConfigs.length, 1);
        assert.deepEqual(resumedConfigs[0], {
            onPermissionRequest: resumedConfigs[0].onPermissionRequest,
            ...body,
            provider: { type: 'openai', baseUrl: 'http://localhost:11434/v1' },
            infiniteSessions: {
                enabled: false,
                backgroundCompactionThreshold: 0.8,
            },
        });
        assert.equal(typeof resumedConfigs[0].onPermissionRequest, 'function');
    });

    it('POST /sessions/:id/resume rejeita provider inválido antes de chamar resumeSession', async () => {
        const res = await request(createApp())
            .post('/sessions/sdk-rich/resume')
            .send({ model: 'gpt-4.1', provider: { type: 'azure', baseUrl: '' } })
            .expect(400);

        assert.match(String(res.body.error), /baseUrl is required/);
        assert.equal(resumedConfigs.length, 0);
    });

    it('POST /sessions/:id/disconnect limpa somente o sdkSessionId compartilhado quando a sessão era a ativa', async () => {
        setSharedHubSessionId('hub-4');
        setSharedSdkSessionId('sdk-disc');
        registerActiveSdkSession(makeSession('sdk-disc'), { model: 'gpt-4.1' });

        const res = await request(createApp()).post('/sessions/sdk-disc/disconnect').expect(200);

        assert.equal(getSharedSdkSessionId(), null);
        assert.deepEqual(res.body.sharedBinding, {
            hubSessionId: 'hub-4',
            sdkSessionId: null,
            isBound: false,
        });
    });

    it('POST /sessions/:id/model expõe projection e repassa reasoningEffort', async () => {
        setSharedHubSessionId('hub-5');
        setSharedSdkSessionId('sdk-msg');
        /** @type {any[]} */
        const modelCalls = [];
        const session = makeSession('sdk-msg');
        session.setModel = async (/** @type {string} */ model, /** @type {unknown} */ options) => {
            modelCalls.push({ model, options });
        };
        registerActiveSdkSession(session, { model: 'gpt-4.1' });

        const res = await request(createApp())
            .post('/sessions/sdk-msg/model')
            .send({ model: 'gpt-4.1', reasoningEffort: 'high' })
            .expect(200);

        assert.equal(res.body.sessionId, 'sdk-msg');
        assert.equal(res.body.model, 'gpt-4.1');
        assert.equal(res.body.requestedModel, 'gpt-4.1');
        assert.equal(res.body.effectiveModel, 'gpt-4.1');
        assert.equal(res.body.verifiedSwitch, true);
        assert.equal(res.body.modelMismatch, false);
        assert.equal(res.body.reasoningEffort, 'high');
        assert.deepEqual(modelCalls, [{ model: 'gpt-4.1', options: { reasoningEffort: 'high' } }]);
        assert.equal(res.body.isSharedSdkSession, true);
        assert.equal(res.body.boundHubSessionId, 'hub-5');
        assert.deepEqual(res.body.sharedBinding, {
            hubSessionId: 'hub-5',
            sdkSessionId: 'sdk-msg',
            isBound: true,
        });
    });

    it('POST /sessions/:id/log expõe CopilotSession.log()', async () => {
        setSharedHubSessionId('hub-6');
        setSharedSdkSessionId('sdk-log');
        /** @type {any[]} */
        const logCalls = [];
        const session = makeSession('sdk-log');
        session.log = async (/** @type {string} */ message, /** @type {unknown} */ options) => {
            logCalls.push({ message, options });
        };
        registerActiveSdkSession(session, { model: 'gpt-4.1' });

        const res = await request(createApp())
            .post('/sessions/sdk-log/log')
            .send({ message: 'hello timeline', level: 'warning', ephemeral: true })
            .expect(200);

        assert.equal(res.body.sessionId, 'sdk-log');
        assert.deepEqual(logCalls, [{ message: 'hello timeline', options: { level: 'warning', ephemeral: true } }]);
    });

    it('GET /sessions/:id/ui/capabilities projeta capabilities e disponibilidade de elicitation', async () => {
        setSharedHubSessionId('hub-ui');
        setSharedSdkSessionId('sdk-ui');
        registerActiveSdkSession(makeSession('sdk-ui'), { model: 'gpt-4.1' });

        const res = await request(createApp()).get('/sessions/sdk-ui/ui/capabilities').expect(200);

        assert.equal(res.body.sessionId, 'sdk-ui');
        assert.equal(res.body.elicitationAvailable, true);
        assert.deepEqual(res.body.capabilities, { ui: { elicitation: true } });
    });

    it('POST /sessions/:id/ui/elicitation|confirm|select|input delega para session.ui.*', async () => {
        setSharedHubSessionId('hub-ui-actions');
        setSharedSdkSessionId('sdk-ui-actions');
        /** @type {any[]} */
        const uiCalls = [];
        const session = makeSession('sdk-ui-actions');
        session.ui = {
            elicitation: async (/** @type {any} */ params) => {
                uiCalls.push({ method: 'elicitation', params });
                return { action: 'accept', content: { answer: params.message } };
            },
            confirm: async (/** @type {string} */ message) => {
                uiCalls.push({ method: 'confirm', message });
                return true;
            },
            select: async (/** @type {string} */ message, /** @type {string[]} */ options) => {
                uiCalls.push({ method: 'select', message, options });
                return options.at(-1) ?? null;
            },
            input: async (/** @type {string} */ message, /** @type {unknown} */ options) => {
                uiCalls.push({ method: 'input', message, options });
                return `${message}:typed`;
            },
        };
        registerActiveSdkSession(session, { model: 'gpt-4.1' });

        const elicitation = await request(createApp())
            .post('/sessions/sdk-ui-actions/ui/elicitation')
            .send({ message: 'Dados?', requestedSchema: { type: 'object', properties: {} } })
            .expect(200);
        const confirm = await request(createApp())
            .post('/sessions/sdk-ui-actions/ui/confirm')
            .send({ message: 'Confirma?' })
            .expect(200);
        const select = await request(createApp())
            .post('/sessions/sdk-ui-actions/ui/select')
            .send({ message: 'Escolha', options: ['dev', 'prod'] })
            .expect(200);
        const input = await request(createApp())
            .post('/sessions/sdk-ui-actions/ui/input')
            .send({ message: 'Nome?', options: { title: 'Nome' } })
            .expect(200);

        assert.deepEqual(elicitation.body.result, { action: 'accept', content: { answer: 'Dados?' } });
        assert.equal(confirm.body.result, true);
        assert.equal(select.body.result, 'prod');
        assert.equal(input.body.result, 'Nome?:typed');
        assert.deepEqual(uiCalls, [
            {
                method: 'elicitation',
                params: { message: 'Dados?', requestedSchema: { type: 'object', properties: {} } },
            },
            { method: 'confirm', message: 'Confirma?' },
            { method: 'select', message: 'Escolha', options: ['dev', 'prod'] },
            { method: 'input', message: 'Nome?', options: { title: 'Nome' } },
        ]);
    });
});
