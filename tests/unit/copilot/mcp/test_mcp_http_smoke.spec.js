// @ts-check
/**
 * Tests for the local Copilot MCP HTTP smoke helpers.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
    compareToolNames,
    extractMcpToolNames,
} from '../../../../src/copilot/mcp/scripts/smoke-http.js';

describe('copilot MCP local HTTP smoke helpers', () => {
    it('extracts tool names from a JSON-RPC tools/list body', () => {
        const names = extractMcpToolNames({
            jsonrpc: '2.0',
            id: 1,
            result: {
                tools: [{ name: 'repo_status' }, { name: 'mcp_runtime_health' }, { title: 'ignored' }],
            },
        });

        assert.deepEqual(names, ['mcp_runtime_health', 'repo_status']);
    });

    it('compares remote tool names with the local registry expectation', () => {
        const matched = compareToolNames(['a', 'b'], ['a', 'b']);
        assert.equal(matched.matches, true);

        const drift = compareToolNames(['a', 'extra'], ['a', 'b']);
        assert.equal(drift.matches, false);
        assert.deepEqual(drift.missingTools, ['b']);
        assert.deepEqual(drift.unexpectedTools, ['extra']);
    });
});
