// @ts-check
/**
 * Tests for the canonical Copilot MCP registry.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
    MCP_TOOL_SURFACE_MODES,
    MCP_TOOL_SURFACE_POLICY_VERSION,
    createMcpToolSurfacePolicy,
    getCanonicalMcpToolSurfaceState,
    getCanonicalMcpTools,
    readMcpRegistryRuntimeState,
} from '#copilot/mcp/public/registry';
import { buildMcpWireToolCatalog, readMcpToolContractCoverage } from '#copilot/mcp/public/tools/catalog';
import {
    resetCanonicalMcpToolsCacheForTests,
    runToolHandlerWithCancellationForTests,
} from '#copilot/testing/mcp/registry';
import { getAdvertisedMcpToolNames } from '#copilot/testing/mcp/tools/capabilities';

/** @param {AbortController} controller */
function testOperationContext(controller) {
    return /** @type {import('#copilot/mcp/public/protocol/tools').McpToolOperationContext} */ (
        /** @type {unknown} */ ({
            signal: controller.signal,
            requestId: 'registry-cancellation-test',
            cancellationSource: () => (controller.signal.aborted ? 'caller' : null),
        })
    );
}

/**
 * @param {import('#copilot/mcp/public/protocol/catalog').McpToolExecutionContract} execution
 * @param {import('#copilot/mcp/public/protocol/catalog').McpToolDefinition['handler']} handler
 */
function testTool(execution, handler) {
    return /** @type {import('#copilot/mcp/public/protocol/catalog').McpToolDefinition} */ ({
        name: 'test_execution_contract',
        title: 'Test execution contract',
        description: 'Testing-only registry execution contract.',
        inputSchema: {},
        annotations: {},
        execution,
        handler,
    });
}

