// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';

import sinon from 'sinon';
import * as contextBuilder from '../../../src/audit_agent/context_builder.js';

// the module exports several helpers used by the context builder;
// tests will manipulate them directly to simulate MCP responses and
// observe caching behaviour.

test('mcp lsp cache stores definition/references and avoids duplicate calls', async () => {
    const previousLspEnabled = process.env['LSP_ENABLED'];
    process.env['LSP_ENABLED'] = 'true';
    // start with a clean cache every time
    contextBuilder._clearMcpLspCache();
    assert.equal(contextBuilder._getMcpLspCacheSize(), 0);

    /** @type {any[]} */ const calls = [];
    const fakeResponse = {
        ok: true,
        status: 200,
        json: { result: { structuredContent: { data: {} } } },
    };

    const stub = sinon.stub().callsFake((name, _args, _opts) => {
        calls.push(name);
        return Promise.resolve(fakeResponse);
    });

    const builder = contextBuilder.createAuditAgentContextBuilder({ callMcpTool: stub });
    const job = {
        scope_json: {
            filePath: 'src/foo.js',
            line: 10,
            character: 5,
            query: 'foo',
            mcp_budget: 5,
        },
    };

    try {
        // first invocation should populate the cache and exercise the tools
        await builder.collectMcpSemanticContext(job);
        assert(calls.includes('lsp_definition'), 'definition should be requested initially');
        assert(calls.includes('lsp_references'), 'references should be requested initially');
        // verify cache size increased (definition + references)
        assert.equal(contextBuilder._getMcpLspCacheSize(), 2);

        // clear the record of calls but keep cache
        calls.length = 0;

        // second invocation with identical job should reuse cached results
        await builder.collectMcpSemanticContext(job);
        assert(!calls.includes('lsp_definition'), 'definition should not be called again');
        assert(!calls.includes('lsp_references'), 'references should not be called again');
        // only diagnostics and rag_search may have been invoked again
        assert(calls.includes('lsp_diagnostics'), 'diagnostics still executed');
        assert(calls.includes('rag_search'), 'rag_search still executed');
        // cache size should remain unchanged
        assert.equal(contextBuilder._getMcpLspCacheSize(), 2);
    } finally {
        if (previousLspEnabled === undefined) delete process.env['LSP_ENABLED'];
        else process.env['LSP_ENABLED'] = previousLspEnabled;
    }

    // no need to restore since stub is standalone function
});

test('context builder não chama ferramentas LSP quando a política está desligada', async () => {
    const previousLspEnabled = process.env['LSP_ENABLED'];
    delete process.env['LSP_ENABLED'];
    /** @type {string[]} */
    const calls = [];
    const stub = sinon.stub().callsFake((name) => {
        calls.push(name);
        return Promise.resolve({
            ok: true,
            status: 200,
            json: { result: { structuredContent: { data: {} } } },
        });
    });
    try {
        const builder = contextBuilder.createAuditAgentContextBuilder({ callMcpTool: stub });
        const result = await builder.collectMcpSemanticContext({ scope_json: { filePath: 'src/foo.js' } });
        assert.deepEqual(calls, ['rag_search']);
        const diagnostics = /** @type {{ skipped?: boolean; disabled_by_policy?: boolean }} */ (
            result.tools['lsp_diagnostics']
        );
        assert.equal(diagnostics.skipped, true);
        assert.equal(diagnostics.disabled_by_policy, true);
    } finally {
        if (previousLspEnabled === undefined) delete process.env['LSP_ENABLED'];
        else process.env['LSP_ENABLED'] = previousLspEnabled;
    }
});
