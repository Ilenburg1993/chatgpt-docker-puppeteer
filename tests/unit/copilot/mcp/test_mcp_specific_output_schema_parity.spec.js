// @ts-check
/** Runtime parity between every specific MCP output schema and the structuredContent actually emitted by its handler. */

import assert from 'node:assert/strict';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { z } from 'zod';

import { createComposedMcpProcessHost } from '#copilot/mcp/public/composition/process-host';
import { createMcpToolOperationContext } from '#copilot/mcp/public/protocol/tools';
import { getCanonicalMcpTools } from '#copilot/mcp/public/registry';

const SPECIFIC_OUTPUT_TOOL_NAMES = Object.freeze([
    'fetch',
    'git_branch_info',
    'git_diff',
    'git_log',
    'git_status',
    'repo_status',
    'search',
    'terminal_exec',
    'terminal_session_control',
    'terminal_session_read',
]);

const PROCESS_HOST = createComposedMcpProcessHost({
    hostId: 'mcp-specific-output-parity-host',
    backgroundServices: false,
});
const WORKSPACE = PROCESS_HOST.workspace;
const TOOLS = Object.freeze(
    getCanonicalMcpTools({
        registryPolicy: PROCESS_HOST.processConfig.registry.policy,
        toolSurfacePolicy: PROCESS_HOST.processConfig.registry.surfacePolicy,
        authConfig: PROCESS_HOST.processConfig.auth.config,
    }),
);
const TOOL_SURFACE = Object.freeze({
    tools: TOOLS,
    names: Object.freeze(TOOLS.map((tool) => tool.name)),
});
const OPERATION_CONTEXT = createMcpToolOperationContext(
    {
        mcpReq: {
            id: 'mcp-specific-output-parity',
            method: 'tools/call',
            signal: new AbortController().signal,
            _meta: { caller: 'test_mcp_specific_output_schema_parity' },
            envelope: { protocol: '2026' },
        },
    },
    {
        workspace: WORKSPACE,
        config: PROCESS_HOST.processConfig.toolConfig,
        capabilities: Object.freeze({ ...PROCESS_HOST.toolCapabilities, toolSurface: TOOL_SURFACE }),
    },
);

/** @type {Awaited<ReturnType<typeof PROCESS_HOST.acquire>> | null} */
let hostLease = null;

beforeAll(async () => {
    hostLease = await PROCESS_HOST.acquire({ reason: 'mcp-specific-output-schema-parity' });
});

afterAll(async () => {
    await hostLease?.release();
    hostLease = null;
    await PROCESS_HOST.dispose();
});

/** @param {string} name */
function findTool(name) {
    const tool = TOOLS.find((candidate) => candidate.name === name);
    assert.ok(tool, `missing canonical tool ${name}`);
    return tool;
}

/** @param {unknown} schema */
function normalizeOutputSchema(schema) {
    assert.ok(schema && typeof schema === 'object', 'specific output schema must be an object');
    const candidate = /** @type {{ safeParse?: (value:unknown)=>{success:boolean;error?:unknown} }} */ (schema);
    if (typeof candidate.safeParse === 'function') return candidate;
    return z.object(/** @type {import('zod').ZodRawShape} */ (schema));
}

/** @param {string} name @param {unknown} input */
async function invokeAndAssertParity(name, input) {
    const tool = findTool(name);
    assert.ok(tool.outputSchema !== undefined, `${name} must publish a specific output schema`);
    const result = await tool.handler(input, OPERATION_CONTEXT);
    assert.equal(result.isError, undefined, `${name} returned MCP isError`);
    assert.ok(
        result.structuredContent && typeof result.structuredContent === 'object',
        `${name} missing structuredContent`,
    );
    const parsed = normalizeOutputSchema(tool.outputSchema).safeParse(result.structuredContent);
    assert.equal(
        parsed.success,
        true,
        `${name} structuredContent diverged from its published output schema: ${String(parsed.error ?? '')}`,
    );
    return result;
}

describe('MCP specific output-schema runtime parity', () => {
    it('keeps the specific-output contract set explicit and exhaustive', () => {
        const actual = TOOLS.filter((tool) => tool.outputSchema !== undefined)
            .map((tool) => tool.name)
            .sort();
        assert.deepEqual(actual, [...SPECIFIC_OUTPUT_TOOL_NAMES].sort());
    });

    it('validates repository and Git structuredContent against the exact published schemas', async () => {
        await invokeAndAssertParity('repo_status', {});
        await invokeAndAssertParity('git_status', {});
        await invokeAndAssertParity('git_diff', { staged: false });
        await invokeAndAssertParity('git_log', { limit: 3 });
        await invokeAndAssertParity('git_branch_info', {});
    });

    it('validates terminal one-shot, session-control and session-read payloads against their schemas', async () => {
        await invokeAndAssertParity('terminal_exec', {
            command: "printf 'specific-output-parity'",
            timeoutMs: 10_000,
        });
        await invokeAndAssertParity('terminal_session_read', { action: 'capabilities' });

        const opened = await invokeAndAssertParity('terminal_session_control', {
            action: 'open',
            command: "node -e 'setInterval(() => {}, 1000)'",
            backend: 'pipe',
        });
        const sessionId = String(
            opened.structuredContent?.['session']?.['id'] ?? opened.structuredContent?.['sessionId'] ?? '',
        );
        assert.ok(sessionId, 'terminal session-control parity fixture must expose a session id');
        try {
            await invokeAndAssertParity('terminal_session_control', { action: 'close', sessionId, graceMs: 500 });
        } finally {
            const forget = findTool('terminal_session_control');
            await forget.handler({ action: 'forget', sessionId }, OPERATION_CONTEXT);
        }
    });

    it('validates Company Knowledge search/fetch structuredContent against the exact published schemas', async () => {
        const search = await invokeAndAssertParity('search', { query: 'MCP OAuth workspace' });
        const results = /** @type {{id?:string}[]} */ (search.structuredContent?.['results'] ?? []);
        assert.ok(results.length > 0, 'Company Knowledge parity fixture requires at least one search result');
        const id = String(results[0]?.id ?? '');
        assert.ok(id.startsWith('repo:'), 'Company Knowledge search must return a fetchable repo id');
        await invokeAndAssertParity('fetch', { id });
    });
});
