// @ts-check
/**
 * Tests for ChatGPT connector profile helpers.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
    buildChatGptConnectorProfile,
    buildCloudflareTunnelRunbook,
    buildSecureTunnelRunbook,
    normalizeMcpUrl,
    validatePublicConnectorUrl,
} from '../../../../src/copilot/mcp/connection/profile.js';
import {
    authorizeMcpToolCall,
    buildProtectedResourceMetadata,
    buildWwwAuthenticateChallenge,
    normalizeMcpAuthEnforcement,
    normalizeMcpAuthMode,
    parseBearerToken,
    readMcpAuthConfig,
    scopesForMcpTool,
    securitySchemesForMcpTool,
} from '../../../../src/copilot/mcp/control-plane/auth.js';
import {
    buildBuiltInDevOAuthClientMetadata,
    buildBuiltInDevOAuthMetadata as buildDevOAuthServerMetadata,
    isBuiltInDevOAuthEnabled as isDevOAuthServerEnabled,
} from '../../../../src/copilot/mcp/control-plane/dev-oauth.js';
import { getCanonicalMcpTools } from '../../../../src/copilot/mcp/registry.js';

describe('copilot MCP ChatGPT connection profile', () => {
    it('normalizes connector URLs to /mcp', () => {
        assert.equal(normalizeMcpUrl('https://example.com'), 'https://example.com/mcp');
        assert.equal(normalizeMcpUrl('https://example.com/mcp'), 'https://example.com/mcp');
    });

    it('validates ChatGPT public connector URL requirements', () => {
        assert.deepEqual(validatePublicConnectorUrl('https://example.com/mcp'), { ok: true });
        assert.equal(validatePublicConnectorUrl('http://127.0.0.1:3333/mcp').ok, false);
    });

    it('builds canonical ChatGPT form fields and smoke prompts', () => {
        const profile = buildChatGptConnectorProfile({ publicMcpUrl: 'https://example.com/tunnel' });
        assert.equal(profile.name, 'Repo DevContainer MCP');
        assert.equal(profile.connectorUrl, 'https://example.com/tunnel/mcp');
        assert.equal(profile.authMode, 'oauth');
        assert.equal(profile.authReadiness.mode, 'oauth');
        assert.equal(profile.chatgptFormFields.mcpServerUrl, 'https://example.com/tunnel/mcp');
        assert.equal(profile.chatgptFormFields.authentication, 'OAuth');
        assert.ok(profile.description.includes('Dev Container'));
        assert.ok(profile.smokePrompts.some((prompt) => prompt.includes('repo_status')));
        assert.ok(profile.smokePrompts.some((prompt) => prompt.includes('lastSmokeOk')));
    });

    it('builds secure tunnel commands for HTTP and stdio profiles', () => {
        const runbook = buildSecureTunnelRunbook({ tunnelId: 'tunnel_test', localMcpUrl: 'http://127.0.0.1:3333' });
        assert.ok(runbook.httpTunnelCommands.join('\n').includes('--mcp-server-url http://127.0.0.1:3333/mcp'));
        assert.ok(runbook.stdioTunnelCommands.join('\n').includes('--mcp-command'));
        assert.equal(runbook.chatgptUrl, 'https://mcp.aurelin.org/mcp');
    });

    it('builds Cloudflare tunnel commands around the MCP origin root', () => {
        const runbook = buildCloudflareTunnelRunbook({
            publicMcpUrl: 'https://repo-mcp.example.com',
            originUrl: 'http://127.0.0.1:3333',
        });
        assert.equal(runbook.originUrl, 'http://127.0.0.1:3333');
        assert.equal(runbook.chatgptUrl, 'https://repo-mcp.example.com/mcp');
        assert.ok(runbook.quickTunnelCommands.includes('npm run copilot:mcp:cloudflare:quick'));
        assert.ok(runbook.quickTunnelCommands.includes('npm run copilot:mcp:cloudflare:smoke'));
        assert.ok(runbook.notes.some((note) => note.includes('domínio permanente')));
        assert.ok(runbook.notes.some((note) => note.includes('Quick Tunnel')));
        assert.ok(runbook.notes.some((note) => note.includes('origin HTTP raiz')));
    });

    it('builds OAuth protected resource metadata and challenge previews', () => {
        const config = readMcpAuthConfig({
            COPILOT_MCP_AUTH_MODE: 'mixed-auth',
            COPILOT_MCP_PUBLIC_URL: 'https://example.com/mcp',
            COPILOT_MCP_OAUTH_ISSUER: 'https://auth.example.com',
        });
        const metadata = buildProtectedResourceMetadata(config);
        assert.equal(config.mode, 'mixed-auth');
        assert.equal(metadata.resource, 'https://example.com');
        assert.deepEqual(metadata.authorization_servers, ['https://auth.example.com']);
        assert.deepEqual(metadata.scopes_supported, ['repo:read', 'repo:write', 'repo:validate', 'repo:admin']);
        assert.match(buildWwwAuthenticateChallenge(['repo:read'], config), /resource_metadata="https:\/\/example\.com/);
    });

    it('defaults OAuth to the built-in development issuer on the MCP resource', () => {
        const config = readMcpAuthConfig({
            COPILOT_MCP_PUBLIC_URL: 'https://mcp.aurelin.org/mcp',
        });
        assert.equal(config.mode, 'oauth');
        assert.equal(config.enforcement, 'all');
        assert.deepEqual(config.authorizationServers, ['https://mcp.aurelin.org']);
        assert.equal(config.expectedIssuer, 'https://mcp.aurelin.org');
        assert.equal(config.expectedAudience, 'https://mcp.aurelin.org');
        assert.equal(config.jwksUri, 'https://mcp.aurelin.org/oauth/jwks.json');
        assert.equal(isDevOAuthServerEnabled(config), true);
        const metadata = buildDevOAuthServerMetadata(config);
        assert.equal(metadata.issuer, 'https://mcp.aurelin.org');
        assert.equal(metadata.authorization_endpoint, 'https://mcp.aurelin.org/oauth/authorize');
        assert.equal(metadata.token_endpoint, 'https://mcp.aurelin.org/oauth/token');
        assert.equal(metadata.jwks_uri, 'https://mcp.aurelin.org/oauth/jwks.json');
        assert.equal(metadata.userinfo_endpoint, 'https://mcp.aurelin.org/oauth/userinfo');
        assert.equal(metadata.client_id_metadata_document_supported, true);
        assert.ok(/** @type {string[]} */ (metadata.grant_types_supported).includes('refresh_token'));
        assert.deepEqual(metadata.token_endpoint_auth_methods_supported, ['none']);
        assert.ok(/** @type {string[]} */ (metadata.scopes_supported).includes('openid'));
        assert.ok(/** @type {string[]} */ (metadata.claims_supported).includes('email'));
        assert.deepEqual(buildProtectedResourceMetadata(config).scopes_supported, [
            'repo:read',
            'repo:write',
            'repo:validate',
            'repo:admin',
        ]);
        const clientMetadata = buildBuiltInDevOAuthClientMetadata(config);
        assert.equal(clientMetadata.client_id, 'https://mcp.aurelin.org/.well-known/oauth-client/codex-smoke.json');
        assert.deepEqual(clientMetadata.redirect_uris, ['https://chatgpt.com/connector/oauth/codex-smoke']);
        assert.ok(/** @type {string[]} */ (clientMetadata.grant_types).includes('refresh_token'));
    });

    it('maps tool annotations to planned OAuth scopes and mixed security schemes', () => {
        assert.equal(normalizeMcpAuthMode('dev-mixed-auth'), 'mixed-auth');
        const tools = getCanonicalMcpTools();
        const readTool = tools.find((tool) => tool.name === 'repo_status');
        const writeTool = tools.find((tool) => tool.name === 'repo_apply_patch');
        assert.ok(readTool);
        assert.ok(writeTool);
        assert.deepEqual(scopesForMcpTool(readTool), ['repo:read']);
        assert.deepEqual(scopesForMcpTool(writeTool), ['repo:write']);
        const schemes = securitySchemesForMcpTool(writeTool, {
            mode: 'mixed-auth',
            resource: 'https://example.com',
            protectedResourceMetadataUrl: 'https://example.com/.well-known/oauth-protected-resource',
            authorizationServers: ['https://auth.example.com'],
            scopesSupported: ['repo:read', 'repo:write', 'repo:validate', 'repo:admin'],
            resourceDocumentation: 'https://example.com/docs',
        });
        assert.ok(schemes.some((scheme) => scheme.type === 'noauth'));
        assert.ok(schemes.some((scheme) => scheme.type === 'oauth2'));
    });

    it('keeps temporary tunnel auth enforcement off by default outside oauth mode', async () => {
        const tools = getCanonicalMcpTools();
        const writeTool = tools.find((tool) => tool.name === 'repo_apply_patch');
        assert.ok(writeTool);
        assert.equal(normalizeMcpAuthEnforcement(undefined, 'mixed-auth'), 'off');
        assert.equal(parseBearerToken('Bearer abc.def'), 'abc.def');
        const decision = await authorizeMcpToolCall(
            writeTool,
            { bearerToken: undefined },
            readMcpAuthConfig({
                COPILOT_MCP_AUTH_MODE: 'mixed-auth',
                COPILOT_MCP_PUBLIC_URL: 'https://example.com/mcp',
            }),
        );
        assert.equal(decision.allowed, true);
        assert.equal(decision.required, false);
    });

    it('requires scoped auth when enforcement is enabled and accepts configured static bearer token', async () => {
        const tools = getCanonicalMcpTools();
        const writeTool = tools.find((tool) => tool.name === 'repo_apply_patch');
        assert.ok(writeTool);
        const env = {
            COPILOT_MCP_AUTH_MODE: 'mixed-auth',
            COPILOT_MCP_AUTH_ENFORCEMENT: 'write',
            COPILOT_MCP_PUBLIC_URL: 'https://example.com/mcp',
            COPILOT_MCP_STATIC_BEARER_TOKEN: 'dev-token',
        };
        const config = readMcpAuthConfig(env);
        const missing = await authorizeMcpToolCall(writeTool, { bearerToken: undefined }, config, env);
        assert.equal(missing.allowed, false);
        assert.equal(missing.code, 'MCP_AUTH_REQUIRED');
        assert.match(String(missing.challenge ?? ''), /repo:write/);
        const accepted = await authorizeMcpToolCall(writeTool, { bearerToken: 'dev-token' }, config, env);
        assert.equal(accepted.allowed, true);
        assert.equal(accepted.method, 'static-bearer');
    });
});
