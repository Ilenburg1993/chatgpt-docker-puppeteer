import { applyCloudflareTunnelOriginPlan, buildCloudflareTunnelOriginPlan } from '#copilot/mcp/cloudflare';
import { describe, expect, it } from 'vitest';

const BASE_ENV = {
    CLOUDFLARE_API_TOKEN: 'cfat_test_token',
    CLOUDFLARE_ACCOUNT_ID: 'account-123',
    COPILOT_MCP_CLOUDFLARE_TUNNEL_ID: '0e81ae66-b74d-44db-87ba-73102826ffdf',
};

describe('mcp/cloudflare/tunnel-origin-plan', () => {
    it('plans the HTTPS/HTTP2 origin by default', async () => {
        const plan = /** @type {any} */ (await buildCloudflareTunnelOriginPlan({ env: BASE_ENV }));

        expect(plan.ok).toBe(true);
        expect(plan.rollout).toBe('https-http2-origin');
        expect(plan.desired.originService).toBe('https://127.0.0.1:3333');
        expect(plan.desired.originRequest.http2Origin).toBe(true);
        expect(plan.desired.originRequest.originServerName).toBe('mcp.aurelin.org');
        expect(plan.desired.ingress[0]).toMatchObject({
            hostname: 'mcp.aurelin.org',
            service: 'https://127.0.0.1:3333',
        });
    });

    it('plans HTTPS plus http2Origin for explicit H2 rollout', async () => {
        const plan = /** @type {any} */ (
            await buildCloudflareTunnelOriginPlan({
                env: {
                    ...BASE_ENV,
                    COPILOT_MCP_CLOUDFLARE_ORIGIN_URL: 'https://127.0.0.1:3333',
                    COPILOT_MCP_CLOUDFLARE_ORIGIN_SERVER_NAME: 'mcp.aurelin.org',
                    COPILOT_MCP_CLOUDFLARE_HTTP2_ORIGIN: 'true',
                },
            })
        );

        expect(plan.ok).toBe(true);
        expect(plan.rollout).toBe('https-http2-origin');
        expect(plan.desired.originService).toBe('https://127.0.0.1:3333');
        expect(plan.desired.originRequest.http2Origin).toBe(true);
        expect(plan.desired.originRequest.originServerName).toBe('mcp.aurelin.org');
        expect(plan.desired.ingress[0]).toMatchObject({
            hostname: 'mcp.aurelin.org',
            service: 'https://127.0.0.1:3333',
        });
    });

    it('blocks real apply by default', async () => {
        const report = /** @type {any} */ (
            await applyCloudflareTunnelOriginPlan({
                env: {
                    ...BASE_ENV,
                    COPILOT_MCP_CLOUDFLARE_ORIGIN_URL: 'https://127.0.0.1:3333',
                    COPILOT_MCP_CLOUDFLARE_ORIGIN_SERVER_NAME: 'mcp.aurelin.org',
                    COPILOT_MCP_CLOUDFLARE_HTTP2_ORIGIN: 'true',
                },
            })
        );

        expect(report.ok).toBe(true);
        expect(report.appliesChanges).toBe(false);
        expect(report.dryRun).toBe(true);
        expect(report.blockedReason).toContain('Dry-run only');
        expect(report.desired.originRequest.http2Origin).toBe(true);
    });

    it('keeps human-readable durations in the dry-run plan', async () => {
        const report = /** @type {any} */ (
            await applyCloudflareTunnelOriginPlan({
                env: {
                    ...BASE_ENV,
                    COPILOT_MCP_CLOUDFLARE_ORIGIN_URL: 'https://127.0.0.1:3333',
                    COPILOT_MCP_CLOUDFLARE_ORIGIN_SERVER_NAME: 'mcp.aurelin.org',
                    COPILOT_MCP_CLOUDFLARE_HTTP2_ORIGIN: 'true',
                },
            })
        );

        expect(report.desired.originRequest.connectTimeout).toBe('5s');
        expect(report.desired.originRequest.keepAliveTimeout).toBe('1m30s');
        expect(report.desired.originRequest.tcpKeepAlive).toBe('30s');
        expect(report.apiConfigPreview.ingress[0].originRequest.connectTimeout).toBe(5_000_000_000);
        expect(report.apiConfigPreview.ingress[0].originRequest.keepAliveTimeout).toBe(90_000_000_000);
        expect(report.apiConfigPreview.ingress[0].originRequest.tcpKeepAlive).toBe(30_000_000_000);
    });
});
