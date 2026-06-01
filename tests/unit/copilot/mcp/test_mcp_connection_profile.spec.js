// @ts-check
/**
 * Tests for ChatGPT connector profile helpers.
 */

import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'vitest';

import { startHttpMcpServer } from '#copilot/mcp/adapters';
import {
    buildChatGptConnectorProfile,
    buildCloudflareTunnelRunbook,
    buildSecureTunnelRunbook,
    normalizeMcpUrl,
    validatePublicConnectorUrl,
} from '#copilot/mcp/connection';
import {
    authorizeMcpToolCall,
    buildBuiltInDevOAuthClientMetadata,
    buildBuiltInDevOAuthMetadata as buildDevOAuthServerMetadata,
    buildProtectedResourceMetadata,
    buildWwwAuthenticateChallenge,
    isBuiltInDevOAuthEnabled as isDevOAuthServerEnabled,
    normalizeMcpAuthEnforcement,
    normalizeMcpAuthMode,
    parseBearerToken,
    readDevOAuthPersistenceStatus,
    readMcpAuthConfig,
    resetDevOAuthRuntimeForTests,
    scopesForMcpTool,
    securitySchemesForMcpTool,
} from '#copilot/mcp/control-plane';
import { getCanonicalMcpTools } from '#copilot/mcp';

