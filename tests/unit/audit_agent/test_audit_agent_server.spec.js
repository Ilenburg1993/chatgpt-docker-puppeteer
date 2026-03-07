// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuditAgentServer } from '../../../src/audit_agent/server.js';
import { AuditAgentRuntime } from '../../../src/audit_agent/runtime.js';

async function listen(/** @type {any} */ server) {
    await /** @type {Promise<void>} */ (
        new Promise((resolve, reject) => {
            server.listen(0, '127.0.0.1', (/** @type {any} */ err) => (err ? reject(err) : resolve()));
        })
    );
    const addr = server.address();
    return `http://${addr.address}:${addr.port}`;
}

test('audit-agent server creates and runs jobs via HTTP', async () => {
    const rt = new AuditAgentRuntime();
    const server = createAuditAgentServer({ runtime: rt });
    const base = await listen(server);
    try {
        const createRes = await fetch(`${base}/jobs`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ kind: 'quick_audit', trigger_type: 'manual' }),
        });
        assert.equal(createRes.status, 201);
        const createJson = await createRes.json();
        const jobId = createJson.job.id;

        const runRes = await fetch(`${base}/jobs/${encodeURIComponent(jobId)}/run`, { method: 'POST' });
        assert.equal(runRes.status, 200);
        const runJson = await runRes.json();
        assert.equal(runJson.job.status, 'COMPLETED');

        const getRes = await fetch(`${base}/jobs/${encodeURIComponent(jobId)}`);
        assert.equal(getRes.status, 200);
        const getJson = await getRes.json();
        assert.equal(getJson.ok, true);
        assert.equal(getJson.job.id, jobId);

        const metricsRes = await fetch(`${base}/metrics`);
        assert.equal(metricsRes.status, 200);
        const metricsJson = await metricsRes.json();
        assert.equal(metricsJson.ok, true);
        assert.equal(metricsJson.metrics.jobs_total, 1);
    } finally {
        await /** @type {Promise<void>} */ (new Promise(resolve => server.close(() => resolve())));
    }
});

test('audit-agent server returns patch-like jobs in WAITING_APPROVAL after run', async () => {
    const rt = new AuditAgentRuntime();
    const server = createAuditAgentServer({ runtime: rt });
    const base = await listen(server);
    try {
        const createRes = await fetch(`${base}/jobs`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ kind: 'patch_suggest', trigger_type: 'manual' }),
        });
        const createJson = await createRes.json();
        const jobId = createJson.job.id;
        const runRes = await fetch(`${base}/jobs/${encodeURIComponent(jobId)}/run`, { method: 'POST' });
        const runJson = await runRes.json();
        assert.equal(runJson.job.status, 'WAITING_APPROVAL');
    } finally {
        await /** @type {Promise<void>} */ (new Promise(resolve => server.close(() => resolve())));
    }
});
