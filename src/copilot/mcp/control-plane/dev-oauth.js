// @ts-check
/**
 * Built-in development OAuth 2.1 authorization server for the ChatGPT MCP connector.
 *
 * This is intentionally scoped to local/dev MCP usage. It gives ChatGPT a real OAuth
 * flow for the permanent Cloudflare endpoint without introducing an external IdP
 * dependency before the project chooses a production issuer.
 *
 * @module copilot/mcp/control-plane/dev-oauth
 */

import { calculateJwkThumbprint, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';

const AUTH_CODE_TTL_MS = 5 * 60 * 1000;
const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;

/** @type {Promise<{ privateKey: CryptoKey | import('node:crypto').KeyObject; publicJwk: Record<string, unknown>; kid: string }> | null} */
let keyMaterialPromise = null;

/** @type {Map<string, { clientId: string; redirectUri: string; scope: string; resource: string; codeChallenge: string; codeChallengeMethod: string; createdAt: number }>} */
const authorizationCodes = new Map();

/** @type {Map<string, { clientId: string; clientName: string; redirectUris: string[]; createdAt: number }>} */
const registeredClients = new Map();

/**
 * @param {import('./auth.js').McpAuthConfig} config
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean}
 */
export function isBuiltInDevOAuthEnabled(config, env = process.env) {
    const raw = String(env['COPILOT_MCP_DEV_OAUTH_ENABLED'] ?? 'true')
        .trim()
        .toLowerCase();
    if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'off') return false;
    return config.mode === 'oauth' && config.expectedIssuer === config.resource;
}

/**
 * @param {import('./auth.js').McpAuthConfig} config
 * @returns {Record<string, unknown>}
 */
