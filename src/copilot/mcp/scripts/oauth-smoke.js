// @ts-check
/**
 * OAuth smoke test for the canonical ChatGPT MCP endpoint.
 *
 * @module copilot/mcp/scripts/oauth-smoke
 */

import { createHash, randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { readMcpAuthConfig } from '../control-plane/auth.js';

/**
 * @typedef {{ ok: boolean; status?: number; body?: unknown; error?: string; headers?: Record<string, string> }} ProbeResult
 */

/**
 * @param {{ resource?: string }} [options]
 * @returns {Promise<Record<string, unknown>>}
 */
export async function runMcpOAuthSmoke(options = {}) {
    const config = readMcpAuthConfig();
    const resource = String(options.resource ?? process.env['COPILOT_MCP_OAUTH_SMOKE_RESOURCE'] ?? config.resource).replace(/\/+$/u, '');
    const protectedResource = await probeJson(`${resource}/.well-known/oauth-protected-resource`, { method: 'GET' });
    const authorizationServer = extractAuthorizationServer(protectedResource.body) ?? resource;
    const oauthMetadata = await probeJson(`${authorizationServer}/.well-known/oauth-authorization-server`, {
        method: 'GET',
    });
    const metadata = asRecord(oauthMetadata.body);
    const jwksUri = typeof metadata?.['jwks_uri'] === 'string' ? metadata['jwks_uri'] : `${authorizationServer}/oauth/jwks.json`;
    const jwks = await probeJson(jwksUri, { method: 'GET' });
    const registration = await registerClient(metadata, authorizationServer);
    const dcrToken = registration.ok
        ? await authorizeAndExchangeRegisteredClient(metadata, registration, resource, 'repo:read repo:validate')
        : failure('registration failed');
    const dcrTokenBody = asRecord(dcrToken.body);
    const runtimeHealth =
        typeof dcrTokenBody?.['access_token'] === 'string'
            ? await callMcpTool(`${resource}/mcp`, dcrTokenBody['access_token'], 'mcp_runtime_health')
            : failure('token missing');
    const cimdClientMetadataUrl = `${authorizationServer}/.well-known/oauth-client/codex-smoke.json`;
    const cimdClientMetadata = await probeJson(cimdClientMetadataUrl, { method: 'GET' });
    const cimdBody = asRecord(cimdClientMetadata.body);
    const cimdRedirectUri = normalizeStringArray(cimdBody?.['redirect_uris'])[0] ?? 'https://chatgpt.com/connector/oauth/codex-smoke';
    const cimdToken =
        metadata?.['client_id_metadata_document_supported'] === true
            ? await authorizeAndExchangeClient(metadata, {
                  clientId: cimdClientMetadataUrl,
                  redirectUri: cimdRedirectUri,
                  resource,
                  scope: 'repo:read repo:validate openid profile email',
              })
            : failure('client_id_metadata_document_supported missing');
    const cimdTokenBody = asRecord(cimdToken.body);
    const userinfo =
        typeof cimdTokenBody?.['access_token'] === 'string' && typeof metadata?.['userinfo_endpoint'] === 'string'
            ? await probeJson(metadata['userinfo_endpoint'], {
                  method: 'GET',
                  headers: { authorization: `Bearer ${cimdTokenBody['access_token']}`, accept: 'application/json' },
              })
            : failure('userinfo unavailable');
    return {
        ok:
            protectedResource.ok &&
            oauthMetadata.ok &&
            jwks.ok &&
            registration.ok &&
            dcrToken.ok &&
            runtimeHealth.ok &&
            cimdClientMetadata.ok &&
            cimdToken.ok &&
            userinfo.ok,
        resource,
        protectedResource,
        authorizationServer,
        oauthMetadata: summarizeMetadataProbe(oauthMetadata),
        jwks: summarizeJwks(jwks),
        registration: summarizeRegistration(registration),
        dcrFlow: {
            token: summarizeToken(dcrToken),
            runtimeHealth: {
                ok: runtimeHealth.ok,
                status: runtimeHealth.status ?? null,
                hasJsonRpcError: hasJsonRpcError(runtimeHealth.body),
                error: runtimeHealth.error ?? null,
            },
        },
        cimdFlow: {
            clientMetadata: summarizeClientMetadata(cimdClientMetadata),
            token: summarizeToken(cimdToken),
            userinfo: summarizeUserinfo(userinfo),
        },
    };
}

/**
 * @param {Record<string, unknown> | null} metadata
 * @param {string} authorizationServer
 * @returns {Promise<ProbeResult>}
 */
async function registerClient(metadata, authorizationServer) {
    const endpoint =
        typeof metadata?.['registration_endpoint'] === 'string'
            ? metadata['registration_endpoint']
            : `${authorizationServer}/oauth/register`;
    return probeJson(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
            client_name: 'Copilot MCP OAuth smoke',
            redirect_uris: ['https://chatgpt.com/connector/oauth/codex-smoke'],
            token_endpoint_auth_method: 'none',
            grant_types: ['authorization_code'],
            response_types: ['code'],
        }),
    });
}

