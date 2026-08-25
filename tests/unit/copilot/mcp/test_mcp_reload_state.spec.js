// @ts-check

import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';

import { createComposedMcpProcessHost } from '#copilot/mcp/public/composition/process-host';
import { createMcpToolOperationContext } from '#copilot/mcp/public/protocol/tools';
import { summarizeMcpReloadState } from '#copilot/mcp/public/runtime/reload';
import {
    readMcpReloadProcessConfig,
    scheduleControlledMcpReloadWithDependencies,
} from '#copilot/testing/mcp/runtime/reload';
import { mcpReloadPlanTool } from '#copilot/testing/mcp/tools/reload';

const RELOAD_TEST_HOST = createComposedMcpProcessHost({ hostId: 'reload-state-test-host', backgroundServices: false });
function reloadOperationContext() {
    return createMcpToolOperationContext(
        { mcpReq: { id: 'reload-state-test', method: 'tools/call', signal: new AbortController().signal } },
        { workspace: RELOAD_TEST_HOST.workspace, config: RELOAD_TEST_HOST.processConfig.toolConfig },
    );
}

describe('MCP reload state reconciliation', () => {
    it('reduces the normal post-reload workflow to one connector smoke call', async () => {
        const result = await mcpReloadPlanTool.handler({ profile: 'current', delayMs: 1200 }, reloadOperationContext());
        expect(result.isError).toBeUndefined();
        expect(result.structuredContent?.['expectedFollowUp']).toEqual(['mcp_connector_smoke_refresh']);
        expect(result.structuredContent?.['diagnosticFallback']).toEqual([
            'mcp_reload_status',
            'mcp_post_restart_readiness',
            'mcp_runtime_health',
        ]);
    });

    it('drains a cancelled detached reload before persisting failed launch state', async () => {
        const controller = new AbortController();
        const emitter = new EventEmitter();
        const events = [];
        let unrefCalled = false;
        const child = Object.assign(emitter, {
            pid: 616161,
            kill(signal) {
                events.push(`kill:${String(signal)}`);
                queueMicrotask(() => emitter.emit('close', null, signal));
                return true;
            },
            unref() {
                unrefCalled = true;
            },
        });
        const workspace = {
            io: {
                writeFileAtomic: async (_path, content) => {
                    const state = JSON.parse(String(content));
                    events.push(`state:${String(state.status)}`);
                    return {};
                },
            },
        };
        const spawnChild = /** @type {typeof import('node:child_process').spawn} */ (
            /** @type {unknown} */ (
                () => {
                    queueMicrotask(() => {
                        controller.abort(new Error('cancel-reload-before-acceptance'));
                        emitter.emit('spawn');
                    });
                    return child;
                }
            )
        );
        const reloadConfig = readMcpReloadProcessConfig({ PATH: '/usr/bin:/bin', HOME: '/tmp' });

        await expect(
            scheduleControlledMcpReloadWithDependencies(
                {
                    workspace: /** @type {any} */ (workspace),
                    profile: 'quic',
                    delayMs: 1200,
                    reason: 'unit-cancellation',
                    runnerEnvironment: reloadConfig.runnerEnvironment,
                    signal: controller.signal,
                },
                {
                    createRequestUuid: () => '11111111-1111-4111-8111-111111111111',
                    spawnChild,
                },
            ),
        ).rejects.toThrow(/cancel-reload-before-acceptance/u);

        expect(events[0]).toBe('state:launching');
        expect(events.some((event) => event.startsWith('kill:'))).toBe(true);
        expect(events.at(-1)).toBe('state:failed');
        expect(unrefCalled).toBe(false);
    });

    it('requires connector smoke captured after the latest successful reload', () => {
        const completedAt = Date.parse('2026-08-14T18:00:00.000Z');
        const state = {
            status: 'completed',
            requestId: 'mcp-reload-test',
            profile: 'quic',
            exitCode: 0,
            completedAt,
        };

        const stale = summarizeMcpReloadState(state, '2026-08-14T17:59:59.000Z');
        expect(stale.completedSuccessfully).toBe(true);
        expect(stale.smokeAfterReload).toBe(false);
        expect(stale.reconciledWithConnectorSmoke).toBe(false);

        const fresh = summarizeMcpReloadState(state, '2026-08-14T18:00:01.000Z');
        expect(fresh.smokeAfterReload).toBe(true);
        expect(fresh.reconciledWithConnectorSmoke).toBe(true);
    });

    it('keeps in-flight and failed reloads non-reconciled', () => {
        const launching = summarizeMcpReloadState(
            { status: 'launching', requestId: 'mcp-reload-launching', profile: 'quic' },
            '2026-08-14T18:09:00.000Z',
        );
        expect(launching.inFlight).toBe(true);
        expect(launching.failed).toBe(false);
        expect(launching.reconciledWithConnectorSmoke).toBe(false);

        const inFlight = summarizeMcpReloadState(
            { status: 'running', requestId: 'mcp-reload-running', profile: 'auto' },
            '2026-08-14T18:10:00.000Z',
        );
        expect(inFlight.inFlight).toBe(true);
        expect(inFlight.failed).toBe(false);
        expect(inFlight.reconciledWithConnectorSmoke).toBe(false);

        const failed = summarizeMcpReloadState(
            {
                status: 'completed',
                requestId: 'mcp-reload-failed',
                profile: 'h2',
                exitCode: 1,
                completedAt: Date.now(),
            },
            new Date().toISOString(),
        );
        expect(failed.failed).toBe(true);
        expect(failed.completedSuccessfully).toBe(false);
        expect(failed.reconciledWithConnectorSmoke).toBe(false);
    });

    it('treats absence of reload state as no additional readiness barrier', () => {
        const summary = summarizeMcpReloadState(null, null);
        expect(summary.present).toBe(false);
        expect(summary.failed).toBe(false);
        expect(summary.reconciledWithConnectorSmoke).toBe(true);
    });
});
