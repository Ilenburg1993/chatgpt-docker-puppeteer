// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import sinon from 'sinon';
import * as contextBuilder from '../../../src/audit_agent/context_builder.js';

// the module exports several helpers used by the context builder;
// tests will manipulate them directly to simulate MCP responses and
// observe caching behaviour.

test('mcp lsp cache stores definition/references and avoids duplicate calls', async () => {
    // start with a clean cache every time
    contextBuilder._clearMcpLspCache();
    assert.equal(contextBuilder._getMcpLspCacheSize(), 0);

    const calls = [];
    const fakeResponse = {
        ok: true,
        status: 200,
        json: { result: { structuredContent: { data: {} } } },
    };

    const stub = sinon.stub().callsFake((name, args, opts) => {
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

    // no need to restore since stub is standalone function
});
