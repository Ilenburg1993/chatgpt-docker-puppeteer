// @ts-check
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { createComposedMcpProcessHost } from '#copilot/mcp/public/composition/process-host';
import { createMcpToolOperationContext } from '#copilot/mcp/public/protocol/tools';

const TEST_WORKSPACE = createComposedMcpProcessHost({
    hostId: 'operation-context-test-host',
    backgroundServices: false,
}).workspace;

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
