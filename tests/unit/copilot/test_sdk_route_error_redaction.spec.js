// @ts-check

import assert from 'node:assert/strict';
import { beforeEach, describe, it, vi } from 'vitest';

const logMock = vi.hoisted(() => vi.fn());

vi.mock('#copilot/observability', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        .../** @type {Record<string, unknown>} */ (actual),
        log: logMock,
    };
});

import { withErrorHandler as withSdkRouteErrorHandler } from '../../../src/copilot/server/routes/sdk/middleware.js';
import { withErrorHandler as withSessionRouteErrorHandler } from '../../../src/copilot/server/routes/sdk/session-middleware.js';

/** @returns {any} */
function createReq() {
    return {
        method: 'GET',
        path: '/models',
        query: {},
        params: {},
        headers: {},
    };
}

/** @returns {any} */
function createRes() {
    return {
        headersSent: false,
        statusCode: null,
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(body) {
            this.body = body;
            return this;
        },
    };
}

describe('sdk route error redaction', () => {
    beforeEach(() => {
        logMock.mockClear();
    });

    it('redige segredos na resposta e no log do middleware SDK compartilhado', async () => {
        const res = createRes();

        await withSdkRouteErrorHandler('sdk-api/client', createReq(), res, async () => {
            throw Object.assign(new Error('provider rejected Authorization: Bearer sk-test-local-secret123'), {
                status: 400,
                code: 'PROVIDER_BAD_REQUEST',
            });
        });

        const serializedBody = JSON.stringify(res.body);
        const serializedLog = JSON.stringify(logMock.mock.calls);
        assert.equal(res.statusCode, 400);
        assert.equal(serializedBody.includes('sk-test-local-secret123'), false);
        assert.equal(serializedLog.includes('sk-test-local-secret123'), false);
        assert.match(serializedBody, /Bearer \[redacted\]/);
        assert.match(serializedLog, /Bearer \[redacted\]/);
    });

    it('redige segredos no log do middleware específico de sessões', async () => {
        const res = createRes();

        await withSessionRouteErrorHandler(createReq(), res, async () => {
            throw Object.assign(new Error('session provider failed apiKey=sk-test-session-secret123'), {
                status: 422,
                code: 'SESSION_PROVIDER_FAILED',
            });
        });

        const serializedBody = JSON.stringify(res.body);
        const serializedLog = JSON.stringify(logMock.mock.calls);
        assert.equal(res.statusCode, 422);
        assert.equal(serializedBody.includes('sk-test-session-secret123'), false);
        assert.equal(serializedLog.includes('sk-test-session-secret123'), false);
        assert.match(serializedBody, /apiKey=\[redacted\]/);
        assert.match(serializedLog, /apiKey=\[redacted\]/);
    });
});
