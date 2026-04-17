import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { CONVERSATION_STORE } from '#copilot/conversation-hub';
import { clearSharedSessionBinding, container, setSharedSdkSessionId } from '#copilot/core';
import express from 'express';
import request from 'supertest';

import { createSessionsRouter } from '../../../src/copilot/server/routes/sessions.js';

describe('sessions router shared sdk binding', () => {
    /** @type {unknown} */
    let previousConversationStore;

    /** @type {boolean} */
    let hadConversationStore = false;

    beforeEach(() => {
        hadConversationStore = container.has(CONVERSATION_STORE);
        previousConversationStore = hadConversationStore ? container.resolve(CONVERSATION_STORE) : undefined;
        clearSharedSessionBinding();
    });

    afterEach(() => {
        clearSharedSessionBinding();
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

    it('POST /sessions usa sdkSessionId compartilhado quando body não informa um', async () => {
        setSharedSdkSessionId('sdk-shared-1');

        /** @type {any[]} */
        const calls = [];
        container.register(
            CONVERSATION_STORE,
            () => ({
                createHubSession(opts) {
                    calls.push(opts);
                    return 'hub-created';
                },
                getHubSession: () => null,
                closeHubSession: () => {},
            }),
            'singleton',
        );

        const app = express();
        app.use(express.json());
        app.use(createSessionsRouter());

        const res = await request(app).post('/sessions').send({ title: 'Nova conversa' }).expect(201);

        assert.equal(res.body.id, 'hub-created');
        assert.equal(calls[0]?.sdkSessionId, 'sdk-shared-1');
    });
});