/**
 * @param {Record<string, unknown> | null} metadata
 * @param {ProbeResult} registration
 * @param {string} resource
 * @param {string} scope
 * @returns {Promise<ProbeResult>}
 */
async function authorizeAndExchangeRegisteredClient(metadata, registration, resource, scope) {
    const registrationBody = asRecord(registration.body);
    const clientId = String(registrationBody?.['client_id'] ?? '');
    const redirectUri =
        normalizeStringArray(registrationBody?.['redirect_uris'])[0] ?? 'https://chatgpt.com/connector/oauth/codex-smoke';
    return authorizeAndExchangeClient(metadata, { clientId, redirectUri, resource, scope });
}

/**
 * @param {Record<string, unknown> | null} metadata
 * @param {{ clientId: string; redirectUri: string; resource: string; scope: string }} client
 * @returns {Promise<ProbeResult>}
 */
async function authorizeAndExchangeClient(metadata, client) {
    const verifier = base64Url(randomBytes(32));
    const challenge = base64Url(createHash('sha256').update(verifier).digest());
    const authorizationEndpoint = String(metadata?.['authorization_endpoint'] ?? `${client.resource}/oauth/authorize`);
    const tokenEndpoint = String(metadata?.['token_endpoint'] ?? `${client.resource}/oauth/token`);
    const authorizeUrl = new URL(authorizationEndpoint);
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('client_id', client.clientId);
    authorizeUrl.searchParams.set('redirect_uri', client.redirectUri);
    authorizeUrl.searchParams.set('scope', client.scope);
    authorizeUrl.searchParams.set('resource', client.resource);
    authorizeUrl.searchParams.set('code_challenge', challenge);
    authorizeUrl.searchParams.set('code_challenge_method', 'S256');
    authorizeUrl.searchParams.set('state', 'codex-smoke');
    const authorize = await fetch(authorizeUrl, { redirect: 'manual', signal: AbortSignal.timeout(10000) });
    const location = authorize.headers.get('location') ?? '';
    const code = location ? new URL(location).searchParams.get('code') : null;
    if (!code) return failure('authorization code missing', authorize.status);
    return probeJson(tokenEndpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            client_id: client.clientId,
            redirect_uri: client.redirectUri,
            code_verifier: verifier,
            resource: client.resource,
        }).toString(),
    });
}

/**
 * @param {string} mcpUrl
 * @param {string} accessToken
 * @param {string} toolName
 * @returns {Promise<ProbeResult>}
 */
async function callMcpTool(mcpUrl, accessToken, toolName) {
    const response = await probeJson(mcpUrl, {
        method: 'POST',
        headers: {
            authorization: `Bearer ${accessToken}`,
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: toolName, arguments: {} } }),
    });
    return { ...response, ok: response.ok && !hasJsonRpcError(response.body) };
}

/**
 * @param {string} url
 * @param {RequestInit} init
 * @returns {Promise<ProbeResult>}
 */
