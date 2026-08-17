// @ts-check

import { describe, expect, it } from 'vitest';

import { summarizeMcpReloadState } from '../../../../src/copilot/mcp/control-plane/reload-state.js';
import { mcpReloadPlanTool } from '#copilot/mcp/tools';

describe('MCP reload state reconciliation', () => {
    it('reduces the normal post-reload workflow to one connector smoke call', async () => {
        const result = await mcpReloadPlanTool.handler({ profile: 'current', delayMs: 1200 });
        expect(result.isError).toBeUndefined();
        expect(result.structuredContent?.['expectedFollowUp']).toEqual(['mcp_connector_smoke_refresh']);
        expect(result.structuredContent?.['diagnosticFallback']).toEqual([
            'mcp_reload_status',
            'mcp_post_restart_readiness',
            'mcp_runtime_health',
        ]);
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
        const inFlight = summarizeMcpReloadState(
            { status: 'running', requestId: 'mcp-reload-running', profile: 'auto' },
            '2026-08-14T18:10:00.000Z',
        );
        expect(inFlight.inFlight).toBe(true);
        expect(inFlight.failed).toBe(false);
        expect(inFlight.reconciledWithConnectorSmoke).toBe(false);

        const failed = summarizeMcpReloadState(
            { status: 'completed', requestId: 'mcp-reload-failed', profile: 'h2', exitCode: 1, completedAt: Date.now() },
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
