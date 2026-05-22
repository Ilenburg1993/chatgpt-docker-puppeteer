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
            'chatgpt_connector_profile',
            'chatgpt_connector_url_check',
            'git_branch_info',
            'git_diff',
            'git_log',
            'git_status',
            'job_cancel',
            'job_get_output',
            'project_doctor',
            'repo_apply_patch',
            'repo_create_file',
            'repo_move_file',
            'repo_read_file',
            'repo_remove_file',
            'repo_search_text',
            'repo_status',
            'repo_tree',
            'repo_write_file',
            'run_copilot_validator',
            'run_lint_copilot',
            'run_project_doctor',
            'run_typecheck_copilot',
            'run_unit_copilot',
        ]);
    });

    it('uses explicit annotations on every initial tool', () => {
        const tools = getCanonicalMcpTools();

        for (const tool of tools) {
            assert.equal(typeof tool.annotations.readOnlyHint, 'boolean', tool.name);
            assert.equal(tool.annotations.openWorldHint, false, tool.name);
            assert.equal(typeof tool.annotations.destructiveHint, 'boolean', tool.name);
        }
        assert.equal(tools.find((tool) => tool.name === 'repo_remove_file')?.annotations.destructiveHint, true);
    });

    it('does not expose duplicate tool names', () => {
        const tools = getCanonicalMcpTools();
        const names = tools.map((tool) => tool.name);
        assert.equal(new Set(names).size, names.length);
    });
});
