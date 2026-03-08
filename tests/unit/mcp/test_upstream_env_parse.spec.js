// @ts-check
import assert from 'node:assert/strict';
import test from 'node:test';

import { parseUpstreamsFromEnv } from '../../../src/integration/mcp/upstream-manager.mjs';

test('parseUpstreamsFromEnv: invalid MCP_UPSTREAMS_JSON yields no upstreams', () => {
    const env = { MCP_UPSTREAMS_JSON: '[invalid-json' };
    const upstreams = parseUpstreamsFromEnv(env);
    assert.deepEqual(upstreams, []);
});

test('parseUpstreamsFromEnv: legacy single HTTP upstream works when enabled', () => {
    const env = {
        MCP_UPSTREAM_ENABLED: 'true',
        MCP_UPSTREAM_URL: 'http://localhost:4000/api/mcp',
        MCP_UPSTREAM_ALIAS: 'core',
        MCP_UPSTREAM_TOOL_PREFIX: 'mcp_core__',
    };
    const upstreams = parseUpstreamsFromEnv(env);
    assert.equal(upstreams.length, 1);
    const up0 = /** @type {any} */ (upstreams[0]);
    assert.equal(up0.alias, 'core');
    assert.equal(up0.transport, 'http');
});

test('parseUpstreamsFromEnv: GitHub proxy preset is appended when enabled', () => {
    const env = {
        MCP_UPSTREAM_ENABLED: 'false',
        MCP_GITHUB_PROXY_ENABLED: 'true',
        MCP_GITHUB_TOOL_PREFIX: 'mcp_github__',
    };
    const upstreams = parseUpstreamsFromEnv(env);
    assert.equal(upstreams.length, 1);
    const up0b = /** @type {any} */ (upstreams[0]);
    assert.equal(up0b.alias, 'github');
    assert.equal(up0b.transport, 'stdio');
    assert.equal(up0b.toolPrefix, 'mcp_github__');
});

test('parseUpstreamsFromEnv: MCP_UPSTREAMS_JSON takes precedence over legacy', () => {
    const env = {
        MCP_UPSTREAMS_JSON: JSON.stringify([
            { alias: 'core', transport: 'http', url: 'http://localhost:4000/api/mcp', toolPrefix: 'mcp_core__' },
        ]),
        MCP_UPSTREAM_ENABLED: 'true',
        MCP_UPSTREAM_URL: 'http://should-be-ignored/api/mcp',
    };
    const upstreams = parseUpstreamsFromEnv(env);
    assert.equal(upstreams.length, 1);
    const up0c = /** @type {any} */ (upstreams[0]);
    assert.equal(up0c.alias, 'core');
    assert.equal(up0c.url, 'http://localhost:4000/api/mcp');
});
