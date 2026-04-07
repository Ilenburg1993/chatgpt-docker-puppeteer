// @ts-check
import assert from 'node:assert/strict';
import http from 'node:http';

import { createAuditAgentPatchAuthorLlmClient } from '../../../src/audit_agent/patch_author_llm.js';

async function listen(/** @type {any} */ server) {
    await /** @type {Promise<void>} */ (
        new Promise((resolve, reject) => {
            server.listen(0, '127.0.0.1', (/** @type {any} */ err) => (err ? reject(err) : resolve()));
        })
    );
    const addr = server.address();
    return { host: addr.address, port: addr.port };
}

function withEnv(/** @type {Record<string, any>} */ pairs, /** @type {() => any} */ fn) {
    const prev = /** @type {Record<string, string | undefined>} */ ({});
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

test('patch_author_llm performs preflight and returns normalized proposal', async () => {
    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url || '/', 'http://localhost');
        let body = '';
        for await (const chunk of req) body += String(chunk);
        const json = body ? JSON.parse(body) : {};
        res.setHeader('content-type', 'application/json; charset=utf-8');

        if (req.method === 'POST' && url.pathname === '/v1/validate/generate') {
            assert.equal(json.clientTag, 'audit_agent_patch');
            res.statusCode = 200;
            res.end(JSON.stringify({ ok: true, policy: { maxParallel: 1 }, ts: 100 }));
            return;
        }
        if (req.method === 'POST' && url.pathname === '/v1/generate') {
            assert.equal(json.clientTag, 'audit_agent_patch');
            res.statusCode = 200;
            res.end(
                JSON.stringify({
                    ok: true,
                    policy: { maxParallel: 1 },
                    result: {
                        response:
                            '{"summary":"ajustar guard","risk_level":"low","candidate_files":["src/audit_agent/runtime.js"],"proposed_changes":["adicionar check"]}',
                    },
                    ts: 200,
                }),
            );
            return;
        }
        res.statusCode = 404;
        res.end(JSON.stringify({ ok: false }));
    });
    const addr = await listen(server);
    try {
        await withEnv(
            {
                AUDIT_AGENT_PATCH_AUTHOR_LLM_ENABLED: 'true',
                INFERENCE_GATEWAY_HOST: addr.host,
                INFERENCE_GATEWAY_PORT: String(addr.port),
                AUDIT_AGENT_LLM_TIMEOUT_MS: '5000',
            },
            async () => {
                const client = createAuditAgentPatchAuthorLlmClient();
                const out = await client.runPatchAuthor(
                    { kind: 'patch_suggest', scope_json: { filePath: 'src/audit_agent/runtime.js' } },
                    { context: { mcp_tools: {} }, findings: [] },
                    { parsed: { summary: 'triage ok', risk_level: 'medium' } },
                );
                assert.equal(out.ok, true);
                assert.equal(out.patch_proposal?.approval_required, true);
                assert.equal(out.patch_proposal?.status, 'draft');
                assert.equal(out.patch_proposal?.patch_summary?.source, 'audit-agent-patch-llm');
                assert.deepEqual(out.patch_proposal?.patch_summary?.candidate_files, ['src/audit_agent/runtime.js']);
                assert.equal(out.validation?.shape_valid, true);
            },
        );
    } finally {
        await /** @type {Promise<void>} */ (new Promise((resolve) => server.close(() => resolve())));
    }
});

test('patch_author_llm tolerates non-JSON model response and emits fallback validation metadata', async () => {
    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url || '/', 'http://localhost');
        res.setHeader('content-type', 'application/json; charset=utf-8');
        if (req.method === 'POST' && url.pathname === '/v1/validate/generate') {
            res.statusCode = 200;
            res.end(JSON.stringify({ ok: true }));
            return;
        }
        if (req.method === 'POST' && url.pathname === '/v1/generate') {
            res.statusCode = 200;
            res.end(JSON.stringify({ ok: true, result: { response: 'texto livre sem json' } }));
            return;
        }
        res.statusCode = 404;
        res.end(JSON.stringify({ ok: false }));
    });
    const addr = await listen(server);
    try {
        await withEnv(
            {
                AUDIT_AGENT_PATCH_AUTHOR_LLM_ENABLED: 'true',
                INFERENCE_GATEWAY_HOST: addr.host,
                INFERENCE_GATEWAY_PORT: String(addr.port),
                AUDIT_AGENT_LLM_TIMEOUT_MS: '5000',
            },
            async () => {
                const client = createAuditAgentPatchAuthorLlmClient();
                const out = await client.runPatchAuthor(
                    { kind: 'patch_suggest', scope_json: {} },
                    { context: {}, findings: [] },
                    null,
                );
                assert.equal(out.ok, true);
                assert.equal(out.validation?.strict_shape_ok, false);
                assert.equal(out.patch_proposal?.patch_summary?.validation?.strict_shape_ok, false);
                assert.equal(Array.isArray(out.patch_proposal?.patch_summary?.candidate_files), true);
            },
        );
    } finally {
        await /** @type {Promise<void>} */ (new Promise((resolve) => server.close(() => resolve())));
    }
});

test('patch_author_llm fails when strict JSON mode is required and response shape is invalid', async () => {
    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url || '/', 'http://localhost');
        res.setHeader('content-type', 'application/json; charset=utf-8');
        if (req.method === 'POST' && url.pathname === '/v1/validate/generate') {
            res.statusCode = 200;
            res.end(JSON.stringify({ ok: true }));
            return;
        }
        if (req.method === 'POST' && url.pathname === '/v1/generate') {
            res.statusCode = 200;
            res.end(JSON.stringify({ ok: true, result: { response: '{"summary":"x"}' } }));
            return;
        }
        res.statusCode = 404;
        res.end(JSON.stringify({ ok: false }));
    });
    const addr = await listen(server);
    try {
        await withEnv(
            {
                AUDIT_AGENT_PATCH_AUTHOR_LLM_ENABLED: 'true',
                AUDIT_AGENT_PATCH_AUTHOR_REQUIRE_JSON: 'true',
                INFERENCE_GATEWAY_HOST: addr.host,
                INFERENCE_GATEWAY_PORT: String(addr.port),
                AUDIT_AGENT_LLM_TIMEOUT_MS: '5000',
            },
            async () => {
                const client = createAuditAgentPatchAuthorLlmClient();
                const out = await client.runPatchAuthor(
                    { kind: 'patch_suggest', scope_json: {} },
                    { context: {}, findings: [] },
                    null,
                );
                assert.equal(out.ok, false);
                assert.equal(out.error, 'patch_author_invalid_json_shape');
                assert.equal(out.details?.strict?.ok, false);
                assert.equal(Array.isArray(out.details?.strict?.errors), true);
            },
        );
    } finally {
        await /** @type {Promise<void>} */ (new Promise((resolve) => server.close(() => resolve())));
    }
});
