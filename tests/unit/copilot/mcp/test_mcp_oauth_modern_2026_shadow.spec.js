// @ts-check

import { startHttpMcpServer } from '#copilot/mcp/public/adapters/http1';
import { createMcpProcessConfig } from '#copilot/mcp/public/composition/process-config';
import { createComposedMcpProcessHost } from '#copilot/mcp/public/composition/process-host';
import { MCP_PROTOCOL_MODERN_VERSION } from '#copilot/mcp/public/protocol/version';
import { resetMcpAuthRuntimeForTests } from '#copilot/testing/mcp/auth';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer as createNetServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it, vi } from 'vitest';

/** @type {string[]} */
const tempDirs = [];
/** @param {Uint8Array} value */
function base64Url(value) {
    return Buffer.from(value).toString('base64url');
}

/** @param {string} url @param {Record<string, unknown>} body */
async function postJson(url, body) {
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
    const payload = /** @type {Record<string, unknown>} */ (await response.json());
    assert.equal(response.ok, true, `${url}: ${response.status} ${JSON.stringify(payload)}`);
    return payload;
}

/** @param {string} url @param {Record<string, string>} body */
async function postForm(url, body) {
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(body),
    });
    const payload = /** @type {Record<string, unknown>} */ (await response.json());
    assert.equal(response.ok, true, `${url}: ${response.status} ${JSON.stringify(payload)}`);
    return payload;
}

/** @param {import('node:http').Server} server */
async function closeServer(server) {
    await Promise.race([
        new Promise((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve(undefined)));
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('MCP shadow server close timed out')), 5_000)),
    ]);
}

/** @returns {Promise<number>} */
async function reserveEphemeralPort() {
    const probe = createNetServer();
    await new Promise((resolve, reject) => {
        probe.once('error', reject);
        probe.listen(0, '127.0.0.1', resolve);
    });
    const address = probe.address();
    assert.ok(address && typeof address === 'object');
    await closeServer(probe);
    return address.port;
}

/**
 * @param {'max-autonomy' | 'least-privilege'} profile
 */
async function openOAuthModernShadow(profile) {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), `mcp-oauth-2026-${profile}-`));
    tempDirs.push(tempDir);
    vi.stubEnv('COPILOT_MCP_AUTH_MODE', 'oauth');
    vi.stubEnv('COPILOT_MCP_AUTH_ENFORCEMENT', 'all');
    vi.stubEnv('COPILOT_MCP_OAUTH_INITIAL_SCOPE_PROFILE', profile);
    vi.stubEnv('COPILOT_MCP_HTTP_STATEFUL_SESSIONS', 'false');
    vi.stubEnv('COPILOT_MCP_CLOUDFLARE_PUBLIC_URL', 'https://mcp.aurelin.org/mcp');
    vi.stubEnv('COPILOT_MCP_DEV_OAUTH_KEY_FILE', path.join(tempDir, 'oauth-key.pem'));
    vi.stubEnv('COPILOT_MCP_DEV_OAUTH_REFRESH_TOKEN_FILE', path.join(tempDir, 'refresh-tokens.json'));
    vi.stubEnv('COPILOT_MCP_DEV_OAUTH_CLIENT_FILE', path.join(tempDir, 'clients.json'));
    vi.stubEnv('COPILOT_MCP_ALLOWED_ORIGINS', 'https://chatgpt.com,http://127.0.0.1');
    resetMcpAuthRuntimeForTests();

    const port = await reserveEphemeralPort();
    const resource = `http://127.0.0.1:${port}`;
    vi.stubEnv('COPILOT_MCP_PUBLIC_URL', `${resource}/mcp`);
    resetMcpAuthRuntimeForTests();
    const processConfig = createMcpProcessConfig(process.env);
    const processHost = createComposedMcpProcessHost({
        hostId: `mcp-oauth-modern-${profile}-${randomBytes(6).toString('hex')}`,
        processConfig,
        backgroundServices: false,
    });
    const server = await startHttpMcpServer({
        host: '127.0.0.1',
        port,
        processHost,
        processConfig,
    });

    const config = processConfig.auth.config;
    assert.equal(config.initialScopeProfile, profile);
    const registered = await postJson(`${resource}/oauth/register`, {
        client_name: `MCP 2026 ${profile} shadow`,
        redirect_uris: ['http://127.0.0.1/callback'],
    });
    const clientId = String(registered['client_id']);
    assert.match(clientId, /^mcp_dev_/u);

    const verifier = base64Url(randomBytes(32));
    const challenge = base64Url(createHash('sha256').update(verifier).digest());
    const state = base64Url(randomBytes(16));
    const authorize = new URL(`${resource}/oauth/authorize`);
    authorize.searchParams.set('response_type', 'code');
    authorize.searchParams.set('client_id', clientId);
    authorize.searchParams.set('redirect_uri', 'http://127.0.0.1/callback');
    authorize.searchParams.set('scope', config.initialScopes.join(' '));
    authorize.searchParams.set('resource', resource);
    authorize.searchParams.set('state', state);
    authorize.searchParams.set('code_challenge', challenge);
    authorize.searchParams.set('code_challenge_method', 'S256');

    const authorizationResponse = await fetch(authorize, { redirect: 'manual' });
    assert.equal(authorizationResponse.status, 302);
    const location = authorizationResponse.headers.get('location');
    assert.ok(location);
    const callback = new URL(location);
    assert.equal(callback.searchParams.get('state'), state);
    assert.equal(callback.searchParams.get('iss'), resource);
    const code = callback.searchParams.get('code');
    assert.ok(code);

    const tokenSet = await postForm(`${resource}/oauth/token`, {
        grant_type: 'authorization_code',
        client_id: clientId,
        redirect_uri: 'http://127.0.0.1/callback',
        code,
        code_verifier: verifier,
        resource,
    });
    const grantedScopes = String(tokenSet['scope'] ?? '')
        .split(/\s+/u)
        .filter(Boolean)
        .sort();
    assert.deepEqual(grantedScopes, [...config.initialScopes].sort());
    const accessToken = String(tokenSet['access_token'] ?? '');
    assert.ok(accessToken);

    const client = new Client(
        { name: `mcp-oauth-2026-${profile}-shadow`, version: '1.0.0' },
        { versionNegotiation: { mode: { pin: MCP_PROTOCOL_MODERN_VERSION } } },
    );
    const transport = new StreamableHTTPClientTransport(new URL(`${resource}/mcp`), {
        requestInit: { headers: { authorization: `Bearer ${accessToken}` } },
    });
    await client.connect(transport);
    assert.equal(client.getProtocolEra(), 'modern');
    assert.equal(client.getNegotiatedProtocolVersion(), MCP_PROTOCOL_MODERN_VERSION);

    return { server, client, config, processHost };
}

