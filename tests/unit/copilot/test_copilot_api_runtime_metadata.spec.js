// @ts-check

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import express from 'express';
import supertest from 'supertest';

import { registerControlRoutes } from '../../../src/copilot/server/routes/copilot-api/control.js';
import { registerDialogRoutes } from '../../../src/copilot/server/routes/copilot-api/dialog.js';
import { registerTaskRoutes } from '../../../src/copilot/server/routes/copilot-api/tasks.js';

/**
 * @param {(router: import('express').Router, binding: any) => void} register
 * @param {import('../../../src/copilot/presentation/runtime-route-deps.js').CopilotApiRouteDeps} deps
 */
function createApp(register, deps) {
    const app = express();
    const router = express.Router();
    app.use(express.json());
    register(router, () => deps);
    app.use(router);
    return app;
}

describe('copilot-api runtime metadata propagation', () => {
    it('control routes incluem runtime metadata em start/stop/permissions/steer/compliance', async () => {
        const deps =
            /** @type {import('../../../src/copilot/presentation/runtime-route-deps.js').CopilotApiRouteDeps} */ ({
                runtimeId: 'default',
                requestedRuntimeId: 'missing',
                runtimeFound: false,
                usedDefaultRuntimeFallback: true,
                agent: /** @type {any} */ ({
                    status: 'stopped',
                    sessionId: 's-1',
                    dialogLoopActive: false,
                    start: async () => {},
                    stop: async () => {},
                    getPermissionMode: () => 'approve_all',
                    setPermissionMode: () => {},
                    steerMessage: async () => 'm-1',
                }),
            });

        const app = createApp(registerControlRoutes, deps);

        const startRes = await supertest(app).post('/start').send({});
        assert.equal(startRes.status, 200);
        assert.equal(startRes.body.runtimeId, 'default');
        assert.equal(startRes.body.requestedRuntimeId, 'missing');
        assert.equal(startRes.body.usedDefaultRuntimeFallback, true);

        const permRes = await supertest(app).get('/permissions');
        assert.equal(permRes.status, 200);
        assert.equal(permRes.body.runtimeId, 'default');
        assert.equal(permRes.body.requestedRuntimeId, 'missing');

        const steerRes = await supertest(app).post('/steer').send({ message: 'ajuste' });
        assert.equal(steerRes.status, 200);
        assert.equal(steerRes.body.runtimeId, 'default');
        assert.equal(steerRes.body.requestedRuntimeId, 'missing');

        const complianceRes = await supertest(app).get('/compliance');
        assert.equal(complianceRes.status, 200);
        assert.equal(complianceRes.body.runtimeId, 'default');
        assert.equal(complianceRes.body.requestedRuntimeId, 'missing');

        const complianceStatsRes = await supertest(app).get('/compliance/stats');
        assert.equal(complianceStatsRes.status, 200);
        assert.equal(complianceStatsRes.body.runtimeId, 'default');
        assert.equal(complianceStatsRes.body.requestedRuntimeId, 'missing');

        const stopRes = await supertest(app).post('/stop').send({});
        assert.equal(stopRes.status, 200);
        assert.equal(stopRes.body.runtimeId, 'default');
        assert.equal(stopRes.body.requestedRuntimeId, 'missing');
    });

    it('task routes incluem runtime metadata em success e validações', async () => {
        const deps =
            /** @type {import('../../../src/copilot/presentation/runtime-route-deps.js').CopilotApiRouteDeps} */ ({
                runtimeId: 'default',
                requestedRuntimeId: 'missing',
                runtimeFound: false,
                usedDefaultRuntimeFallback: true,
                agent: /** @type {any} */ ({
                    status: 'idle',
                    sendMessage: async () => 'ok',
                    answerPendingQuestion: () => true,
                    clearPendingQuestionShadow: () => true,
                    listPendingSdkElicitations: () => [],
                    getPendingSdkElicitation: () => null,
                    resolvePendingSdkElicitation: () => false,
                }),
            });

        const app = createApp(registerTaskRoutes, deps);

        const badRes = await supertest(app).post('/send').send({});
        assert.equal(badRes.status, 400);
        assert.equal(badRes.body.runtimeId, 'default');
        assert.equal(badRes.body.requestedRuntimeId, 'missing');

        const okRes = await supertest(app).post('/send').send({ message: 'oi' });
        assert.equal(okRes.status, 200);
        assert.equal(okRes.body.runtimeId, 'default');
        assert.equal(okRes.body.requestedRuntimeId, 'missing');

        const answerRes = await supertest(app).post('/answer').send({ answer: 'sim' });
        assert.equal(answerRes.status, 200);
        assert.equal(answerRes.body.runtimeId, 'default');

        const clearRes = await supertest(app).post('/answer/clear-shadow').send({});
        assert.equal(clearRes.status, 200);
        assert.equal(clearRes.body.runtimeId, 'default');
    });

    it('task route /elicitation/:id/respond aplica validação/schema defaults antes de resolver', async () => {
        /** @type {import('../../../src/copilot/presentation/types.js').RuntimeElicitationResult[]} */
        const resolved = [];
        const deps =
            /** @type {import('../../../src/copilot/presentation/runtime-route-deps.js').CopilotApiRouteDeps} */ ({
                runtimeId: 'default',
                requestedRuntimeId: 'missing',
                runtimeFound: false,
                usedDefaultRuntimeFallback: true,
                agent: /** @type {any} */ ({
                    getPendingSdkElicitation: () => ({
                        id: 'el-1',
                        requestedSchema: {
                            type: 'object',
                            properties: {
                                env: { type: 'string', default: 'dev', enum: ['dev', 'prod'] },
                                tags: {
                                    type: 'array',
                                    items: {
                                        anyOf: [
                                            { const: 'fast', title: 'fast' },
                                            { const: 'safe', title: 'safe' },
                                        ],
                                    },
                                },
                            },
                            required: ['env'],
                        },
                    }),
                    resolvePendingSdkElicitation: (
                        /** @type {string} */ _id,
                        /** @type {import('../../../src/copilot/presentation/types.js').RuntimeElicitationResult} */ result,
                    ) => {
                        resolved.push(result);
                        return true;
                    },
                }),
            });

        const app = createApp(registerTaskRoutes, deps);

        const badRes = await supertest(app)
            .post('/elicitation/el-1/respond')
            .send({ action: 'accept', content: { tags: ['fast', 'noisy'] } });
        assert.equal(badRes.status, 400);
        assert.equal(badRes.body.runtimeId, 'default');
        assert.match(String(badRes.body.error ?? ''), /fast \| safe/);

        const okRes = await supertest(app)
            .post('/elicitation/el-1/respond')
            .send({ action: 'accept', content: { tags: ['fast', 'safe'] } });
        assert.equal(okRes.status, 200);
        assert.deepEqual(resolved[0], {
            action: 'accept',
            content: { env: 'dev', tags: ['fast', 'safe'] },
        });
    });

    it('dialog routes incluem runtime metadata em start/turn/stop', async () => {
        const deps =
            /** @type {import('../../../src/copilot/presentation/runtime-route-deps.js').CopilotApiRouteDeps} */ ({
                runtimeId: 'default',
                requestedRuntimeId: 'missing',
                runtimeFound: false,
                usedDefaultRuntimeFallback: true,
                agent: /** @type {any} */ ({
                    status: 'idle',
                    dialogLoopActive: true,
                    startDialogLoop: async () => {},
                    sendDialogTurn: async () => 'reply',
                    stopDialogLoop: async () => {},
                }),
            });

        const app = createApp(registerDialogRoutes, deps);

        const startRes = await supertest(app).post('/dialog/start').send({});
        assert.equal(startRes.status, 200);
        assert.equal(startRes.body.runtimeId, 'default');
        assert.equal(startRes.body.requestedRuntimeId, 'missing');

        const turnRes = await supertest(app).post('/dialog/turn').send({ message: 'oi' });
        assert.equal(turnRes.status, 200);
        assert.equal(turnRes.body.runtimeId, 'default');

        const stopRes = await supertest(app).post('/dialog/stop').send({ force: true });
        assert.equal(stopRes.status, 200);
        assert.equal(stopRes.body.runtimeId, 'default');
    });
});
