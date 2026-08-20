// @ts-check

import express from 'express';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import request from 'supertest';
import { describe, it } from 'vitest';

import { registerStreamRoutes } from '../../../src/copilot/server/routes/copilot-api/stream.js';

/**
 * @param {(req: import('express').Request) => {
 *     agent: EventEmitter;
 *     runtimeId: string;
 *     requestedRuntimeId: string | null;
 *     runtimeFound: boolean;
 *     usedDefaultRuntimeFallback: boolean;
 *     runtimeFallbackWarning?: string | null;
 * }} binding
 */
function createApp(binding) {
    const app = express();
    const router = express.Router();
    registerStreamRoutes(router, /** @type {any} */ (binding));
    app.use(router);
    return app;
}

describe('copilot-api stream runtime targeting', () => {
    it('GET /stream retorna 404 quando runtimeId explícito não existe', async () => {
        const agent = /** @type {any} */ (new EventEmitter());
        const app = createApp((req) => {
            const requested = typeof req.query['runtimeId'] === 'string' ? req.query['runtimeId'] : null;
            if (requested === 'missing') {
                return {
                    agent,
                    runtimeId: 'default',
                    requestedRuntimeId: 'missing',
                    runtimeFound: false,
                    usedDefaultRuntimeFallback: true,
                    runtimeFallbackWarning: "Runtime 'missing' não encontrado; fallback para 'default'.",
                };
            }
            return {
                agent,
                runtimeId: 'default',
                requestedRuntimeId: requested,
                runtimeFound: true,
                usedDefaultRuntimeFallback: false,
                runtimeFallbackWarning: null,
            };
        });

        const res = await request(app).get('/stream?runtimeId=missing').expect(404);
        assert.equal(res.body.ok, false);
        assert.equal(res.body.requestedRuntimeId, 'missing');
        assert.equal(res.body.runtimeFound, false);
        assert.equal(res.body.error, "Runtime 'missing' não encontrado para stream operacional.");
    });

    it('GET /stream/tasks retorna 404 quando runtimeId explícito não existe', async () => {
        const agent = /** @type {any} */ (new EventEmitter());
        const app = createApp((req) => {
            const requested = typeof req.query['runtimeId'] === 'string' ? req.query['runtimeId'] : null;
            if (requested === 'missing') {
                return {
                    agent,
                    runtimeId: 'default',
                    requestedRuntimeId: 'missing',
                    runtimeFound: false,
                    usedDefaultRuntimeFallback: true,
                    runtimeFallbackWarning: "Runtime 'missing' não encontrado; fallback para 'default'.",
                };
            }
            return {
                agent,
                runtimeId: 'default',
                requestedRuntimeId: requested,
                runtimeFound: true,
                usedDefaultRuntimeFallback: false,
                runtimeFallbackWarning: null,
            };
        });

        const res = await request(app).get('/stream/tasks?runtimeId=missing').expect(404);
        assert.equal(res.body.ok, false);
        assert.equal(res.body.requestedRuntimeId, 'missing');
        assert.equal(res.body.runtimeFound, false);
        assert.equal(res.body.error, "Runtime 'missing' não encontrado para stream operacional.");
    });
});
