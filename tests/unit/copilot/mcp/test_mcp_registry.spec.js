// @ts-check
/**
 * Tests for the canonical Copilot MCP registry.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { getCanonicalMcpTools } from '../../../../src/copilot/mcp/registry.js';

describe('copilot MCP registry', () => {
    it('exposes the initial read-only tool surface', () => {
        const tools = getCanonicalMcpTools();
        const names = tools.map((tool) => tool.name).sort();

        assert.deepEqual(names, [
            'git_branch_info',
            'git_diff',
            'git_log',
            'git_status',
            'project_doctor',
            'repo_read_file',
            'repo_search_text',
            'repo_status',
            'repo_tree',
        ]);
    });

    it('uses required read-only annotations on every initial tool', () => {
        const tools = getCanonicalMcpTools();

        for (const tool of tools) {
            assert.equal(tool.annotations.readOnlyHint, true, tool.name);
            assert.equal(tool.annotations.openWorldHint, false, tool.name);
            assert.equal(tool.annotations.destructiveHint, false, tool.name);
        }
    });

    it('does not expose duplicate tool names', () => {
        const tools = getCanonicalMcpTools();
        const names = tools.map((tool) => tool.name);
        assert.equal(new Set(names).size, names.length);
    });
});

