// @ts-check
/**
 * Focused regression tests for MCP OAuth/auth hardening.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
    MCP_AUTH_SCOPES,
    authorizeMcpToolCall,
    buildProtectedResourceMetadata,
    buildWwwAuthenticateChallenge,
    parseBearerToken,
    readMcpAuthConfig,
    resetMcpAuthRuntimeForTests,
    scopesForMcpTool,
    securitySchemesForMcpTool,
} from '#copilot/mcp/control-plane';
import { getCanonicalMcpTools } from '#copilot/mcp';

/** @type {import('#copilot/mcp').McpToolDefinition} */
const readTool = {
    name: 'repo_read_file',
    title: 'Read file',
    description: 'Read a workspace file.',
    inputSchema: {},
    annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
    },
    handler: () => ({ content: [{ type: 'text', text: 'ok' }], structuredContent: {} }),
};

/** @type {import('#copilot/mcp').McpToolDefinition} */
const writeTool = {
    name: 'repo_apply_patch',
    title: 'Apply patch',
    description: 'Apply a bounded patch.',
    inputSchema: {},
    annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
    },
    handler: () => ({ content: [{ type: 'text', text: 'ok' }], structuredContent: {} }),
};

describe('MCP auth hardening', () => {
    it('parses only unambiguous bearer tokens', () => {
        assert.equal(parseBearerToken('Bearer abc.def.ghi'), 'abc.def.ghi');
        assert.equal(parseBearerToken('bearer token_value'), 'token_value');
        assert.equal(parseBearerToken(''), undefined);
        assert.equal(parseBearerToken('Basic token_value'), undefined);
        assert.equal(parseBearerToken('Bearer'), undefined);
        assert.equal(parseBearerToken('Bearer token value'), undefined);
        assert.equal(parseBearerToken(['Bearer first', 'Bearer second']), undefined);
    });

    it('keeps default OAuth grants max-power and stable for low-friction ChatGPT usage', () => {
        const config = readMcpAuthConfig({
            COPILOT_MCP_AUTH_MODE: 'oauth',
            COPILOT_MCP_PUBLIC_URL: 'https://mcp.example.test/mcp',
        });

        assert.equal(config.mode, 'oauth');
        assert.equal(config.enforcement, 'all');
        assert.equal(config.resource, 'https://mcp.example.test');
        assert.deepEqual(config.initialScopes, [
            MCP_AUTH_SCOPES.read,
            MCP_AUTH_SCOPES.write,
            MCP_AUTH_SCOPES.validate,
            MCP_AUTH_SCOPES.admin,
        ]);
        assert.deepEqual(config.acceptedAudiences, [
            'https://mcp.example.test',
            'https://mcp.example.test/',
            'https://mcp.example.test/mcp',
            'https://mcp.example.test/mcp/',
        ]);
    });

    it('sanitizes WWW-Authenticate challenge values without dropping required scopes', () => {
        const config = readMcpAuthConfig({ COPILOT_MCP_PUBLIC_URL: 'https://mcp.example.test' });
        const challenge = buildWwwAuthenticateChallenge([MCP_AUTH_SCOPES.read, MCP_AUTH_SCOPES.write], config, {
            error: 'invalid_token\nignored',
            errorDescription: 'bad token\r\nwith control chars',
        });

        assert.match(challenge, /^Bearer /u);
        assert.ok(challenge.includes('resource_metadata="https://mcp.example.test/.well-known/oauth-protected-resource"'));
        assert.ok(challenge.includes('scope="repo:read repo:write"'));
        assert.ok(!challenge.includes('\n'));
        assert.ok(!challenge.includes('\r'));
    });

    it('advertises noauth only for the public OAuth diagnostic in OAuth mode', () => {
        const config = readMcpAuthConfig({ COPILOT_MCP_AUTH_MODE: 'oauth' });
        const diagnostic = getCanonicalMcpTools().find((tool) => tool.name === 'mcp_oauth_friction_audit');
        assert.ok(diagnostic);
        const previous = process.env['COPILOT_MCP_PUBLIC_OAUTH_DIAGNOSTICS'];
        process.env['COPILOT_MCP_PUBLIC_OAUTH_DIAGNOSTICS'] = 'true';
        try {
            assert.deepEqual(
                securitySchemesForMcpTool(diagnostic, config).map((scheme) => scheme.type),
                ['noauth', 'oauth2'],
            );
        } finally {
            if (previous === undefined) delete process.env['COPILOT_MCP_PUBLIC_OAUTH_DIAGNOSTICS'];
            else process.env['COPILOT_MCP_PUBLIC_OAUTH_DIAGNOSTICS'] = previous;
        }
        assert.deepEqual(
            securitySchemesForMcpTool(readTool, config).map((scheme) => scheme.type),
            ['oauth2'],
        );
    });

    it('keeps read tools read-scoped and patch tools write-scoped', () => {
        assert.deepEqual(scopesForMcpTool(readTool), [MCP_AUTH_SCOPES.read]);
        assert.deepEqual(scopesForMcpTool(writeTool), [MCP_AUTH_SCOPES.write]);
    });

    it('keeps destructive and Cloudflare apply tools admin-scoped', () => {
        const removeTool = getCanonicalMcpTools().find((tool) => tool.name === 'repo_remove_file');
        const edgeApplyTool = getCanonicalMcpTools().find((tool) => tool.name === 'mcp_cloudflare_edge_policy_apply');
        assert.ok(removeTool);
        assert.ok(edgeApplyTool);
        assert.deepEqual(scopesForMcpTool(removeTool), [MCP_AUTH_SCOPES.admin]);
        assert.deepEqual(scopesForMcpTool(edgeApplyTool), [MCP_AUTH_SCOPES.admin]);
    });

    it('allows static bearer without a JWKS round-trip when configured', async () => {
        resetMcpAuthRuntimeForTests();
        const config = readMcpAuthConfig({
            COPILOT_MCP_AUTH_MODE: 'oauth',
            COPILOT_MCP_PUBLIC_URL: 'https://mcp.example.test',
            COPILOT_MCP_STATIC_BEARER_TOKEN: 'local-static-token',
            COPILOT_MCP_STATIC_BEARER_TOKEN_ENABLED: 'true',
        });
        const decision = await authorizeMcpToolCall(
            readTool,
            { bearerToken: 'local-static-token' },
            config,
            {
                COPILOT_MCP_STATIC_BEARER_TOKEN: 'local-static-token',
                COPILOT_MCP_STATIC_BEARER_TOKEN_ENABLED: 'true',
            },
        );

        assert.equal(decision.allowed, true);
        assert.equal(decision.method, 'static-bearer');
    });

    it('builds protected resource metadata from stable supported scopes', () => {
        const config = readMcpAuthConfig({ COPILOT_MCP_PUBLIC_URL: 'https://mcp.example.test' });
        const metadata = buildProtectedResourceMetadata(config);
        assert.deepEqual(metadata['authorization_servers'], ['https://mcp.example.test']);
        assert.deepEqual(metadata['scopes_supported'], [
            MCP_AUTH_SCOPES.read,
            MCP_AUTH_SCOPES.write,
            MCP_AUTH_SCOPES.validate,
            MCP_AUTH_SCOPES.admin,
        ]);
        assert.deepEqual(metadata['token_endpoint_auth_methods_supported'], ['none', 'private_key_jwt']);
    });
});
