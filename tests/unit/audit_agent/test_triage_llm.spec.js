// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createAuditAgentTriageLlmClient } from '../../../src/audit_agent/triage_llm.js';

async function listen(/** @type {any} */ server) {
    await /** @type {Promise<void>} */ (new Promise((resolve, reject) => {
        server.listen(0, '127.0.0.1', (/** @type {any} */ err) => (err ? reject(err) : resolve()));
    }));
    const addr = server.address();
    return { host: addr.address, port: addr.port };
}

function withEnv(/** @type {Record<string,any>} */ pairs, /** @type {() => any} */ fn) {
    const prev = /** @type {Record<string,string|undefined>} */ ({});
    for (const [k, v] of Object.entries(pairs)) {
        prev[k] = process.env[k];
        if (v === undefined || v === null) delete process.env[k];
        else process.env[k] = String(v);
    }
    return Promise.resolve()
        .then(fn)
        .finally(() => {
            for (const [k, v] of Object.entries(prev)) {
                if (v === undefined) delete process.env[k];
                else process.env[k] = v;
            }
        });
}

test('triage_llm performs preflight then generate via inference gateway', async () => {
    /** @type {string[]} */
    const hits = [];
    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url || '/', 'http://localhost');
        let body = '';
        for await (const chunk of req) body += String(chunk);
        const json = body ? JSON.parse(body) : {};
        res.setHeader('content-type', 'application/json; charset=utf-8');

        if (req.method === 'POST' && url.pathname === '/v1/validate/generate') {
            hits.push('preflight');
            assert.equal(json.clientTag, 'audit_agent_triage');
            res.statusCode = 200;
            res.end(JSON.stringify({ ok: true, policy: { maxParallel: 1 }, ts: 111 }));
            return;
        }
        if (req.method === 'POST' && url.pathname === '/v1/generate') {
            hits.push('generate');
            assert.equal(json.clientTag, 'audit_agent_triage');
            assert.equal(typeof json.prompt, 'string');
            res.statusCode = 200;
            res.end(
                JSON.stringify({
                    ok: true,
                    policy: { maxParallel: 1 },
                    result: { response: '{"summary":"triaged","risk_level":"medium","next_actions":["run tests"]}' },
                    ts: 222,
                })
            );
            return;
        }
        res.statusCode = 404;
        res.end(JSON.stringify({ ok: false, error: 'not_found' }));
    });
    const addr = await listen(server);
    try {
        await withEnv(
            {
                AUDIT_AGENT_TRIAGE_LLM_ENABLED: 'true',
                INFERENCE_GATEWAY_HOST: addr.host,
                INFERENCE_GATEWAY_PORT: String(addr.port),
                AUDIT_AGENT_LLM_TIMEOUT_MS: '5000',
            },
            async () => {
                const client = createAuditAgentTriageLlmClient();
                const out = await client.runTriage(
                    { kind: 'quick_audit', scope_json: { filePath: 'src/main.js' } },
                    { context: { mcp_tools: {}, runtime: {} }, findings: [] }
                );
                assert.equal(out.ok, true);
                assert.deepEqual(hits, ['preflight', 'generate']);
                assert.equal(out.parsed?.summary, 'triaged');
                assert.equal(out.preflight?.ok, true);
            }
        );
    } finally {
        await /** @type {Promise<void>} */ (new Promise(resolve => server.close(() => resolve())));
    }
});

test('triage_llm skips with explicit reason when preflight rejects route', async () => {
    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url || '/', 'http://localhost');
        if (req.method === 'POST' && url.pathname === '/v1/validate/generate') {
            res.statusCode = 400;
            res.setHeader('content-type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ ok: false, reason: 'model not allowed' }));
            return;
        }
        res.statusCode = 500;
        res.end('unexpected');
    });
    const addr = await listen(server);
    try {
        await withEnv(
            {
                AUDIT_AGENT_TRIAGE_LLM_ENABLED: 'true',
                INFERENCE_GATEWAY_HOST: addr.host,
                INFERENCE_GATEWAY_PORT: String(addr.port),
                AUDIT_AGENT_LLM_TIMEOUT_MS: '5000',
            },
            async () => {
                const client = createAuditAgentTriageLlmClient();
                const out = await client.runTriage(
                    { kind: 'quick_audit', scope_json: {} },
                    { context: {}, findings: [] }
                );
                assert.equal(out.ok, false);
                assert.equal(out.skipped, true);
                assert.equal(out.error, 'inference_gateway_preflight_failed');
            }
        );
    } finally {
        await /** @type {Promise<void>} */ (new Promise(resolve => server.close(() => resolve())));
    }
});
