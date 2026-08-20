import { buildCloudflareEdgeSnapshotReport } from '#copilot/mcp/cloudflare';
import { describe, expect, it } from 'vitest';

describe('mcp/cloudflare/edge-snapshot', () => {
    it('builds a consolidated read-only snapshot for backup planning', () => {
        const result = buildCloudflareEdgeSnapshotReport(
            {
                ok: true,
                desired: { publicHostname: 'mcp.aurelin.org' },
                remote: { tunnel: { name: 'workspace-mcp-dev' } },
                dns: { checked: true, matchesExpectedTunnel: true },
                critical: [],
                warnings: [],
            },
            {
                ok: true,
                zone: { zoneName: 'aurelin.org' },
                rulesets: [],
                findings: { inspectedRulesets: 0 },
                critical: [],
                warnings: ['No explicit cache bypass rule was detected.'],
                permissionGaps: [],
            },
            {
                ok: true,
                mutationReady: true,
                endpoint: { publicMcpUrl: 'https://mcp.aurelin.org/mcp' },
                summary: { diffCount: 3, criticalDiffs: 0 },
                diffs: [{ id: 'cache-bypass-missing' }],
                recommendedSequence: ['Apply cache bypass before rate-limit rules.'],
            },
            new Date('2026-05-24T17:30:00.000Z'),
        );

        expect(result.ok).toBe(true);
        expect(result['mode']).toBe('read-only-snapshot');
        expect(result['appliesChanges']).toBe(false);
        expect(result['readiness']).toMatchObject({
            remoteTunnelOk: true,
            edgeAuditOk: true,
            edgeDiffOk: true,
            mutationReady: true,
            criticalCount: 0,
        });
        expect(result['suggestedFileName']).toBe('cloudflare-edge-snapshot-2026-05-24T17-30-00-000Z.json');
    });
});
