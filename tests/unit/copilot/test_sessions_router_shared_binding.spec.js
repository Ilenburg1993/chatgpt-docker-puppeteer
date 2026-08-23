import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, vi } from 'vitest';

import { clearAgentRuntimeRegistry, registerAgentRuntime } from '#copilot/agent/runtime-registry';
import { conversationStore } from '#copilot/conversation-hub';
import express from 'express';
import request from 'supertest';

import { createAgentSessionBindingRuntime } from '../../../src/copilot/agent/session/state/binding-runtime.js';
import { createSessionsRouter } from '../../../src/copilot/server/routes/sessions.js';

describe('sessions router runtime-scoped sdk binding', () => {
    /** @type {ReturnType<typeof createAgentSessionBindingRuntime>} */
    let sessionBinding;

    beforeEach(() => {
        clearAgentRuntimeRegistry();
        sessionBinding = createAgentSessionBindingRuntime();
        registerAgentRuntime(
            /** @type {any} */ ({
                ctx: { sessionBinding },
                status: 'idle',
                sessionId: null,
                model: 'gpt-5',
                getSessionBindingSnapshot: () => sessionBinding.snapshot(),
                setHubSessionId: (/** @type {string|null|undefined} */ id) => sessionBinding.setHubSessionId(id),
                setSdkSessionId: (/** @type {string|null|undefined} */ id) => sessionBinding.setSdkSessionId(id),
                clearSessionBinding: () => sessionBinding.clear(),
            }),
            'default',
        );
    });

    afterEach(() => {
        vi.restoreAllMocks();
        sessionBinding.dispose();
        clearAgentRuntimeRegistry();
    });

    it('POST /sessions usa sdkSessionId do runtime default quando body não informa um', async () => {
        sessionBinding.setSdkSessionId('sdk-runtime-1');
        /** @type {any[]} */
        const calls = [];
        vi.spyOn(conversationStore, 'createHubSession').mockImplementation((opts) => {
            calls.push(opts);
            return 'hub-created';
        });

        const app = express();
        app.use(express.json());
        app.use(createSessionsRouter());

        const res = await request(app).post('/sessions').send({ title: 'Nova conversa' }).expect(201);

        assert.equal(res.body.id, 'hub-created');
        assert.equal(calls[0]?.sdkSessionId, 'sdk-runtime-1');
    });

    it('GET /sessions/:sessionId e DELETE /sessions/:sessionId delegam pelo ConversationStore owner', async () => {
        /** @type {string[]} */
        const closed = [];
        vi.spyOn(conversationStore, 'getHubSession').mockImplementation((id) =>
            id === 'hub-1' ? /** @type {any} */ ({ id, title: 'Hub 1' }) : null,
        );
        vi.spyOn(conversationStore, 'closeHubSession').mockImplementation((id) => {
            closed.push(id);
        });

        const app = express();
        app.use(express.json());
        app.use(createSessionsRouter());

        const getRes = await request(app).get('/sessions/hub-1').expect(200);
        assert.equal(getRes.body.session.id, 'hub-1');
        await request(app).get('/sessions/missing').expect(404);

        const deleteRes = await request(app).delete('/sessions/hub-1').expect(200);
        assert.equal(deleteRes.body.closed, 'hub-1');
        assert.deepEqual(closed, ['hub-1']);
    });
});