describe('copilot MCP registry', () => {
    it('builds the semantic wire catalog deterministically without hidden provider state', () => {
        const first = buildMcpWireToolCatalog();
        const second = buildMcpWireToolCatalog();
        const firstNames = first.map((tool) => tool.name);
        const secondNames = second.map((tool) => tool.name);

        assert.equal(first.length, 84);
        assert.equal(new Set(firstNames).size, first.length);
        assert.deepEqual(secondNames, firstNames);
        assert.notStrictEqual(second, first);
        assert.ok(first.every((tool, index) => tool !== second[index]));
        assert.ok(
            first.every(
                (tool) =>
                    Object.isFrozen(tool.contract) &&
                    Object.isFrozen(tool.contract.effects) &&
                    Object.isFrozen(tool.contract.authority) &&
                    Object.isFrozen(tool.contract.execution) &&
                    Object.isFrozen(tool.contract.output),
            ),
        );
    });

    it('exposes the initial read-only tool surface', () => {
        const tools = getCanonicalMcpTools();
        const names = tools.map((tool) => tool.name).sort();

        assert.deepEqual(names, [
            'copilot_sessions',
            'delegate_to_repo_autonomy_runner',
            'fetch',
            'git_branch_info',
            'git_commit',
            'git_diff',
            'git_log',
            'git_publish_changes',
            'git_push',
            'git_stage',
            'git_status',
            'job_cancel',
            'job_get_output',
            'job_get_summary',
            'llmb_live_readiness',
            'llmb_live_test_cancel',
            'llmb_live_test_plan',
            'llmb_live_test_run',
            'mcp_apps_sdk_readiness',
            'mcp_capabilities_summary',
            'mcp_cleanup_ai_artifacts',
            'mcp_client_latency_evidence',
            'mcp_cloudflare_edge_backup_create',
            'mcp_cloudflare_edge_backups_list',
            'mcp_cloudflare_edge_policy_apply',
            'mcp_cloudflare_edge_snapshot',
            'mcp_cloudflare_metrics_snapshot',
            'mcp_connection_readiness',
            'mcp_connector_smoke_refresh',
            'mcp_dependency_outdated',
            'mcp_dependency_upgrade',
            'mcp_devcontainer_network_control_plane_refresh',
            'mcp_devcontainer_network_posture_audit',
            'mcp_host_block_diagnostics',
            'mcp_latency_attribution',
            'mcp_latency_dashboard',
            'mcp_latency_pulse',
            'mcp_maintenance_apply_safe_fixes',
            'mcp_oauth_friction_audit',
            'mcp_oauth_issuer_diagnostics',
            'mcp_openai_endpoint_latency',
            'mcp_post_restart_readiness',
            'mcp_reload_schedule',
            'mcp_reload_status',
            'mcp_round_trip_analytics',
            'mcp_run_safe_validation_suite',
            'mcp_runtime_health',
            'mcp_smoke_workspace',
            'mcp_tool_payload_audit',
            'mcp_tunnel_status',
            'mcp_validation_dashboard',
            'project_doctor',
            'repo_apply_file_batch',
            'repo_apply_patch',
            'repo_apply_patch_batch',
            'repo_bulk_inspect',
            'repo_create_file',
            'repo_diff_files',
            'repo_file_outline',
            'repo_find_imports',
            'repo_find_orphan_imports',
            'repo_find_symbol_usages',
            'repo_index_build',
            'repo_index_search',
            'repo_index_status',
            'repo_move_file',
            'repo_quarantine_file',
            'repo_quarantine_status',
            'repo_read_file',
            'repo_read_file_chunks',
            'repo_remove_file',
            'repo_restore_quarantined_file',
            'repo_root_redaction_status',
            'repo_search_text',
            'repo_status',
            'repo_symbol_search',
            'repo_tree',
            'repo_working_set',
            'repo_write_file',
            'run_copilot_validator',
            'search',
            'terminal_exec',
            'terminal_session_control',
            'terminal_session_read',
        ]);
    });

    it('maps safe/claude aliases to one canonical research surface without write tools', () => {
        const safe = getCanonicalMcpTools({
            toolSurfacePolicy: createMcpToolSurfacePolicy({ mode: 'safe' }),
        });
        const safeState = getCanonicalMcpToolSurfaceState();
        const research = getCanonicalMcpTools({
            toolSurfacePolicy: createMcpToolSurfacePolicy({ mode: 'research' }),
        });
        const claude = getCanonicalMcpTools({
            toolSurfacePolicy: createMcpToolSurfacePolicy({ mode: 'claude' }),
        });
        const names = new Set(safe.map((tool) => tool.name));

        assert.deepEqual(
            safe.map((tool) => tool.name),
            research.map((tool) => tool.name),
        );
        assert.deepEqual(
            claude.map((tool) => tool.name),
            research.map((tool) => tool.name),
        );
        assert.equal(safeState['policyVersion'], MCP_TOOL_SURFACE_POLICY_VERSION);
        assert.equal(safeState['mode'], 'safe');
        assert.equal(safeState['canonicalProfile'], 'research');
        assert.equal(safeState['aliasOf'], 'research');
        assert.equal(safeState['selectionLifecycle'], 'process-generation-static');
        assert.equal(safeState['progressiveToolDiscovery'], false);
        assert.equal(safeState['defaultMode'], 'full');
        assert.equal(names.has('mcp_latency_attribution'), false);
        assert.equal(names.has('mcp_latency_dashboard'), true);
        assert.equal(names.has('mcp_connection_readiness'), true);
        assert.equal(names.has('repo_read_file'), true);
        assert.equal(names.has('search'), true);
        assert.equal(names.has('fetch'), true);
        assert.equal(names.has('repo_apply_patch'), false);
        assert.equal(names.has('repo_create_file'), false);
        assert.equal(names.has('repo_remove_file'), false);
        assert.ok(safe.every((tool) => tool.annotations.destructiveHint !== true));
    });

    it('keeps include/exclude overrides deterministic, diagnosable and safely reversible', () => {
        const policy = createMcpToolSurfacePolicy({
            mode: 'minimal',
            include: ['project_doctor', 'unknown_include'],
            exclude: ['mcp_latency_dashboard', 'project_doctor', 'unknown_exclude'],
        });
        const selected = getCanonicalMcpTools({ toolSurfacePolicy: policy });
        const names = new Set(selected.map((tool) => tool.name));
        assert.equal(names.has('repo_status'), true);
        assert.equal(names.has('mcp_latency_dashboard'), false);
        assert.equal(names.has('project_doctor'), false);
        assert.equal(names.has('unknown_include'), false);

        const state = getCanonicalMcpToolSurfaceState();
        assert.equal(state['mode'], 'minimal');
        assert.deepEqual(state['include'], ['project_doctor', 'unknown_include']);
        assert.deepEqual(state['exclude'], ['mcp_latency_dashboard', 'project_doctor', 'unknown_exclude']);
        assert.deepEqual(state['unknownInclude'], ['unknown_include']);
        assert.deepEqual(state['unknownExclude'], ['unknown_exclude']);
        assert.equal(state['allowEmpty'], false);
    });

    it('fails fast on an accidental empty projection and permits zero tools only by explicit opt-in', () => {
        const minimal = getCanonicalMcpTools({ toolSurfacePolicy: createMcpToolSurfacePolicy({ mode: 'minimal' }) });
        const minimalNames = minimal.map((tool) => tool.name);

        const accidentalEmpty = createMcpToolSurfacePolicy({
            mode: 'minimal',
            exclude: minimalNames,
        });
        assert.throws(() => getCanonicalMcpTools({ toolSurfacePolicy: accidentalEmpty }), /resolved to zero tools/u);

        const explicitEmpty = createMcpToolSurfacePolicy({
            mode: 'minimal',
            exclude: minimalNames,
            allowEmpty: true,
        });
        assert.deepEqual(getCanonicalMcpTools({ toolSurfacePolicy: explicitEmpty }), []);
        assert.equal(getCanonicalMcpToolSurfaceState()['selectedTools'], 0);
        assert.equal(getCanonicalMcpToolSurfaceState()['allowEmpty'], true);
        assert.equal(getCanonicalMcpToolSurfaceState()['canonicalProfile'], 'minimal');
    });

    it.each(MCP_TOOL_SURFACE_MODES)(
        'keeps the %s tool surface non-empty, unique and within registry limits',
        (mode) => {
            const tools = getCanonicalMcpTools({
                toolSurfacePolicy: createMcpToolSurfacePolicy({ mode }),
            });
            const names = tools.map((tool) => tool.name);
            assert.ok(names.length > 0);
            assert.equal(new Set(names).size, names.length);
            assert.ok(
                tools.every(
                    (tool) =>
                        tool._meta &&
                        Array.isArray(tool._meta['securitySchemes']) &&
                        tool._meta['securitySchemes'].length > 0,
                ),
            );
        },
    );

    it('keeps the latency surface operationally coherent with the observed high-use workspace primitives', () => {
        const full = getCanonicalMcpTools({ toolSurfacePolicy: createMcpToolSurfacePolicy({ mode: 'full' }) });
        const latency = getCanonicalMcpTools({ toolSurfacePolicy: createMcpToolSurfacePolicy({ mode: 'latency' }) });
        const names = new Set(latency.map((tool) => tool.name));
        for (const name of [
            'terminal_exec',
            'terminal_session_control',
            'terminal_session_read',
            'repo_bulk_inspect',
            'repo_apply_patch_batch',
            'repo_apply_file_batch',
            'repo_working_set',
            'repo_index_status',
            'repo_write_file',
            'repo_remove_file',
        ]) {
            assert.equal(names.has(name), true, name);
        }
        assert.ok(latency.length < full.length);
        assert.equal(latency.length, 51);
    });

    it('warns before the configured tool-count limit is exhausted', () => {
        const oldMax = process.env['COPILOT_MCP_REGISTRY_MAX_TOOLS'];
        const oldPercent = process.env['COPILOT_MCP_REGISTRY_TOOL_COUNT_WARN_PERCENT'];
        try {
            process.env['COPILOT_MCP_REGISTRY_MAX_TOOLS'] = '105';
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

        const expectedOpenWorld = new Set([
            'git_push',
            'git_publish_changes',
            'llmb_live_test_run',
            'mcp_dependency_outdated',
            'mcp_dependency_upgrade',
            'mcp_latency_attribution',
            'mcp_openai_endpoint_latency',
            'terminal_exec',
            'terminal_session_control',
        ]);
        const statefulReadOnly = new Set(['repo_working_set']);
        for (const tool of tools) {
            assert.equal(typeof tool.annotations.readOnlyHint, 'boolean', tool.name);
            assert.equal(tool.annotations.openWorldHint, expectedOpenWorld.has(tool.name), tool.name);
            assert.equal(typeof tool.annotations.destructiveHint, 'boolean', tool.name);
            assert.equal(typeof tool.annotations.idempotentHint, 'boolean', tool.name);
            assert.equal(
                tool.annotations.idempotentHint,
                tool.annotations.readOnlyHint === true && !statefulReadOnly.has(tool.name),
                tool.name,
            );
        }
        assert.equal(tools.find((tool) => tool.name === 'repo_remove_file')?.annotations.destructiveHint, true);
        assert.equal(tools.find((tool) => tool.name === 'terminal_exec')?.maxResultBytes, 40 * 1024 * 1024);
        assert.equal(tools.find((tool) => tool.name === 'terminal_session_read')?.maxResultBytes, 12 * 1024 * 1024);
    });

    it('keeps security metadata registry-wide and publishes only explicit specific output schemas', () => {
        const tools = getCanonicalMcpTools();
        const outputSchemaTools = tools
            .filter((tool) => tool.outputSchema !== undefined)
            .map((tool) => tool.name)
            .sort();
        assert.ok(outputSchemaTools.length > 0);
        assert.ok(outputSchemaTools.length < tools.length);
        for (const name of ['fetch', 'search', 'repo_status', 'git_status', 'git_diff', 'git_log', 'git_branch_info']) {
            assert.equal(outputSchemaTools.includes(name), true, `missing specific output schema: ${name}`);
        }

        for (const tool of tools) {
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

    it('classifies every canonical tool with an explicit execution contract', () => {
        const tools = getCanonicalMcpTools();
        const coverage = readMcpToolContractCoverage();
        assert.deepEqual(coverage, {
            total: 84,
            readOnly: 51,
            boundedWrite: 25,
            destructive: 8,
            openWorld: 9,
            idempotent: 50,
            scopes: { read: 51, write: 19, validate: 2, admin: 12 },
            cancellation: { cancellable: 23, boundedNonCancellable: 56, notApplicable: 5 },
            output: { specific: 10, intentionalUntyped: 74 },
        });
        assert.equal(tools.length, coverage.total);
        for (const tool of tools) {
            assert.ok(tool.execution, `missing execution contract: ${tool.name}`);
            assert.ok(tool.execution.rationale.length >= 20, `weak execution rationale: ${tool.name}`);
            if (tool.execution.cancellation === 'cancellable') {
                assert.ok(Number(tool.execution.drainTimeoutMs) >= 100, tool.name);
            } else if (tool.execution.cancellation === 'bounded-non-cancellable') {
                assert.ok(Number(tool.execution.continuationBoundMs) >= 100, tool.name);
            }
        }
    });

    it('keeps consolidated connection readiness local while issuer diagnostics retain external authority', () => {
        const tools = getCanonicalMcpTools();
        const readiness = tools.find((tool) => tool.name === 'mcp_connection_readiness');
        const issuer = tools.find((tool) => tool.name === 'mcp_oauth_issuer_diagnostics');
        assert.ok(readiness);
        assert.ok(issuer);
        assert.equal(readiness.contract.authority.network, 'local');
        assert.equal(issuer.contract.authority.network, 'fixed-external');
    });

    it('pins terminal_session_read as cancellable after event-driven long-poll rollout', () => {
        const tool = getCanonicalMcpTools().find((item) => item.name === 'terminal_session_read');
        assert.ok(tool?.execution);
        assert.equal(tool.execution.cancellation, 'cancellable');
        assert.equal(tool.execution.drainTimeoutMs, 1_000);
        assert.match(tool.execution.rationale, /event-driven/u);
        assert.match(tool.execution.rationale, /releases only the read waiter/u);
    });

    it('pins the combined LLM-B read owner cancellation rationale on llmb_live_readiness', () => {
        const tools = getCanonicalMcpTools();
        const readiness = tools.find((tool) => tool.name === 'llmb_live_readiness');
        assert.ok(readiness?.execution);
        assert.match(readiness.execution.rationale, /call-scoped subprocess/u);
        assert.match(readiness.execution.rationale, /settles only after owned child close/u);
    });

    it('does not invoke a handler when cancellation already happened', async () => {
        const controller = new AbortController();
        controller.abort(new Error('pre-abort'));
        let invoked = false;
        const tool = testTool(
            {
                cancellation: 'cancellable',
                drainTimeoutMs: 500,
                rationale: 'Testing contract propagates cancellation and drains all call-scoped work.',
            },
            async () => {
                invoked = true;
                return /** @type {any} */ ({ content: [] });
            },
        );
        await assert.rejects(
            runToolHandlerWithCancellationForTests(tool, {}, testOperationContext(controller)),
            (error) => {
                const failure = /** @type {any} */ (error);
                assert.equal(failure.code, 'MCP_TOOL_CANCELLED');
                assert.equal(failure.executionPolicy, 'cancellable');
                assert.equal(failure.workMayContinue, false);
                return true;
            },
        );
        assert.equal(invoked, false);
    });

    it('waits for cooperative handler drain before reporting cancellation', async () => {
        const controller = new AbortController();
        /** @type {() => void} */
        let markStarted = () => {};
        const started = new Promise((resolve) => {
            markStarted = () => resolve(undefined);
        });
        let cleaned = false;
        const tool = testTool(
            {
                cancellation: 'cancellable',
                drainTimeoutMs: 500,
                rationale: 'Testing contract propagates cancellation and drains all call-scoped work.',
            },
            async (_args, operationContext) => {
                markStarted();
                await new Promise((resolve) => {
                    operationContext?.signal.addEventListener(
                        'abort',
                        () => {
                            setTimeout(() => {
                                cleaned = true;
                                resolve(undefined);
                            }, 40).unref();
                        },
                        { once: true },
                    );
                });
                return /** @type {any} */ ({ content: [] });
            },
        );
        const pending = runToolHandlerWithCancellationForTests(tool, {}, testOperationContext(controller));
        await started;
        controller.abort(new Error('cancel-and-drain'));
        await assert.rejects(pending, (error) => {
            const failure = /** @type {any} */ (error);
            assert.equal(failure.code, 'MCP_TOOL_CANCELLED');
            assert.equal(failure.workMayContinue, false);
            return true;
        });
        assert.equal(cleaned, true);
    });

    it('fails loudly when a tool claiming cancellable does not drain', async () => {
        const controller = new AbortController();
        /** @type {() => void} */
        let markStarted = () => {};
        const started = new Promise((resolve) => {
            markStarted = () => resolve(undefined);
        });
        const tool = testTool(
            {
                cancellation: 'cancellable',
                drainTimeoutMs: 100,
                rationale: 'Testing contract intentionally violates drain to prove fail-loud registry behavior.',
            },
            async () => {
                markStarted();
                await new Promise(() => {});
                return /** @type {any} */ ({ content: [] });
            },
        );
        const pending = runToolHandlerWithCancellationForTests(tool, {}, testOperationContext(controller));
        await started;
        controller.abort(new Error('broken-drain'));
        await assert.rejects(pending, (error) => {
            const failure = /** @type {any} */ (error);
            assert.equal(failure.code, 'MCP_TOOL_CANCELLATION_DRAIN_TIMEOUT');
            assert.equal(failure.executionPolicy, 'cancellable');
            assert.equal(failure.drainTimeoutMs, 100);
            assert.equal(failure.tool, 'test_execution_contract');
            return true;
        });
    });

    it('labels bounded non-cancellable cancellation as work that may continue', async () => {
        const controller = new AbortController();
        /** @type {() => void} */
        let markStarted = () => {};
        /** @type {() => void} */
        let markSettled = () => {};
        const started = new Promise((resolve) => {
            markStarted = () => resolve(undefined);
        });
        const settled = new Promise((resolve) => {
            markSettled = () => resolve(undefined);
        });
        let handlerSettled = false;
        const tool = testTool(
            {
                cancellation: 'bounded-non-cancellable',
                continuationBoundMs: 1_000,
                rationale: 'Testing contract is bounded but intentionally does not cooperate with caller cancellation.',
            },
            async () => {
                markStarted();
                await new Promise((resolve) => setTimeout(resolve, 60));
                handlerSettled = true;
                markSettled();
                return /** @type {any} */ ({ content: [] });
            },
        );
        const pending = runToolHandlerWithCancellationForTests(tool, {}, testOperationContext(controller));
        await started;
        controller.abort(new Error('bounded-cancel'));
        await assert.rejects(pending, (error) => {
            const failure = /** @type {any} */ (error);
            assert.equal(failure.code, 'MCP_TOOL_CANCELLED');
            assert.equal(failure.executionPolicy, 'bounded-non-cancellable');
            assert.equal(failure.workMayContinue, true);
            assert.equal(failure.continuationBoundMs, 1_000);
            return true;
        });
        assert.equal(handlerSettled, false);
        await settled;
        assert.equal(handlerSettled, true);
    });

    it('keeps capability metadata in parity with the canonical registry', () => {
        const registryNames = getCanonicalMcpTools()
            .map((tool) => tool.name)
            .sort((left, right) => left.localeCompare(right));

        assert.deepEqual(getAdvertisedMcpToolNames(), registryNames);
    });
});
