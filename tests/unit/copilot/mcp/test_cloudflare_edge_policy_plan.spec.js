import { describe, expect, it } from 'vitest';
import { buildCloudflareEdgePolicyPlan } from '#copilot/mcp/cloudflare';

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
        expect(result.mode).toBe('plan-only');
        expect(result.appliesChanges).toBe(false);
        expect(result.endpoint).toMatchObject({
            publicHostname: 'mcp.aurelin.org',
            publicMcpUrl: 'https://mcp.aurelin.org/mcp',
            zone: 'aurelin.org',
        });
        expect(result.desiredRulesets).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ phase: 'http_request_cache_settings' }),
                expect.objectContaining({ phase: 'http_ratelimit' }),
            ]),
        );
        const desiredRulesets = /** @type {{ name?: string; rules?: { expression?: string; rateLimitDraft?: Record<string, unknown> }[] }[]} */ (
            result.desiredRulesets
        );
        const anonymousRule = desiredRulesets
            .find((ruleset) => ruleset.name === 'MCP anonymous request protection')
            ?.rules?.[0];
        expect(anonymousRule?.expression).toContain('not any(http.request.headers.names[*] eq "authorization")');
        expect(anonymousRule?.rateLimitDraft).toMatchObject({
            periodSeconds: 10,
            requestsPerPeriod: 40,
            mitigationTimeoutSeconds: 10,
            equivalentPerMinute: 240,
            characteristics: ['cf.colo.id', 'ip.src'],
        });
    });
});
