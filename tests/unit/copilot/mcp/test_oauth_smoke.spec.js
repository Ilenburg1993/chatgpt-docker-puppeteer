// @ts-check
/** OAuth smoke hardening tests. */

import assert from 'node:assert/strict';
import { afterEach, describe, it, vi } from 'vitest';

import { runMcpOAuthSmoke } from '../../../../src/copilot/mcp/scripts/oauth-smoke.js';

const originalEnv = { ...process.env };

/**
 * @param {unknown} body
 * @param {{ status?: number; headers?: Record<string, string> }} [init]
 */
function jsonResponse(body, init = {}) {
    return new Response(JSON.stringify(body), {
        status: init.status ?? 200,
        headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
    });
}

function optionsResponse() {
    return new Response('', {
        status: 204,
        headers: {
            'access-control-allow-origin': 'https://chatgpt.com',
            'access-control-allow-headers': 'authorization, content-type',
        },
    });
}

describe('MCP OAuth smoke hardening', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        process.env = { ...originalEnv };
    });

    it('fails the authorization-code flow when redirect state does not match', async () => {
        process.env.COPILOT_MCP_PUBLIC_URL = 'https://mcp.example.test';
        process.env.COPILOT_MCP_AUTH_MODE = 'oauth';
        const authorizationServer = 'https://mcp.example.test';
        const metadata = {
            issuer: authorizationServer,
            authorization_endpoint: `${authorizationServer}/oauth/authorize`,
            token_endpoint: `${authorizationServer}/oauth/token`,
            registration_endpoint: `${authorizationServer}/oauth/register`,
            jwks_uri: `${authorizationServer}/oauth/jwks.json`,
            client_id_metadata_document_supported: false,
        };

        const fetchMock = vi.fn(async (input, init = {}) => {
                const url = String(input);
                const method = String(init.method ?? 'GET').toUpperCase();
                if (url.endsWith('/oauth/token')) throw new Error('token endpoint must not be called after state mismatch');
                if (method === 'OPTIONS') return optionsResponse();
                if (url.endsWith('/.well-known/oauth-protected-resource')) {
                    return jsonResponse({ authorization_servers: [authorizationServer] });
                }
                if (url.endsWith('/.well-known/oauth-authorization-server')) return jsonResponse(metadata);
                if (url.endsWith('/oauth/jwks.json')) return jsonResponse({ keys: [] });
                if (url.endsWith('/oauth/register')) {
                    return jsonResponse({
                        client_id: 'registered-client',
                        redirect_uris: ['https://chatgpt.com/connector/oauth/codex-smoke'],
                    });
                }
                if (url.startsWith(`${authorizationServer}/oauth/authorize`)) {
                    return new Response('', {
                        status: 302,
                        headers: {
                            location: 'https://chatgpt.com/connector/oauth/codex-smoke?code=abc&state=wrong-state',
                        },
                    });
                }
                return jsonResponse({ error: 'unexpected', url, method }, { status: 500 });
            });
        vi.stubGlobal(
            'fetch',
            fetchMock,
        );

        const result = await runMcpOAuthSmoke({ resource: authorizationServer });

        assert.equal(result.ok, false);
        const flow = /** @type {{ token: { ok: boolean; error: string | null } }} */ (result.dcrFlow);
        assert.equal(flow.token.ok, false);
        assert.equal(flow.token.error, 'authorization state mismatch');
        assert.equal(fetchMock.mock.calls.some(([input]) => String(input).endsWith('/oauth/token')), false);
    });

    it('parses relative redirects and still rejects mismatched state', async () => {
        process.env.COPILOT_MCP_PUBLIC_URL = 'https://mcp.example.test';
        process.env.COPILOT_MCP_AUTH_MODE = 'oauth';
        const authorizationServer = 'https://mcp.example.test';
        const metadata = {
            issuer: authorizationServer,
            authorization_endpoint: `${authorizationServer}/oauth/authorize`,
            token_endpoint: `${authorizationServer}/oauth/token`,
            registration_endpoint: `${authorizationServer}/oauth/register`,
            jwks_uri: `${authorizationServer}/oauth/jwks.json`,
            client_id_metadata_document_supported: false,
        };
        vi.stubGlobal(
            'fetch',
            vi.fn(async (input, init = {}) => {
                const url = String(input);
                const method = String(init.method ?? 'GET').toUpperCase();
                if (method === 'OPTIONS') return optionsResponse();
                if (url.endsWith('/.well-known/oauth-protected-resource')) {
                    return jsonResponse({ authorization_servers: [authorizationServer] });
                }
                if (url.endsWith('/.well-known/oauth-authorization-server')) return jsonResponse(metadata);
                if (url.endsWith('/oauth/jwks.json')) return jsonResponse({ keys: [] });
                if (url.endsWith('/oauth/register')) {
                    return jsonResponse({
                        client_id: 'registered-client',
                        redirect_uris: ['https://chatgpt.com/connector/oauth/codex-smoke'],
                    });
                }
                if (url.startsWith(`${authorizationServer}/oauth/authorize`)) {
                    return new Response('', {
                        status: 302,
                        headers: {
                            location: '/connector/oauth/codex-smoke?code=abc&state=wrong-state',
                        },
                    });
                }
                return jsonResponse({ error: 'unexpected', url, method }, { status: 500 });
            }),
        );

        const result = await runMcpOAuthSmoke({ resource: authorizationServer });

        assert.equal(result.ok, false);
        const flow = /** @type {{ token: { ok: boolean; error: string | null } }} */ (result.dcrFlow);
        assert.equal(flow.token.ok, false);
        assert.equal(flow.token.error, 'authorization state mismatch');
    });
});
