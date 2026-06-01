import { describe, expect, it } from 'vitest';
import {
    buildCloudflareAnonymousMcpExpression,
    buildCloudflareCacheBypassRoutesExpression,
    buildCloudflareDynamicRoutesExpression,
    buildCloudflareMcpCompressionBypassExpression,
    buildCloudflareMcpPathExpression,
    buildCloudflareOAuthTokenExpression,
    buildCloudflarePublicMetadataCacheExpression,
} from '../../../../src/copilot/mcp/cloudflare/routes.js';

describe('mcp/cloudflare/routes', () => {
    it('matches the MCP endpoint exactly or under explicit MCP subroutes', () => {
        const expression = buildCloudflareMcpPathExpression();
        expect(expression).toBe('(http.request.uri.path eq "/mcp" or starts_with(http.request.uri.path, "/mcp/"))');
        expect(expression).not.toContain('starts_with(http.request.uri.path, "/mcp")');
    });

    it('builds canonical dynamic and protection expressions for one hostname', () => {
        expect(buildCloudflareDynamicRoutesExpression('mcp.example.test')).toContain('http.host eq "mcp.example.test"');
        expect(buildCloudflareDynamicRoutesExpression('mcp.example.test')).toContain('/.well-known/');
        expect(buildCloudflareDynamicRoutesExpression('mcp.example.test')).toContain('/chatgpt-connector.json');
        expect(buildCloudflareAnonymousMcpExpression('mcp.example.test')).toContain('not any(http.request.headers.names[*] eq "authorization")');
        expect(buildCloudflareOAuthTokenExpression('mcp.example.test')).toBe('(http.host eq "mcp.example.test" and http.request.uri.path eq "/oauth/token")');
    });

    it('separates dynamic cache bypass from public metadata cache candidates', () => {
        const bypass = buildCloudflareCacheBypassRoutesExpression('mcp.example.test');
        expect(bypass).toContain('http.request.uri.path eq "/mcp"');
        expect(bypass).toContain('/oauth/');
        expect(bypass).toContain('/health');
        expect(bypass).not.toContain('/.well-known/');
        expect(bypass).not.toContain('/chatgpt-connector.json');

        const metadata = buildCloudflarePublicMetadataCacheExpression('mcp.example.test');
        expect(metadata).toContain('http.request.method eq "GET"');
        expect(metadata).toContain('/.well-known/');
        expect(metadata).toContain('/chatgpt-connector.json');
        expect(metadata).not.toContain('/oauth/');
        expect(metadata).not.toContain('http.request.uri.path eq "/mcp"');
    });

    it('builds a scoped MCP-only compression bypass expression', () => {
        const expression = buildCloudflareMcpCompressionBypassExpression('mcp.example.test');
        expect(expression).toContain('http.host eq "mcp.example.test"');
        expect(expression).toContain('http.request.uri.path eq "/mcp"');
        expect(expression).toContain('starts_with(http.request.uri.path, "/mcp/")');
        expect(expression).not.toContain('/.well-known/');
        expect(expression).not.toContain('/oauth/');
    });
});
