// @ts-check
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { createComposedMcpProcessHost } from '#copilot/mcp/public/composition/process-host';
import { createMcpToolOperationContext } from '#copilot/mcp/public/protocol/tools';

const TEST_PROCESS_HOST = createComposedMcpProcessHost({
    hostId: 'operation-context-test-host',
    backgroundServices: false,
});
const TEST_WORKSPACE = TEST_PROCESS_HOST.workspace;

/**
 * @param {{ signal?: AbortSignal; sessionId?: string; envelope?: Record<string, unknown> }} [options]
 */
function buildSdkRequestContext(options = {}) {
    return {
        ...(options.sessionId ? { sessionId: options.sessionId } : {}),
        mcpReq: {
            id: 42,
            method: 'tools/call',
            signal: options.signal ?? new AbortController().signal,
            _meta: { caller: 'test' },
            ...(options.envelope ? { envelope: options.envelope } : {}),
        },
    };
}

describe('MCP tool operation context', () => {
    it('preserves caller cancellation and request identity', () => {
        const controller = new AbortController();
        const context = createMcpToolOperationContext(
            buildSdkRequestContext({ signal: controller.signal, sessionId: 'session-1' }),
            { workspace: TEST_WORKSPACE, timeoutMs: 5_000 },
        );

        assert.equal(context.requestId, '42');
        assert.equal(context.method, 'tools/call');
        assert.equal(context.protocolEra, '2025');
        assert.equal(context.sessionId, 'session-1');
        assert.equal(context.workspace, TEST_WORKSPACE);
        assert.equal(context.cancellationSource(), null);

        controller.abort(new Error('caller cancelled'));

        assert.equal(context.signal.aborted, true);
        assert.equal(context.cancellationSource(), 'caller');
    });

    it('carries only the sanitized process config projection required by tools', () => {
        const toolSurface = Object.freeze({
            tools: Object.freeze([]),
            names: Object.freeze(['repo_status']),
        });
        const context = createMcpToolOperationContext(buildSdkRequestContext(), {
            workspace: TEST_WORKSPACE,
            config: TEST_PROCESS_HOST.processConfig.toolConfig,
            capabilities: { ...TEST_PROCESS_HOST.toolCapabilities, toolSurface },
        });

        assert.equal(context.capabilities.infraHealth, TEST_PROCESS_HOST.toolCapabilities.infraHealth);
        assert.equal(
            context.capabilities.modelGatewayLiveRuns,
            TEST_PROCESS_HOST.processConfig.toolCapabilities.modelGatewayLiveRuns,
        );
        assert.deepEqual(context.capabilities.toolSurface?.names, ['repo_status']);
        assert.equal(Object.isFrozen(context.capabilities.toolSurface ?? {}), true);
        assert.equal(Object.isFrozen(context.capabilities.toolSurface?.names ?? []), true);
        assert.equal(context.config.connection, TEST_PROCESS_HOST.processConfig.toolConfig.connection);
        assert.equal(context.config.cloudflare, TEST_PROCESS_HOST.processConfig.toolConfig.cloudflare);
        assert.equal(context.capabilities.cloudflare, TEST_PROCESS_HOST.processConfig.toolCapabilities.cloudflare);
        assert.equal(context.config.authConfig, TEST_PROCESS_HOST.processConfig.toolConfig.authConfig);
        assert.equal(context.config.authIssuer, TEST_PROCESS_HOST.processConfig.toolConfig.authIssuer);
        assert.equal(context.config.companyKnowledge, TEST_PROCESS_HOST.processConfig.toolConfig.companyKnowledge);
        assert.equal(
            context.config.devcontainerNetwork,
            TEST_PROCESS_HOST.processConfig.toolConfig.devcontainerNetwork,
        );
        assert.equal(context.config.ioCache, TEST_PROCESS_HOST.processConfig.toolConfig.ioCache);
        assert.equal(context.config.indexAutoBuild, TEST_PROCESS_HOST.processConfig.toolConfig.indexAutoBuild);
        assert.equal(context.config.latencyDashboard, TEST_PROCESS_HOST.processConfig.toolConfig.latencyDashboard);
        assert.equal(context.config.reload, TEST_PROCESS_HOST.processConfig.toolConfig.reload);
        assert.equal(
            context.config.runtimeSourceGeneration,
            TEST_PROCESS_HOST.processConfig.toolConfig.runtimeSourceGeneration,
        );
        assert.equal(context.config.toolPayload, TEST_PROCESS_HOST.processConfig.toolConfig.toolPayload);
        assert.equal(context.config.validation, TEST_PROCESS_HOST.processConfig.toolConfig.validation);
        assert.equal(
            context.config.repositoryReadCache,
            TEST_PROCESS_HOST.processConfig.toolConfig.repositoryReadCache,
        );
        assert.equal(context.config.terminal, TEST_PROCESS_HOST.processConfig.toolConfig.terminal);
        assert.equal(context.config.connection?.owner, TEST_PROCESS_HOST.processConfig.connection);
        assert.equal(Object.isFrozen(context.config), true);
        assert.equal(Object.isFrozen(context.capabilities), true);
        assert.equal(Object.isFrozen(context.capabilities.modelGatewayLiveRuns ?? {}), true);
        assert.equal('modelGatewayLiveRuns' in context.config, false);
        assert.equal(Object.isFrozen(context.config.connection ?? {}), true);
        assert.equal(Object.isFrozen(context.config.cloudflare ?? {}), true);
        assert.equal(Object.isFrozen(context.capabilities.cloudflare ?? {}), true);
        assert.equal(Object.isFrozen(context.config.authConfig ?? {}), true);
        assert.equal(Object.isFrozen(context.config.authIssuer ?? {}), true);
        assert.equal(Object.isFrozen(context.config.companyKnowledge ?? {}), true);
        assert.equal(Object.isFrozen(context.config.devcontainerNetwork ?? {}), true);
        assert.equal(Object.isFrozen(context.config.devcontainerNetwork?.childEnvironment ?? {}), true);
        assert.equal(Object.isFrozen(context.config.ioCache ?? {}), true);
        assert.equal(Object.isFrozen(context.config.indexAutoBuild ?? {}), true);
        assert.equal(Object.isFrozen(context.config.ioCache?.runnerEnvironment ?? {}), true);
        assert.equal(Object.isFrozen(context.config.latencyDashboard ?? {}), true);
        assert.equal(Object.isFrozen(context.config.reload ?? {}), true);
        assert.equal(Object.isFrozen(context.config.reload?.runnerEnvironment ?? {}), true);
        assert.equal(Object.isFrozen(context.config.runtimeSourceGeneration ?? {}), true);
        assert.equal(Object.isFrozen(context.config.toolPayload ?? {}), true);
        assert.equal(Object.isFrozen(context.config.validation ?? {}), true);
        assert.equal(Object.isFrozen(context.config.validation?.childEnvironment ?? {}), true);
        assert.equal(Object.isFrozen(context.config.repositoryReadCache ?? {}), true);
        assert.equal(Object.isFrozen(context.config.terminal ?? {}), true);
        assert.equal(Object.isFrozen(context.config.terminal?.operationalEnvironment ?? {}), true);
        assert.equal('secrets' in (context.config.connection?.owner.auth ?? {}), false);
        assert.equal('secrets' in (context.config.authIssuer ?? {}), false);
        assert.equal('secrets' in TEST_PROCESS_HOST.processConfig.auth, true);
    });

    it('classifies a local deadline independently from caller cancellation', async () => {
        const context = createMcpToolOperationContext(buildSdkRequestContext({ envelope: { protocol: '2026' } }), {
            workspace: TEST_WORKSPACE,
            timeoutMs: 10,
        });

        assert.equal(context.protocolEra, '2026');
        assert.ok((context.remainingBudgetMs() ?? 0) <= 10);

        await new Promise((resolve) => setTimeout(resolve, 25));

        assert.equal(context.signal.aborted, true);
        assert.equal(context.callerSignal.aborted, false);
        assert.equal(context.cancellationSource(), 'deadline');
        assert.equal(context.remainingBudgetMs(), 0);
    });
});
