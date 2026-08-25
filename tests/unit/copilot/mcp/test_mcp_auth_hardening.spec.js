// @ts-check
/**
 * Focused regression tests for MCP OAuth/auth hardening.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
    authorizeMcpToolCall,
    buildProtectedResourceMetadata,
    buildWwwAuthenticateChallenge,
    MCP_AUTH_SCOPES,
    parseBearerToken,
    readMcpAuthConfig,
    scopesForMcpTool,
    securitySchemesForMcpTool,
} from '#copilot/mcp/public/auth';
import { getCanonicalMcpTools } from '#copilot/mcp/public/registry';
import { resetMcpAuthRuntimeForTests } from '#copilot/testing/mcp/auth';

const canonicalTools = getCanonicalMcpTools();
const readTool = canonicalTools.find((tool) => tool.name === 'repo_read_file');
const writeTool = canonicalTools.find((tool) => tool.name === 'repo_apply_patch');
if (!readTool || !writeTool) throw new Error('Canonical auth-hardening tool fixtures are missing.');

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

    it('keeps maximum OAuth authority as the explicit default to avoid reauthorization round-trips', () => {
        const config = readMcpAuthConfig({
            COPILOT_MCP_AUTH_MODE: 'oauth',
            COPILOT_MCP_PUBLIC_URL: 'https://mcp.example.test/mcp',
        });

        assert.equal(config.mode, 'oauth');
        assert.equal(config.enforcement, 'all');
        assert.equal(config.resource, 'https://mcp.example.test');
        assert.equal(config.initialScopeProfile, 'max-autonomy');
        assert.equal(config.stepUpPreferred, false);
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

    it('supports least-privilege bootstrap and explicit custom scope profiles', () => {
        const leastPrivilege = readMcpAuthConfig({
            COPILOT_MCP_AUTH_MODE: 'oauth',
            COPILOT_MCP_PUBLIC_URL: 'https://mcp.example.test/mcp',
            COPILOT_MCP_OAUTH_INITIAL_SCOPE_PROFILE: 'least-privilege',
        });
        assert.equal(leastPrivilege.initialScopeProfile, 'least-privilege');
        assert.equal(leastPrivilege.stepUpPreferred, true);
        assert.deepEqual(leastPrivilege.initialScopes, [MCP_AUTH_SCOPES.read]);

        const custom = readMcpAuthConfig({
            COPILOT_MCP_AUTH_MODE: 'oauth',
            COPILOT_MCP_PUBLIC_URL: 'https://mcp.example.test/mcp',
            COPILOT_MCP_OAUTH_INITIAL_SCOPES: 'repo:read,repo:validate',
        });
        assert.equal(custom.initialScopeProfile, 'custom');
        assert.equal(custom.stepUpPreferred, false);
        assert.deepEqual(custom.initialScopes, [MCP_AUTH_SCOPES.read, MCP_AUTH_SCOPES.validate]);
    });

    it('sanitizes WWW-Authenticate challenge values without dropping required scopes', () => {
        const config = readMcpAuthConfig({ COPILOT_MCP_PUBLIC_URL: 'https://mcp.example.test' });
        const challenge = buildWwwAuthenticateChallenge([MCP_AUTH_SCOPES.read, MCP_AUTH_SCOPES.write], config, {
            error: 'invalid_token\nignored',
            errorDescription: 'bad token\r\nwith control chars',
        });

        assert.match(challenge, /^Bearer /u);
        assert.ok(
            challenge.includes('resource_metadata="https://mcp.example.test/.well-known/oauth-protected-resource"'),
        );
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
        const decision = await authorizeMcpToolCall(readTool, { bearerToken: 'local-static-token' }, config, {
            COPILOT_MCP_STATIC_BEARER_TOKEN: 'local-static-token',
            COPILOT_MCP_STATIC_BEARER_TOKEN_ENABLED: 'true',
        });

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
