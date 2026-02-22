import test from 'node:test';
import assert from 'node:assert/strict';
import { createInferenceGatewayServer } from '../../../src/inference_gateway/server.js';

async function listen(server) {
    await new Promise((resolve, reject) => {
        server.listen(0, '127.0.0.1', err => (err ? reject(err) : resolve()));
    });
    const addr = server.address();
    return `http://${addr.address}:${addr.port}`;
}

test('inference gateway server exposes validate/generate preflight endpoint', async () => {
    let validateCalls = 0;
    const server = createInferenceGatewayServer({
        gateway: {
            validateGenerate(body) {
                validateCalls += 1;
                return {
                    ok: true,
                    clientTag: String(body.clientTag || ''),
                    policy: { maxParallel: 1 },
                    route: { model: body.model || null, backend: body.backend || null },
                    reason: null,
                    ts: Date.now(),
                };
            },
            getMetrics() {
                return {};
            },
        },
    });
    const base = await listen(server);
    try {
        const res = await fetch(`${base}/v1/validate/generate`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ clientTag: 'audit_agent_triage', model: 'triage-x' }),
        });
        assert.equal(res.status, 200);
        const json = await res.json();
        assert.equal(json.ok, true);
        assert.equal(json.clientTag, 'audit_agent_triage');
        assert.equal(validateCalls, 1);
    } finally {
        await new Promise(resolve => server.close(() => resolve()));
    }
});

test('inference gateway server returns 400 when preflight route is rejected', async () => {
    const server = createInferenceGatewayServer({
        gateway: {
            validateGenerate() {
                return { ok: false, reason: 'model not allowed' };
            },
            getMetrics() {
                return {};
            },
        },
    });
    const base = await listen(server);
    try {
        const res = await fetch(`${base}/v1/validate/generate`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ clientTag: 'audit_agent_triage' }),
        });
        assert.equal(res.status, 400);
        const json = await res.json();
        assert.equal(json.ok, false);
        assert.equal(json.reason, 'model not allowed');
    } finally {
        await new Promise(resolve => server.close(() => resolve()));
    }
});

