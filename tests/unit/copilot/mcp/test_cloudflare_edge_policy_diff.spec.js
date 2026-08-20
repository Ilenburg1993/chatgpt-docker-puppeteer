import { describe, expect, it } from 'vitest';
import { buildEdgePolicyDiff } from '#copilot/mcp/cloudflare';

const desired = {
    ok: true,
    endpoint: {
        publicHostname: 'mcp.aurelin.org',
        publicMcpUrl: 'https://mcp.aurelin.org/mcp',
        zone: 'aurelin.org',
    },
    desiredRulesets: [
        { name: 'MCP dynamic routes cache bypass', phase: 'http_request_cache_settings', rules: [] },
        { name: 'MCP OAuth token endpoint protection', phase: 'http_ratelimit', rules: [] },
        { name: 'MCP anonymous request protection', phase: 'http_ratelimit', rules: [] },
    ],
    nonInterferenceRules: [],
};

describe('mcp/cloudflare/edge-policy-diff', () => {
    it('reports missing cache and rate-limit rules as non-mutating diffs', () => {
        const result = buildEdgePolicyDiff(
            {
                ok: true,
                edgeAuditable: true,
                critical: [],
                warnings: [],
                permissionGaps: [],
                findings: {
                    cacheBypassCandidateCount: 0,
                    oauthTokenRateLimitCount: 0,
                    mcpRateLimitCount: 0,
                    blockingMcpRuleCount: 0,
                    hostWideChallengeRuleCount: 0,
                    sensitiveHeaderTransformCount: 0,
                },
            },
            desired,
        );

        expect(result.ok).toBe(true);
        expect(result['mode']).toBe('plan-only-diff');
        expect(result['appliesChanges']).toBe(false);
        expect(result['mutationReady']).toBe(true);
        expect(result['summary']).toMatchObject({ diffCount: 3, criticalDiffs: 0 });
        expect(result['diffs']).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ id: 'cache-bypass-missing', severity: 'warning' }),
                expect.objectContaining({ id: 'oauth-token-rate-limit-missing', severity: 'advisory' }),
                expect.objectContaining({
                    id: 'anonymous-mcp-rate-limit-mitigated-at-origin',
                    severity: 'informational',
                    status: 'mitigated',
                }),
            ]),
        );
    });

    it('marks WAF/challenge conflicts as critical', () => {
        const result = buildEdgePolicyDiff(
            {
                ok: false,
                edgeAuditable: true,
                critical: ['Detected WAF conflict.'],
                warnings: [],
                permissionGaps: [],
                findings: {
                    cacheBypassCandidateCount: 1,
                    oauthTokenRateLimitCount: 1,
                    mcpRateLimitCount: 1,
                    blockingMcpRuleCount: 1,
                    hostWideChallengeRuleCount: 0,
                    sensitiveHeaderTransformCount: 0,
                },
            },
            desired,
        );

        expect(result.ok).toBe(false);
        expect(result['mutationReady']).toBe(false);
        expect(result['diffs']).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ id: 'mcp-interactive-or-blocking-rule-present', severity: 'critical' }),
            ]),
        );
    });
});
