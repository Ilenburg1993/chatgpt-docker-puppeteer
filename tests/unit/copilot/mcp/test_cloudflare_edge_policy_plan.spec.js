import { buildCloudflareEdgePolicyPlan } from '#copilot/mcp/cloudflare';
import { describe, expect, it } from 'vitest';

describe('mcp/cloudflare/edge-policy-plan', () => {
    it('builds a plan-only desired Cloudflare edge policy for the permanent hostname', async () => {
        const result = await buildCloudflareEdgePolicyPlan({
            env: {
                COPILOT_MCP_CLOUDFLARE_PUBLIC_HOSTNAME: 'mcp.aurelin.org',
                COPILOT_MCP_CLOUDFLARE_ZONE: 'aurelin.org',
                COPILOT_MCP_CLOUDFLARE_PUBLIC_URL: 'https://mcp.aurelin.org/mcp',
            },
        });

        expect(result.ok).toBe(true);
        expect(result['mode']).toBe('plan-only');
        expect(result['appliesChanges']).toBe(false);
        expect(result['endpoint']).toMatchObject({
            publicHostname: 'mcp.aurelin.org',
            publicMcpUrl: 'https://mcp.aurelin.org/mcp',
            zone: 'aurelin.org',
        });
        expect(result['desiredRulesets']).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ phase: 'http_request_cache_settings' }),
                expect.objectContaining({ phase: 'http_ratelimit' }),
            ]),
        );
        const desiredRulesets =
            /** @type {{ name?: string; rules?: { expression?: string; rateLimitDraft?: Record<string, unknown> }[] }[]} */ (
                result['desiredRulesets']
            );
        const constrainedRule = desiredRulesets.find((ruleset) => ruleset.name === 'MCP constrained rate limit policy')
            ?.rules?.[0];
        expect(constrainedRule?.expression).toContain('/oauth/token');
        expect(constrainedRule?.expression).toContain('not any(http.request.headers.names[*] eq "authorization")');
        expect(constrainedRule?.rateLimitDraft).toMatchObject({
            periodSeconds: 10,
            requestsPerPeriod: 20,
            mitigationTimeoutSeconds: 10,
            equivalentPerMinute: 120,
            characteristics: ['cf.colo.id', 'ip.src'],
        });
    });
});