export function buildBuiltInDevOAuthMetadata(config) {
    return {
        issuer: config.resource,
        authorization_endpoint: `${config.resource}/oauth/authorize`,
        token_endpoint: `${config.resource}/oauth/token`,
        jwks_uri: `${config.resource}/oauth/jwks.json`,
        registration_endpoint: `${config.resource}/oauth/register`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code'],
        token_endpoint_auth_methods_supported: ['none'],
        code_challenge_methods_supported: ['S256'],
        scopes_supported: [...config.scopesSupported],
        resource_parameter_supported: true,
    };
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {URL} url
 * @param {import('./auth.js').McpAuthConfig} config
 * @returns {Promise<boolean>}
 */
export async function handleBuiltInDevOAuthRequest(req, res, url, config) {
    if (!isBuiltInDevOAuthEnabled(config)) return false;

    if (req.method === 'GET' && (url.pathname === '/.well-known/oauth-authorization-server' || url.pathname === '/.well-known/openid-configuration')) {
        writeJson(res, 200, buildBuiltInDevOAuthMetadata(config));
        return true;
    }

    if (req.method === 'GET' && url.pathname === '/oauth/jwks.json') {
        const { publicJwk } = await getKeyMaterial();
        writeJson(res, 200, { keys: [publicJwk] });
        return true;
    }

    if (req.method === 'POST' && url.pathname === '/oauth/register') {
        const body = await readRequestBody(req);
        const redirectUris = normalizeStringArray(body['redirect_uris']);
        if (redirectUris.length === 0) {
            writeJson(res, 400, { error: 'invalid_client_metadata', error_description: 'redirect_uris is required.' });
            return true;
        }
        const clientId = `mcp_dev_${randomUUID()}`;
        const client = {
            clientId,
            clientName: typeof body['client_name'] === 'string' ? body['client_name'] : 'ChatGPT MCP Connector',
            redirectUris,
            createdAt: Date.now(),
        };
        registeredClients.set(clientId, client);
        writeJson(res, 201, {
            client_id: clientId,
            client_id_issued_at: Math.floor(client.createdAt / 1000),
            client_name: client.clientName,
            redirect_uris: client.redirectUris,
            token_endpoint_auth_method: 'none',
            grant_types: ['authorization_code'],
            response_types: ['code'],
        });
        return true;
    }

    if (req.method === 'GET' && url.pathname === '/oauth/authorize') {
        handleAuthorize(res, url, config);
        return true;
    }

    if (req.method === 'POST' && url.pathname === '/oauth/token') {
        await handleToken(req, res, config);
        return true;
    }

    return false;
}

/**
 * @returns {Promise<{ privateKey: CryptoKey | import('node:crypto').KeyObject; publicJwk: Record<string, unknown>; kid: string }>}
 */
async function getKeyMaterial() {
    keyMaterialPromise ??= (async () => {
        const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
        const publicJwk = await exportJWK(publicKey);
        const kid = await calculateJwkThumbprint(publicJwk);
        return {
            privateKey,
            kid,
            publicJwk: {
                ...publicJwk,
                kid,
                alg: 'RS256',
                use: 'sig',
            },
        };
    })();
    return keyMaterialPromise;
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {URL} url
 * @param {import('./auth.js').McpAuthConfig} config
 * @returns {void}
 */
function handleAuthorize(res, url, config) {
    const responseType = url.searchParams.get('response_type') ?? '';
    const clientId = url.searchParams.get('client_id') ?? '';
    const redirectUri = url.searchParams.get('redirect_uri') ?? '';
    const codeChallenge = url.searchParams.get('code_challenge') ?? '';
    const codeChallengeMethod = url.searchParams.get('code_challenge_method') ?? '';
    const resource = url.searchParams.get('resource') ?? config.resource;
    const scope = normalizeScope(url.searchParams.get('scope') ?? config.scopesSupported.join(' '), config);
    const state = url.searchParams.get('state') ?? '';
    const client = registeredClients.get(clientId);

    if (
        responseType !== 'code' ||
        !client ||
        !client.redirectUris.includes(redirectUri) ||
        resource !== config.resource ||
        codeChallengeMethod !== 'S256' ||
        !codeChallenge
    ) {
        redirectWithOAuthError(res, redirectUri, state, 'invalid_request');
        return;
    }

    const code = `code_${randomUUID()}`;
    authorizationCodes.set(code, {
        clientId,
        redirectUri,
        scope,
        resource,
        codeChallenge,
        codeChallengeMethod,
        createdAt: Date.now(),
    });
    const target = new URL(redirectUri);
    target.searchParams.set('code', code);
    if (state) target.searchParams.set('state', state);
    res.writeHead(302, { location: target.toString() }).end();
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {import('./auth.js').McpAuthConfig} config
 * @returns {Promise<void>}
 */
async function handleToken(req, res, config) {
    const body = await readRequestBody(req);
    const grantType = String(body['grant_type'] ?? '');
    const code = String(body['code'] ?? '');
    const clientId = String(body['client_id'] ?? '');
    const redirectUri = String(body['redirect_uri'] ?? '');
    const codeVerifier = String(body['code_verifier'] ?? '');
    const resource = String(body['resource'] ?? config.resource);
    const saved = authorizationCodes.get(code);
    authorizationCodes.delete(code);

    if (
        grantType !== 'authorization_code' ||
        !saved ||
        saved.clientId !== clientId ||
        saved.redirectUri !== redirectUri ||
        saved.resource !== resource ||
        Date.now() - saved.createdAt > AUTH_CODE_TTL_MS ||
        !verifyPkceS256(codeVerifier, saved.codeChallenge)
    ) {
        writeJson(res, 400, { error: 'invalid_grant' });
        return;
    }

    const { privateKey, kid } = await getKeyMaterial();
    const nowSeconds = Math.floor(Date.now() / 1000);
    const accessToken = await new SignJWT({
        scope: saved.scope,
        client_id: clientId,
        resource,
    })
        .setProtectedHeader({ alg: 'RS256', kid })
        .setIssuer(config.resource)
        .setSubject('chatgpt-dev-connector')
        .setAudience(config.resource)
        .setIssuedAt(nowSeconds)
        .setExpirationTime(nowSeconds + ACCESS_TOKEN_TTL_SECONDS)
        .setJti(randomUUID())
        .sign(privateKey);

    writeJson(res, 200, {
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: ACCESS_TOKEN_TTL_SECONDS,
        scope: saved.scope,
    });
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @returns {Promise<Record<string, unknown>>}
 */
async function readRequestBody(req) {
    const chunks = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const text = Buffer.concat(chunks).toString('utf8');
    if (!text.trim()) return {};
    const contentType = String(req.headers['content-type'] ?? '');
    if (contentType.includes('application/json')) return parseJsonObject(text);
    const params = new URLSearchParams(text);
    return Object.fromEntries(params.entries());
}

/**
 * @param {string} text
 * @returns {Record<string, unknown>}
 */
function parseJsonObject(text) {
    try {
        const parsed = JSON.parse(text);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function normalizeStringArray(value) {
    return Array.isArray(value) ? value.filter((item) => typeof item === 'string' && item.trim()) : [];
}

/**
 * @param {string} scope
 * @param {import('./auth.js').McpAuthConfig} config
 * @returns {string}
 */
function normalizeScope(scope, config) {
    const allowed = new Set(config.scopesSupported);
    const requested = scope
        .split(/\s+/u)
        .map((item) => item.trim())
        .filter((item) => allowed.has(/** @type {import('./auth.js').McpAuthScope} */ (item)));
    return (requested.length > 0 ? requested : config.scopesSupported).join(' ');
}

/**
 * @param {string} verifier
 * @param {string} challenge
 * @returns {boolean}
 */
function verifyPkceS256(verifier, challenge) {
    const computed = base64Url(createHash('sha256').update(verifier).digest());
    return safeEqual(computed, challenge);
}

/**
 * @param {Buffer} buffer
 * @returns {string}
 */
function base64Url(buffer) {
    return buffer.toString('base64').replace(/=/gu, '').replace(/\+/gu, '-').replace(/\//gu, '_');
}

/**
 * @param {string} left
 * @param {string} right
 * @returns {boolean}
 */
function safeEqual(left, right) {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {unknown} body
 * @returns {void}
 */
function writeJson(res, status, body) {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body, null, 2));
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {string} redirectUri
 * @param {string} state
 * @param {string} error
 * @returns {void}
 */
function redirectWithOAuthError(res, redirectUri, state, error) {
    if (!redirectUri || !/^https:\/\//u.test(redirectUri)) {
        writeJson(res, 400, { error });
        return;
    }
    const target = new URL(redirectUri);
    target.searchParams.set('error', error);
    if (state) target.searchParams.set('state', state);
    res.writeHead(302, { location: target.toString() }).end();
}
