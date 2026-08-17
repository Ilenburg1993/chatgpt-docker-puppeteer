// @ts-check
/**
 * Tests for the canonical Copilot MCP registry.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
    getCanonicalMcpToolSurfaceState,
    getCanonicalMcpTools,
    readMcpRegistryRuntimeState,
    resetCanonicalMcpToolsCacheForTests,
} from '#copilot/mcp';
import { getAdvertisedMcpToolNames } from '#copilot/mcp/tools';

describe('copilot MCP registry', () => {
    it('exposes the initial read-only tool surface', () => {
        const tools = getCanonicalMcpTools();
        const names = tools.map((tool) => tool.name).sort();

        assert.deepEqual(names, [
            'chatgpt_connector_current_url_status',
            'chatgpt_connector_profile',
            'chatgpt_connector_url_check',
            'claude_connector_profile',
            'copilot_session_get',
            'copilot_sessions_list',
            'delegate_to_repo_autonomy_runner',
            'fetch',
            'git_branch_info',
            'git_commit',
            'git_commit_plan',
            'git_diff',
            'git_log',
            'git_push',
            'git_push_plan',
            'git_stage',
            'git_stage_plan',
            'git_status',
            'job_cancel',
            'job_get_output',
            'job_get_summary',
            'job_list',
            'llmb_live_readiness',
            'llmb_live_runs',
            'llmb_live_test_cancel',
            'llmb_live_test_plan',
            'llmb_live_test_run',
            'mcp_apps_sdk_readiness',
            'mcp_auth_profile',
            'mcp_autonomy_power_score',
            'mcp_capabilities_summary',
            'mcp_cleanup_ai_artifacts',
            'mcp_cloudflare_config_audit',
            'mcp_cloudflare_edge_audit',
            'mcp_cloudflare_edge_backup_create',
            'mcp_cloudflare_edge_backups_list',
            'mcp_cloudflare_edge_policy_apply',
            'mcp_cloudflare_edge_policy_diff',
            'mcp_cloudflare_edge_policy_plan',
            'mcp_cloudflare_edge_snapshot',
            'mcp_cloudflare_mcp_passthrough_apply',
            'mcp_cloudflare_mcp_passthrough_diff',
            'mcp_cloudflare_mcp_passthrough_plan',
            'mcp_cloudflare_metrics_snapshot',
            'mcp_cloudflare_plan_capabilities_audit',
            'mcp_cloudflare_post_change_gates',
            'mcp_cloudflare_remote_audit',
            'mcp_cloudflare_skip_audit',
            'mcp_cloudflare_transport_benchmark_plan',
            'mcp_connection_readiness',
            'mcp_connector_smoke_refresh',
            'mcp_devcontainer_network_posture_audit',
            'mcp_golden_prompts',
            'mcp_host_block_diagnostics',
            'mcp_last_validation_summary',
            'mcp_latency_dashboard',
            'mcp_maintenance_apply_safe_fixes',
            'mcp_maintenance_plan',
            'mcp_oauth_friction_audit',
            'mcp_oauth_issuer_diagnostics',
            'mcp_post_restart_readiness',
            'mcp_reload_plan',
            'mcp_reload_schedule',
            'mcp_reload_status',
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
            'repo_apply_patch_batch',
            'repo_create_file',
            'repo_create_file_plan',
            'repo_diff_files',
            'repo_file_outline',
            'repo_file_stats',
            'repo_find_imports',
            'repo_find_orphan_imports',
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
            'repo_patch_batch_plan',
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
            'search',
        ]);
    });

    it('supports a safe Claude/research tool surface without write tools', () => {
        const tools = getCanonicalMcpTools({
            toolSurfacePolicy: { mode: 'safe', include: new Set(), exclude: new Set(), allowEmpty: false },
        });
        const names = new Set(tools.map((tool) => tool.name));

        assert.equal(names.has('mcp_latency_dashboard'), true);
        assert.equal(names.has('claude_connector_profile'), true);
        assert.equal(names.has('repo_read_file'), true);
        assert.equal(names.has('search'), true);
        assert.equal(names.has('fetch'), true);
        assert.equal(names.has('repo_apply_patch'), false);
        assert.equal(names.has('repo_create_file'), false);
        assert.equal(names.has('repo_remove_file'), false);
        assert.ok(tools.every((tool) => tool.annotations.destructiveHint !== true));
    });

    it.each(['full', 'latency', 'minimal', 'cloudflare', 'readonly', 'claude', 'safe', 'research'])(
        'keeps the %s tool surface non-empty, unique and within registry limits',
        (mode) => {
            const tools = getCanonicalMcpTools({
                toolSurfacePolicy: {
                    mode: /** @type {any} */ (mode),
                    include: new Set(),
                    exclude: new Set(),
                    allowEmpty: false,
                },
            });
            const names = tools.map((tool) => tool.name);
            assert.ok(names.length > 0);
            assert.equal(new Set(names).size, names.length);
            assert.ok(tools.every((tool) => tool.outputSchema && tool._meta));
        },
    );

    it('warns before the configured tool-count limit is exhausted', () => {
        const oldMax = process.env['COPILOT_MCP_REGISTRY_MAX_TOOLS'];
        const oldPercent = process.env['COPILOT_MCP_REGISTRY_TOOL_COUNT_WARN_PERCENT'];
        try {
            process.env['COPILOT_MCP_REGISTRY_MAX_TOOLS'] = '120';
            process.env['COPILOT_MCP_REGISTRY_TOOL_COUNT_WARN_PERCENT'] = '80';
            resetCanonicalMcpToolsCacheForTests();
            getCanonicalMcpTools();
            const state = getCanonicalMcpToolSurfaceState();
            const validation = /** @type {Record<string, unknown>} */ (
                /** @type {Record<string, unknown>} */ (state['registry'])['validation']
            );
            assert.ok(
                /** @type {string[]} */ (validation['warnings']).some((warning) =>
                    warning.includes('80% warning threshold'),
                ),
            );
        } finally {
            if (oldMax === undefined) delete process.env['COPILOT_MCP_REGISTRY_MAX_TOOLS'];
            else process.env['COPILOT_MCP_REGISTRY_MAX_TOOLS'] = oldMax;
            if (oldPercent === undefined) delete process.env['COPILOT_MCP_REGISTRY_TOOL_COUNT_WARN_PERCENT'];
            else process.env['COPILOT_MCP_REGISTRY_TOOL_COUNT_WARN_PERCENT'] = oldPercent;
            resetCanonicalMcpToolsCacheForTests();
        }
    });

    it('uses explicit annotations on every initial tool', () => {
        const tools = getCanonicalMcpTools();

        const expectedOpenWorld = new Set(['git_push_plan', 'git_push', 'llmb_live_test_run']);
        for (const tool of tools) {
            assert.equal(typeof tool.annotations.readOnlyHint, 'boolean', tool.name);
            assert.equal(tool.annotations.openWorldHint, expectedOpenWorld.has(tool.name), tool.name);
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

    it('uses human invocation status metadata instead of raw technical fallbacks', () => {
        const tools = getCanonicalMcpTools();

        for (const tool of tools) {
            const invoking = String(tool._meta?.['openai/toolInvocation/invoking'] ?? '');
            const invoked = String(tool._meta?.['openai/toolInvocation/invoked'] ?? '');
            assert.ok(invoking.length > 0 && invoking.length <= 64, `bad invoking status: ${tool.name}`);
            assert.ok(invoked.length > 0 && invoked.length <= 64, `bad invoked status: ${tool.name}`);
            assert.equal(invoking.startsWith('Running '), false, tool.name);
            assert.equal(invoked.startsWith('Finished '), false, tool.name);
        }

        const patch = tools.find((tool) => tool.name === 'repo_apply_patch');
        assert.equal(patch?._meta?.['openai/toolInvocation/invoking'], 'Aplicando patch...');
        assert.equal(patch?._meta?.['openai/toolInvocation/invoked'], 'OK');

        const connectorSmoke = tools.find((tool) => tool.name === 'mcp_connector_smoke_refresh');
        assert.equal(connectorSmoke?._meta?.['openai/toolInvocation/invoking'], 'Connector smoke refresh...');
        assert.equal(connectorSmoke?._meta?.['openai/toolInvocation/invoked'], 'OK');
    });

    it('does not expose duplicate tool names', () => {
        const tools = getCanonicalMcpTools();
        const names = tools.map((tool) => tool.name);
        assert.equal(new Set(names).size, names.length);
    });

    it('memoizes canonical tool metadata to reduce per-request tools/list overhead', () => {
        const first = getCanonicalMcpTools();
        const second = getCanonicalMcpTools();
        assert.equal(first, second);
    });

    it('exposes bounded rate-limit diagnostics without subjects or credentials', () => {
        const state = readMcpRegistryRuntimeState();

        assert.deepEqual(state, {
            toolInvocationBudgets: {
                size: 0,
                maxSize: 4096,
            },
        });
        assert.equal(JSON.stringify(state).includes('subject'), false);
        assert.equal(JSON.stringify(state).includes('token'), false);
    });

    it('keeps capability metadata in parity with the canonical registry', () => {
        const registryNames = getCanonicalMcpTools()
            .map((tool) => tool.name)
            .sort((left, right) => left.localeCompare(right));

        assert.deepEqual(getAdvertisedMcpToolNames(), registryNames);
    });
});
