import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

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

import { registerActiveSdkSession } from '../../../src/copilot/infra/sdk-session-registry.js';
import sessionsRouter from '../../../src/copilot/server/routes/sdk/sessions.js';

/**
 * @param {string} sessionId
 * @returns {any}
 */
function makeSession(sessionId) {
    return {
        sessionId,
        workspacePath: `/tmp/${sessionId}`,
        disconnect: async () => {},
        setModel: async () => {},
        abort: async () => {},
        getMessages: async () => [],
        send: async () => `${sessionId}-msg`,
        sendAndWait: async () => ({ data: { content: 'ok', messageId: `${sessionId}-reply` } }),
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

    /** @type {any[]} */
    let persistedBindings;

    beforeEach(() => {
        hadConversationStore = container.has(CONVERSATION_STORE);
        previousConversationStore = hadConversationStore ? container.resolve(CONVERSATION_STORE) : undefined;
        foregroundSessionId = null;
        lastSessionId = null;
        persistedBindings = [];
        clearSharedSessionBinding();

        container.register(
            CONVERSATION_STORE,
            () => ({
                updateSdkSession(hubSessionId, sdkSessionId) {
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
                setForegroundSessionId: async (id) => {
                    foregroundSessionId = id;
                    lastSessionId = id;
                },
                listSessions: async () => [],
                createSession: async (config) => {
                    const session = makeSession(config.sessionId ?? 'sdk-created');
                    lastSessionId = session.sessionId;
                    return session;
                },
                resumeSession: async (id) => {
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

    it('PUT /sessions/foreground/:id promove a sessão para a SSOT compartilhada', async () => {
        setSharedHubSessionId('hub-2');

        const res = await request(createApp()).put('/sessions/foreground/sdk-foreground').expect(200);

        assert.equal(res.body.foregroundSessionId, 'sdk-foreground');
        assert.equal(getSharedSdkSessionId(), 'sdk-foreground');
        assert.equal(res.body.boundHubSessionId, 'hub-2');
        assert.deepEqual(persistedBindings, [{ hubSessionId: 'hub-2', sdkSessionId: 'sdk-foreground' }]);
    });

    it('POST /sessions/:id/resume sincroniza a sessão retomada na SSOT compartilhada', async () => {
        setSharedHubSessionId('hub-3');

        const res = await request(createApp()).post('/sessions/sdk-resume/resume').send({}).expect(200);

        assert.equal(res.body.sessionId, 'sdk-resume');
        assert.equal(getSharedSdkSessionId(), 'sdk-resume');
        assert.equal(res.body.boundHubSessionId, 'hub-3');
        assert.deepEqual(persistedBindings, [{ hubSessionId: 'hub-3', sdkSessionId: 'sdk-resume' }]);
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

    it('POST /sessions/:id/model expõe projection de ownership nas respostas de messaging', async () => {
        setSharedHubSessionId('hub-5');
        setSharedSdkSessionId('sdk-msg');
        registerActiveSdkSession(makeSession('sdk-msg'), { model: 'gpt-4.1' });

        const res = await request(createApp()).post('/sessions/sdk-msg/model').send({ model: 'gpt-4.1' }).expect(200);

        assert.equal(res.body.sessionId, 'sdk-msg');
        assert.equal(res.body.isSharedSdkSession, true);
        assert.equal(res.body.boundHubSessionId, 'hub-5');
        assert.deepEqual(res.body.sharedBinding, {
            hubSessionId: 'hub-5',
            sdkSessionId: 'sdk-msg',
            isBound: true,
        });
    });
});
