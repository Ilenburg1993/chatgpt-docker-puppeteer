// @ts-check

import express from 'express';
import assert from 'node:assert/strict';
import supertest from 'supertest';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/copilot/agent/ports/tool-port.js', () => ({
    resolveAgentUserInput: vi.fn(() => true),
}));

import { answerPendingQuestion } from '../../../src/copilot/agent/messaging/agent-messaging.js';
import { resolveAgentUserInput } from '../../../src/copilot/agent/ports/tool-port.js';
import { registerTaskRoutes } from '../../../src/copilot/server/routes/copilot-api/tasks.js';

/**
 * @param {any} agent
 * @returns {import('express').Express}
 */
function createApp(agent) {
    const app = express();
    const router = express.Router();
    app.use(express.json());
    registerTaskRoutes(router, agent);
    app.use(router);
    return app;
}

describe('copilot-api /answer fallback request_user_input', () => {
    it('retorna 200 quando answerPendingQuestion resolve via tool fallback sem ask_user vivo', async () => {
        /** @type {{ event: string; payload: Record<string, unknown> }[]} */
        const emitted = [];
        const host = {
            emit: (/** @type {string} */ event, /** @type {Record<string, unknown>} */ payload) => {
                emitted.push({ event, payload });
            },
        };

        const ctx = {
            hasPendingQuestion: () => false,
            resolvePendingQuestion: () => {},
            trackBackgroundTask: () => Promise.resolve(),
        };

        const agent = {
            answerPendingQuestion: (/** @type {string} */ answer) =>
                answerPendingQuestion(/** @type {any} */ (ctx), /** @type {any} */ (host), answer),
        };

        const app = createApp(agent);
        const res = await supertest(app).post('/answer').send({ answer: 'confirmado pelo operador' });

        assert.equal(res.status, 200);
        assert.equal(res.body.ok, true);
        expect(resolveAgentUserInput).toHaveBeenCalledWith('confirmado pelo operador');
        const answeredEvent = emitted.find((item) => item.event === 'question.answered');
        expect(answeredEvent?.payload).toMatchObject({
            answer: 'confirmado pelo operador',
            hadPending: false,
            resolvedViaTool: true,
        });
    });
});