describe('copilot MCP ChatGPT connection profile', () => {
    it('normalizes connector URLs to /mcp', () => {
        assert.equal(normalizeMcpUrl('https://example.com'), 'https://example.com/mcp');
        assert.equal(normalizeMcpUrl('https://example.com/mcp'), 'https://example.com/mcp');
    });

    it('validates ChatGPT public connector URL requirements', () => {
        assert.deepEqual(validatePublicConnectorUrl('https://example.com/mcp'), {
            ok: true,
            normalizedUrl: 'https://example.com/mcp',
            resource: 'https://example.com',
        });
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
        assert.ok(runbook.notes.some((note) => note.includes('origin raiz')));
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
        const schemes = securitySchemesForMcpTool(
            writeTool,
            readMcpAuthConfig({
                COPILOT_MCP_AUTH_MODE: 'mixed-auth',
                COPILOT_MCP_PUBLIC_URL: 'https://example.com/mcp',
                COPILOT_MCP_OAUTH_ISSUER: 'https://auth.example.com',
            }),
        );
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

    it('does not bypass auth for public OAuth diagnostics outside oauth mode', async () => {
        const tools = getCanonicalMcpTools();
        const diagnosticTool = tools.find((tool) => tool.name === 'mcp_oauth_friction_audit');
        assert.ok(diagnosticTool);
        const env = {
            COPILOT_MCP_AUTH_MODE: 'mixed-auth',
            COPILOT_MCP_AUTH_ENFORCEMENT: 'all',
            COPILOT_MCP_PUBLIC_URL: 'https://example.com/mcp',
            COPILOT_MCP_PUBLIC_OAUTH_DIAGNOSTICS: 'true',
        };
        const config = readMcpAuthConfig(env);
        const decision = await authorizeMcpToolCall(diagnosticTool, { bearerToken: undefined }, config, env);
        assert.equal(decision.allowed, false);
        assert.equal(decision.code, 'MCP_AUTH_REQUIRED');
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

    it('persists OAuth refresh-token rotation by hash across a logical restart', async () => {
        const tempDir = await mkdtemp(path.join(os.tmpdir(), 'copilot-mcp-oauth-'));
        const oldEnv = snapshotEnv([
            'COPILOT_MCP_AUTH_MODE',
            'COPILOT_MCP_AUTH_ENFORCEMENT',
            'COPILOT_MCP_PUBLIC_URL',
            'COPILOT_MCP_DEV_OAUTH_KEY_FILE',
            'COPILOT_MCP_DEV_OAUTH_REFRESH_TOKEN_FILE',
            'COPILOT_MCP_DEV_OAUTH_CLIENT_FILE',
            'COPILOT_MCP_ALLOWED_ORIGINS',
        ]);
        const server = await startHttpMcpServer({ host: '127.0.0.1', port: 0 });
        try {
            const address = server.address();
            assert.ok(address && typeof address === 'object');
            const resource = `http://127.0.0.1:${address.port}`;
            process.env['COPILOT_MCP_AUTH_MODE'] = 'oauth';
            process.env['COPILOT_MCP_AUTH_ENFORCEMENT'] = 'all';
            process.env['COPILOT_MCP_PUBLIC_URL'] = `${resource}/mcp`;
            process.env['COPILOT_MCP_DEV_OAUTH_KEY_FILE'] = path.join(tempDir, 'oauth-key.pem');
            process.env['COPILOT_MCP_DEV_OAUTH_REFRESH_TOKEN_FILE'] = path.join(tempDir, 'refresh-tokens.json');
            process.env['COPILOT_MCP_DEV_OAUTH_CLIENT_FILE'] = path.join(tempDir, 'oauth-clients.json');
            process.env['COPILOT_MCP_ALLOWED_ORIGINS'] = 'https://chatgpt.com,http://127.0.0.1';
            resetDevOAuthRuntimeForTests();

            const preflight = await fetch(`${resource}/.well-known/oauth-authorization-server`, {
                method: 'OPTIONS',
                headers: {
                    origin: 'https://chatgpt.com',
                    'access-control-request-method': 'GET',
                },
            });
            assert.equal(preflight.status, 204);
            assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://chatgpt.com');
            assert.match(String(preflight.headers.get('access-control-allow-headers') ?? ''), /authorization/u);

            const registered = await postJson(`${resource}/oauth/register`, {
                client_name: 'Unit Test Client',
                redirect_uris: ['http://127.0.0.1/callback'],
            });
            const clientId = String(registered['client_id']);
            assert.match(clientId, /^mcp_dev_/u);
            const clientStoreText = await readFile(process.env['COPILOT_MCP_DEV_OAUTH_CLIENT_FILE'], 'utf8');
            assert.ok(clientStoreText.includes(clientId));
            resetDevOAuthRuntimeForTests();

            const codeVerifier = base64Url(randomBytes(32));
            const codeChallenge = base64Url(createHash('sha256').update(codeVerifier).digest());
            const authorize = new URL(`${resource}/oauth/authorize`);
            authorize.searchParams.set('response_type', 'code');
            authorize.searchParams.set('client_id', clientId);
            authorize.searchParams.set('redirect_uri', 'http://127.0.0.1/callback');
            authorize.searchParams.set('scope', 'openid repo:read repo:write repo:validate repo:admin');
            authorize.searchParams.set('resource', resource);
            authorize.searchParams.set('code_challenge', codeChallenge);
            authorize.searchParams.set('code_challenge_method', 'S256');
            const authorizationResponse = await fetch(authorize, { redirect: 'manual' });
            assert.equal(authorizationResponse.status, 302);
            const location = authorizationResponse.headers.get('location');
            assert.ok(location);
            const code = new URL(location).searchParams.get('code');
            assert.ok(code);

            const tokenSet = await postForm(`${resource}/oauth/token`, {
                grant_type: 'authorization_code',
                client_id: clientId,
                redirect_uri: 'http://127.0.0.1/callback',
                code,
                code_verifier: codeVerifier,
                resource,
            });
            const refreshToken = String(tokenSet['refresh_token']);
            assert.match(refreshToken, /^rt_/u);
            const storeText = await readFile(process.env['COPILOT_MCP_DEV_OAUTH_REFRESH_TOKEN_FILE'], 'utf8');
            assert.equal(storeText.includes(refreshToken), false);
            assert.ok(storeText.includes(hashRefreshTokenForTest(refreshToken)));

            resetDevOAuthRuntimeForTests();
            const persistenceAfterReset = await readDevOAuthPersistenceStatus();
            assert.equal(persistenceAfterReset.loadedFromFile, true);
            assert.equal(persistenceAfterReset.tokenCount, 1);

            const refreshed = await postForm(`${resource}/oauth/token`, {
                grant_type: 'refresh_token',
                client_id: clientId,
                refresh_token: refreshToken,
                resource,
            });
            assert.equal(typeof refreshed['access_token'], 'string');
            assert.match(String(refreshed['refresh_token']), /^rt_/u);
            assert.notEqual(refreshed['refresh_token'], refreshToken);
        } finally {
            server.close();
            resetDevOAuthRuntimeForTests();
            restoreEnv(oldEnv);
            await rm(tempDir, { recursive: true, force: true });
        }
    });
});

/**
 * @param {string[]} keys
 * @returns {Record<string, string | undefined>}
 */
function snapshotEnv(keys) {
    return Object.fromEntries(keys.map((key) => [key, process.env[key]]));
}

/**
 * @param {Record<string, string | undefined>} snapshot
 * @returns {void}
 */
function restoreEnv(snapshot) {
    for (const [key, value] of Object.entries(snapshot)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
}

/**
 * @param {Buffer} buffer
 * @returns {string}
 */
function base64Url(buffer) {
    return buffer.toString('base64').replace(/=/gu, '').replace(/\+/gu, '-').replace(/\//gu, '_');
}

/**
 * @param {string} token
 * @returns {string}
 */
function hashRefreshTokenForTest(token) {
    return createHash('sha256').update(token).digest('hex');
}

/**
 * @param {string} url
 * @param {Record<string, unknown>} body
 * @returns {Promise<Record<string, unknown>>}
 */
async function postJson(url, body) {
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://chatgpt.com' },
        body: JSON.stringify(body),
    });
    const text = await response.text();
    assert.ok(response.ok, `${response.status} ${text}`);
    return /** @type {Record<string, unknown>} */ (JSON.parse(text));
}

/**
 * @param {string} url
 * @param {Record<string, string>} body
 * @returns {Promise<Record<string, unknown>>}
 */
async function postForm(url, body) {
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://chatgpt.com' },
        body: new URLSearchParams(body),
    });
    const text = await response.text();
    assert.ok(response.ok, `${response.status} ${text}`);
    return /** @type {Record<string, unknown>} */ (JSON.parse(text));
}