afterEach(async () => {
    resetMcpAuthRuntimeForTests();
    vi.unstubAllEnvs();
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('MCP OAuth + modern 2026 shadow', () => {
    it('uses max-autonomy by default and executes read/write-scoped work without reauthorization', async () => {
        const shadow = await openOAuthModernShadow('max-autonomy');
        try {
            assert.deepEqual(shadow.config.initialScopes, ['repo:read', 'repo:write', 'repo:validate', 'repo:admin']);
            assert.equal(shadow.config.stepUpPreferred, false);

            const tools = await shadow.client.listTools();
            assert.equal(tools.tools.length, 88);
            const read = await shadow.client.callTool({ name: 'repo_status', arguments: {} });
            assert.notEqual(read.isError, true);
            const readStructured = /** @type {Record<string, unknown>} */ (read.structuredContent ?? {});
            assert.equal(readStructured['success'], true);

            const writeDryRun = await shadow.client.callTool({
                name: 'repo_apply_patch',
                arguments: {
                    path: 'package.json',
                    old_string: '"name": "chatgpt-docker-puppeteer"',
                    new_string: '"name": "chatgpt-docker-puppeteer-oauth-shadow"',
                    dryRun: true,
                },
            });
            assert.notEqual(writeDryRun.isError, true);
            const writeStructured = /** @type {Record<string, unknown>} */ (writeDryRun.structuredContent ?? {});
            assert.equal(writeStructured['dryRun'], true);
        } finally {
            await shadow.client.close().catch(() => undefined);
            await closeServer(shadow.server);
            await shadow.processHost.dispose();
        }
    });

    it('keeps least-privilege as an opt-in profile and advertises repo:write on denied write work', async () => {
        const shadow = await openOAuthModernShadow('least-privilege');
        try {
            assert.deepEqual(shadow.config.initialScopes, ['repo:read']);
            assert.equal(shadow.config.stepUpPreferred, true);

            const read = await shadow.client.callTool({ name: 'repo_status', arguments: {} });
            assert.notEqual(read.isError, true);

            const denied = await shadow.client.callTool({
                name: 'repo_apply_patch',
                arguments: {
                    path: 'package.json',
                    old_string: '"name": "chatgpt-docker-puppeteer"',
                    new_string: '"name": "chatgpt-docker-puppeteer-oauth-shadow"',
                    dryRun: true,
                },
            });
            assert.equal(denied.isError, true);
            const challenge = denied._meta?.['mcp/www_authenticate'];
            assert.equal(typeof challenge, 'string');
            assert.match(String(challenge), /repo:write/u);
        } finally {
            await shadow.client.close().catch(() => undefined);
            await closeServer(shadow.server);
            await shadow.processHost.dispose();
        }
    });
});
