import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { ToolRegistry } from '../../../src/integration/tool-registry.mjs';
import { registerUpstreams, shutdownUpstreams } from '../../../src/integration/mcp/upstream-manager.mjs';

test('imports tools from stdio upstream (SDK) and proxies calls', async () => {
    const registry = new ToolRegistry();

    const fixturePath = path.resolve(process.cwd(), 'tests/fixtures/mcp/stdio-server.mjs');
    const env = {
        MCP_UPSTREAMS_JSON: JSON.stringify([
            {
                alias: 'fixture',
                transport: 'stdio',
                command: process.execPath,
                args: [fixturePath],
                toolPrefix: 'mcp_fixture__',
            },
        ]),
        MCP_UPSTREAM_REFRESH: 'true',
        MCP_UPSTREAM_INIT_TIMEOUT_MS: '15000',
        MCP_TOOL_TIMEOUT: '15000',
    };

    try {
        const st = await registerUpstreams(registry, { env });
        assert.equal(st.upstreams.length, 1);
        assert.equal(st.upstreams[0].alias, 'fixture');
        assert.equal(st.upstreams[0].ready, true);
        assert.ok(st.upstreams[0].registeredCount >= 2);

        assert.equal(registry.has('mcp_fixture__echo'), true);
        assert.equal(registry.has('mcp_fixture__add'), true);

        const echo = await registry.execute('mcp_fixture__echo', { message: 'hi' });
        assert.equal(echo?.content?.[0]?.text, 'hi');

        const add = await registry.execute('mcp_fixture__add', { a: 2, b: 3 });
        assert.equal(add?.content?.[0]?.text, '5');
    } finally {
        await shutdownUpstreams().catch(() => {});
    }
});
