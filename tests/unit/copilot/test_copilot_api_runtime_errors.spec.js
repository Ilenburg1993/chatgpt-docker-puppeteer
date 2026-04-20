// @ts-check

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import express from 'express';
import request from 'supertest';

import { registerControlRoutes } from '../../../src/copilot/server/routes/copilot-api/control.js';
import { registerDialogRoutes } from '../../../src/copilot/server/routes/copilot-api/dialog.js';
import { registerTaskRoutes } from '../../../src/copilot/server/routes/copilot-api/tasks.js';

/**
 * @param {(router: import('express').Router, agent: any) => void} register
 * @param {any} agent
 * @returns {import('express').Express}
 */
function createApp(register, agent) {
    const app = express();
    const router = express.Router();
    app.use(express.json());
    register(router, agent);
    app.use(router);
    return app;
}

describe('copilot-api runtime error projection', () => {
    it('POST /send projeta AbortError síncrono para 504', async () => {
        const agent = /** @type {any} */ ({
            status: 'idle',
            sendMessage: async () => {
                throw new DOMException('Aborted', 'AbortError');
            },
        });
        const app = createApp(registerTaskRoutes, agent);

        const res = await request(app).post('/send').send({ message: 'oi', waitForResponse: true, timeoutMs: 1234 });

        assert.equal(res.status, 504);
        assert.equal(res.body.ok, false);
        assert.equal(res.body.disposition, 'ignore');
        assert.equal(res.body.retryable, false);
    });

    it('POST /send projeta QUEUE_FULL para 429 no enqueue assíncrono', async () => {
        const error = Object.assign(new Error('Fila cheia'), { code: 'QUEUE_FULL' });
        const agent = /** @type {any} */ ({
            status: 'idle',
            sendMessage: async () => {
                throw error;
            },
        });
        const app = createApp(registerTaskRoutes, agent);

        const res = await request(app).post('/send').send({ message: 'oi' });

        assert.equal(res.status, 429);
        assert.equal(res.body.code, 'QUEUE_FULL');
        assert.equal(res.body.retryable, true);
    });

    it('POST /dialog/turn projeta DIALOG_TIMEOUT para 504', async () => {
        const error = Object.assign(new Error('timeout'), { code: 'DIALOG_TIMEOUT' });
        const agent = /** @type {any} */ ({
            dialogLoopActive: true,
            sendDialogTurn: async () => {
                throw error;
            },
        });
        const app = createApp(registerDialogRoutes, agent);

        const res = await request(app).post('/dialog/turn').send({ message: 'oi', timeout: 2000 });

        assert.equal(res.status, 504);
        assert.equal(res.body.code, 'DIALOG_TIMEOUT');
        assert.equal(res.body.dialogLoopActive, true);
        assert.equal(res.body.retryable, true);
    });

    it('POST /answer/clear-shadow limpa shadow persistida quando suportado', async () => {
        const agent = /** @type {any} */ ({
            clearPendingQuestionShadow: () => true,
        });
        const app = createApp(registerTaskRoutes, agent);

        const res = await request(app).post('/answer/clear-shadow').send({});

        assert.equal(res.status, 200);
        assert.equal(res.body.ok, true);
    });

    it('POST /answer/clear-shadow retorna 409 quando não há shadow persistida', async () => {
        const agent = /** @type {any} */ ({
            clearPendingQuestionShadow: () => false,
        });
        const app = createApp(registerTaskRoutes, agent);

        const res = await request(app).post('/answer/clear-shadow').send({});

        assert.equal(res.status, 409);
        assert.equal(res.body.ok, false);
    });

    it('POST /steer projeta NO_SESSION para 503', async () => {
        const error = Object.assign(new Error('sem sessão'), { code: 'NO_SESSION' });
        const agent = /** @type {any} */ ({
            getStatusSnapshot: () => ({ ok: true }),
            steerMessage: async () => {
                throw error;
            },
        });
        const app = createApp(registerControlRoutes, agent);

        const res = await request(app).post('/steer').send({ message: 'muda o rumo' });

        assert.equal(res.status, 503);
        assert.equal(res.body.code, 'NO_SESSION');
        assert.equal(res.body.disposition, 'retry');
    });
});
