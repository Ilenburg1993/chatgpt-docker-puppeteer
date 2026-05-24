// @ts-check
/**
 * Tests for the canonical Copilot MCP registry.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { getCanonicalMcpTools } from '../../../../src/copilot/mcp/registry.js';
import { getAdvertisedMcpToolNames } from '../../../../src/copilot/mcp/tools/meta.js';

describe('copilot MCP registry', () => {
    it('exposes the initial read-only tool surface', () => {
        const tools = getCanonicalMcpTools();
        const names = tools.map((tool) => tool.name).sort();

        assert.deepEqual(names, [
            'chatgpt_connector_current_url_status',
            'chatgpt_connector_profile',
            'chatgpt_connector_url_check',
            'copilot_session_get',
            'copilot_sessions_list',
            'delegate_to_repo_autonomy_runner',
            'git_branch_info',
            'git_diff',
            'git_log',
            'git_status',
            'job_cancel',
            'job_get_output',
            'job_get_summary',
            'job_list',
            'mcp_apps_sdk_readiness',
            'mcp_auth_profile',
            'mcp_autonomy_power_score',
            'mcp_capabilities_summary',
            'mcp_connector_smoke_refresh',
            'mcp_golden_prompts',
            'mcp_host_block_diagnostics',
            'mcp_last_validation_summary',
            'mcp_maintenance_apply_safe_fixes',
            'mcp_maintenance_plan',
            'mcp_oauth_friction_audit',
            'mcp_oauth_issuer_diagnostics',
            'mcp_post_restart_readiness',
            'mcp_run_safe_validation_suite',
            'mcp_runtime_health',
            'mcp_session_profile',
            'mcp_smoke_workspace',
            'mcp_tools_status',
            'mcp_tunnel_status',
            'mcp_validation_dashboard',
            'mcp_validation_plan',
            'project_doctor',
            'repo_apply_file_batch',
            'repo_apply_file_batch_plan',
            'repo_apply_patch',
            'repo_create_file',
            'repo_create_file_plan',
            'repo_diff_files',
            'repo_file_outline',
            'repo_file_stats',
            'repo_find_imports',
            'repo_find_symbol_usages',
            'repo_index_build',
            'repo_index_find_symbol',
            'repo_index_invalidate',
            'repo_index_refresh_plan',
            'repo_index_search',
            'repo_index_status',
            'repo_inspect_quarantined_file',
            'repo_list_quarantine',
            'repo_move_file',
            'repo_move_file_plan',
            'repo_patch_plan',
            'repo_quarantine_file',
            'repo_quarantine_file_plan',
            'repo_read_file',
            'repo_read_file_chunks',
            'repo_remove_file',
            'repo_restore_quarantined_file',
            'repo_root_redaction_status',
            'repo_root_tree',
            'repo_search_text',
            'repo_status',
            'repo_symbol_search',
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
            assert.equal(typeof tool.annotations.idempotentHint, 'boolean', tool.name);
            assert.equal(tool.annotations.idempotentHint, tool.annotations.readOnlyHint === true, tool.name);
        }
        assert.equal(tools.find((tool) => tool.name === 'repo_remove_file')?.annotations.destructiveHint, true);
    });

    it('adds registry-wide output schema and security metadata to every tool', () => {
        const tools = getCanonicalMcpTools();

        for (const tool of tools) {
            assert.ok(tool.outputSchema, `missing outputSchema: ${tool.name}`);
            assert.ok(tool._meta, `missing _meta: ${tool.name}`);
            assert.ok(Array.isArray(tool._meta?.['securitySchemes']), `missing securitySchemes: ${tool.name}`);
            const schemes = /** @type {{ type?: string }[]} */ (tool._meta?.['securitySchemes']);
            assert.ok(schemes.length > 0, `empty securitySchemes: ${tool.name}`);
            assert.ok(
                schemes.some((scheme) => scheme.type === 'oauth2'),
                `missing oauth2 scheme: ${tool.name}`,
            );
        }
    });

    it('does not expose duplicate tool names', () => {
        const tools = getCanonicalMcpTools();
        const names = tools.map((tool) => tool.name);
        assert.equal(new Set(names).size, names.length);
    });

    it('keeps capability metadata in parity with the canonical registry', () => {
        const registryNames = getCanonicalMcpTools()
            .map((tool) => tool.name)
            .sort((left, right) => left.localeCompare(right));

        assert.deepEqual(getAdvertisedMcpToolNames(), registryNames);
    });
});