async function probeJson(url, init) {
    try {
        const response = await fetch(url, { ...init, signal: AbortSignal.timeout(10000) });
        const text = await response.text();
        let body = undefined;
        try {
            body = text ? JSON.parse(text) : undefined;
        } catch {
            body = text;
        }
        return { ok: response.ok, status: response.status, body };
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
}

/**
 * @param {unknown} body
 * @returns {string | null}
 */
function extractAuthorizationServer(body) {
    const metadata = asRecord(body);
    const servers = Array.isArray(metadata?.['authorization_servers']) ? metadata['authorization_servers'] : [];
    const first = servers.find((item) => typeof item === 'string' && item.startsWith('https://'));
    return typeof first === 'string' ? first.replace(/\/+$/u, '') : null;
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown> | null}
 */
function asRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? /** @type {Record<string, unknown>} */ (value) : null;
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function normalizeStringArray(value) {
    return Array.isArray(value) ? value.filter((item) => typeof item === 'string' && item.trim()) : [];
}

/**
 * @param {ProbeResult} probe
 * @returns {Record<string, unknown>}
 */
function summarizeMetadataProbe(probe) {
    const body = asRecord(probe.body);
    return {
        ok: probe.ok,
        status: probe.status ?? null,
        issuer: body?.['issuer'] ?? null,
        authorizationEndpointConfigured: typeof body?.['authorization_endpoint'] === 'string',
        tokenEndpointConfigured: typeof body?.['token_endpoint'] === 'string',
        registrationEndpointConfigured: typeof body?.['registration_endpoint'] === 'string',
        clientIdMetadataDocumentSupported: body?.['client_id_metadata_document_supported'] === true,
        userinfoEndpointConfigured: typeof body?.['userinfo_endpoint'] === 'string',
        jwksUriConfigured: typeof body?.['jwks_uri'] === 'string',
        codeChallengeMethodsSupported: body?.['code_challenge_methods_supported'] ?? [],
        tokenEndpointAuthMethodsSupported: body?.['token_endpoint_auth_methods_supported'] ?? [],
        scopesSupported: body?.['scopes_supported'] ?? [],
    };
}

/**
 * @param {ProbeResult} probe
 * @returns {Record<string, unknown>}
 */
function summarizeJwks(probe) {
    const body = asRecord(probe.body);
    return {
        ok: probe.ok,
        status: probe.status ?? null,
        keys: Array.isArray(body?.['keys']) ? body['keys'].length : 0,
    };
}

/**
 * @param {ProbeResult} registration
 * @returns {Record<string, unknown>}
 */
function summarizeRegistration(registration) {
    const body = asRecord(registration.body);
    return {
        ok: registration.ok,
        status: registration.status ?? null,
        clientIdIssued: typeof body?.['client_id'] === 'string',
        redirectUris: body?.['redirect_uris'] ?? [],
    };
}

/**
 * @param {ProbeResult} token
 * @returns {Record<string, unknown>}
 */
function summarizeToken(token) {
    const body = asRecord(token.body);
    return {
        ok: token.ok,
        status: token.status ?? null,
        tokenType: body?.['token_type'] ?? null,
        expiresIn: body?.['expires_in'] ?? null,
        scope: body?.['scope'] ?? null,
        idTokenIssued: typeof body?.['id_token'] === 'string',
        error: token.error ?? null,
    };
}

/**
 * @param {ProbeResult} probe
 * @returns {Record<string, unknown>}
 */
function summarizeClientMetadata(probe) {
    const body = asRecord(probe.body);
    return {
        ok: probe.ok,
        status: probe.status ?? null,
        clientId: body?.['client_id'] ?? null,
        redirectUris: body?.['redirect_uris'] ?? [],
    };
}

/**
 * @param {ProbeResult} probe
 * @returns {Record<string, unknown>}
 */
function summarizeUserinfo(probe) {
    const body = asRecord(probe.body);
    return {
        ok: probe.ok,
        status: probe.status ?? null,
        subject: body?.['sub'] ?? null,
        emailVerified: body?.['email_verified'] ?? null,
        error: probe.error ?? null,
    };
}

/**
 * @param {unknown} body
 * @returns {boolean}
 */
function hasJsonRpcError(body) {
    return Boolean(body && typeof body === 'object' && 'error' in body && body.error);
}

/**
 * @param {Buffer} buffer
 * @returns {string}
 */
function base64Url(buffer) {
    return buffer.toString('base64').replace(/=/gu, '').replace(/\+/gu, '-').replace(/\//gu, '_');
}

/**
 * @param {string} error
 * @param {number} [status]
 * @returns {ProbeResult}
 */
function failure(error, status) {
    return { ok: false, ...(status !== undefined ? { status } : {}), error };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    const report = await runMcpOAuthSmoke();
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report['ok']) process.exitCode = 1;
}
