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

import {
    calculateJwkThumbprint,
    createLocalJWKSet,
    exportJWK,
    exportPKCS8,
    generateKeyPair,
    importPKCS8,
    jwtVerify,
    SignJWT,
} from 'jose';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const AUTH_CODE_TTL_MS = 5 * 60 * 1000;
const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
const DEFAULT_KEY_FILE = 'src/copilot/.ai/mcp/oauth-dev-private-key.pem';
const CLIENT_METADATA_TIMEOUT_MS = 5000;
const DEV_CLIENT_METADATA_PATH = '/.well-known/oauth-client/codex-smoke.json';
const DEV_CLIENT_REDIRECT_URI = 'https://chatgpt.com/connector/oauth/codex-smoke';
const OIDC_SCOPES = /** @type {const} */ (['openid', 'profile', 'email']);
const OIDC_CLAIMS = /** @type {const} */ ([
    'sub',
    'iss',
    'aud',
    'exp',
    'iat',
    'email',
    'email_verified',
    'name',
    'preferred_username',
]);

/** @type {Promise<{ privateKey: CryptoKey | import('node:crypto').KeyObject; publicJwk: Record<string, unknown>; kid: string }> | null} */
let keyMaterialPromise = null;

/** @type {Map<string, { clientId: string; redirectUri: string; scope: string; resource: string; codeChallenge: string; codeChallengeMethod: string; createdAt: number }>} */
const authorizationCodes = new Map();

/** @typedef {{ clientId: string; clientName: string; redirectUris: string[]; createdAt: number; source: 'dcr' | 'cimd' }} DevOAuthClient */

/** @type {Map<string, DevOAuthClient>} */
const registeredClients = new Map();

/** @type {Map<string, DevOAuthClient>} */
const clientMetadataDocumentCache = new Map();

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
    const scopesSupported = [...new Set([...config.scopesSupported, ...OIDC_SCOPES])];
    return {
        issuer: config.resource,
        authorization_endpoint: `${config.resource}/oauth/authorize`,
        token_endpoint: `${config.resource}/oauth/token`,
        userinfo_endpoint: `${config.resource}/oauth/userinfo`,
        jwks_uri: `${config.resource}/oauth/jwks.json`,
        registration_endpoint: `${config.resource}/oauth/register`,
        client_id_metadata_document_supported: true,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code'],
        token_endpoint_auth_methods_supported: ['none'],
        code_challenge_methods_supported: ['S256'],
        scopes_supported: scopesSupported,
        resource_parameter_supported: true,
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
        claims_supported: [...OIDC_CLAIMS],
    };
}

/**
 * @param {import('./auth.js').McpAuthConfig} config
 * @returns {Record<string, unknown>}
 */
export function buildBuiltInDevOAuthClientMetadata(config) {
    const clientId = `${config.resource}${DEV_CLIENT_METADATA_PATH}`;
    return {
        client_id: clientId,
        client_name: 'Copilot MCP CIMD smoke client',
        client_uri: config.resource,
        redirect_uris: [DEV_CLIENT_REDIRECT_URI],
        grant_types: ['authorization_code'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
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

    if (req.method === 'GET' && url.pathname === DEV_CLIENT_METADATA_PATH) {
        writeJson(res, 200, buildBuiltInDevOAuthClientMetadata(config));
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
        if (redirectUris.length === 0 || redirectUris.some((redirectUri) => !isAllowedRedirectUri(redirectUri))) {
            writeJson(res, 400, { error: 'invalid_client_metadata', error_description: 'redirect_uris is required.' });
            return true;
        }
        const clientId = `mcp_dev_${randomUUID()}`;
        const client = {
            clientId,
            clientName: typeof body['client_name'] === 'string' ? body['client_name'] : 'ChatGPT MCP Connector',
            redirectUris,
            createdAt: Date.now(),
            source: /** @type {const} */ ('dcr'),
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
        await handleAuthorize(res, url, config);
        return true;
    }

    if (req.method === 'POST' && url.pathname === '/oauth/token') {
        await handleToken(req, res, config);
        return true;
    }

    if (req.method === 'GET' && url.pathname === '/oauth/userinfo') {
        await handleUserInfo(req, res, config);
        return true;
    }

    return false;
}

/**
 * @returns {Promise<{ privateKey: CryptoKey | import('node:crypto').KeyObject; publicJwk: Record<string, unknown>; kid: string }>}
 */
async function getKeyMaterial() {
    keyMaterialPromise ??= (async () => {
        const privateKey = await readOrCreatePrivateKey();
        const publicJwk = await exportPublicJwk(privateKey);
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
 * @returns {Promise<CryptoKey | import('node:crypto').KeyObject>}
 */
async function readOrCreatePrivateKey() {
    const keyFile = readDevOAuthKeyFile();
    if (!isDevOAuthKeyRotationRequested()) {
        try {
            const pem = await readFile(keyFile, 'utf8');
            if (pem.trim()) return importPKCS8(pem, 'RS256', { extractable: true });
        } catch {
            // Missing or unreadable key files are repaired by generating a new dev key.
        }
    }
    const { privateKey } = await generateKeyPair('RS256', { extractable: true });
    await persistPrivateKey(keyFile, privateKey);
    return privateKey;
}

/**
 * @param {CryptoKey | import('node:crypto').KeyObject} privateKey
 * @returns {Promise<Record<string, unknown>>}
 */
async function exportPublicJwk(privateKey) {
    const publicJwk = /** @type {Record<string, unknown>} */ (await exportJWK(privateKey));
    for (const privateField of ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth']) {
        delete publicJwk[privateField];
    }
    return publicJwk;
}

/**
 * @param {string} keyFile
 * @param {CryptoKey | import('node:crypto').KeyObject} privateKey
 * @returns {Promise<void>}
 */
async function persistPrivateKey(keyFile, privateKey) {
    try {
        await mkdir(path.dirname(keyFile), { recursive: true });
        const pem = await exportPKCS8(privateKey);
        await writeFile(keyFile, pem, { encoding: 'utf8', mode: 0o600 });
    } catch {
        // The dev issuer can still operate with an in-memory key; persistence is a stability upgrade, not a hard dependency.
    }
}

/**
 * @returns {string}
 */
function readDevOAuthKeyFile() {
    return String(process.env['COPILOT_MCP_DEV_OAUTH_KEY_FILE'] ?? DEFAULT_KEY_FILE).trim() || DEFAULT_KEY_FILE;
}

/**
 * @returns {boolean}
 */
function isDevOAuthKeyRotationRequested() {
    const raw = String(process.env['COPILOT_MCP_DEV_OAUTH_ROTATE_KEY'] ?? '')
        .trim()
        .toLowerCase();
    return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {URL} url
 * @param {import('./auth.js').McpAuthConfig} config
 * @returns {Promise<void>}
 */
async function handleAuthorize(res, url, config) {
    const responseType = url.searchParams.get('response_type') ?? '';
    const clientId = url.searchParams.get('client_id') ?? '';
    const redirectUri = url.searchParams.get('redirect_uri') ?? '';
    const codeChallenge = url.searchParams.get('code_challenge') ?? '';
    const codeChallengeMethod = url.searchParams.get('code_challenge_method') ?? '';
    const resource = url.searchParams.get('resource') ?? config.resource;
    const scope = normalizeScope(url.searchParams.get('scope') ?? config.scopesSupported.join(' '), config);
    const state = url.searchParams.get('state') ?? '';
    const client = registeredClients.get(clientId) ?? (await resolveClientMetadataDocument(clientId));

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

    const idToken = saved.scope.split(/\s+/u).includes('openid')
        ? await new SignJWT({
              email: 'chatgpt-dev-connector@mcp.aurelin.org',
              email_verified: true,
              name: 'ChatGPT Dev Connector',
              preferred_username: 'chatgpt-dev-connector',
          })
              .setProtectedHeader({ alg: 'RS256', kid })
              .setIssuer(config.resource)
              .setSubject('chatgpt-dev-connector')
              .setAudience(clientId)
              .setIssuedAt(nowSeconds)
              .setExpirationTime(nowSeconds + ACCESS_TOKEN_TTL_SECONDS)
              .setJti(randomUUID())
              .sign(privateKey)
        : undefined;

    writeJson(res, 200, {
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: ACCESS_TOKEN_TTL_SECONDS,
        scope: saved.scope,
        ...(idToken ? { id_token: idToken } : {}),
    });
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {import('./auth.js').McpAuthConfig} config
 * @returns {Promise<void>}
 */
async function handleUserInfo(req, res, config) {
    const token = parseBearerToken(req.headers['authorization']);
    if (!token) {
        writeJson(res, 401, { error: 'invalid_token', error_description: 'Bearer token is required.' });
        return;
    }
    try {
        const { publicJwk } = await getKeyMaterial();
        const jwks = createLocalJWKSet({ keys: [publicJwk] });
        const verified = await jwtVerify(token, jwks, {
            issuer: config.resource,
            audience: config.resource,
        });
        writeJson(res, 200, {
            sub: verified.payload.sub ?? 'chatgpt-dev-connector',
            email: 'chatgpt-dev-connector@mcp.aurelin.org',
            email_verified: true,
            name: 'ChatGPT Dev Connector',
            preferred_username: 'chatgpt-dev-connector',
        });
    } catch {
        writeJson(res, 401, { error: 'invalid_token', error_description: 'Bearer token could not be verified.' });
    }
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
 * @param {string} clientId
 * @returns {Promise<DevOAuthClient | undefined>}
 */
async function resolveClientMetadataDocument(clientId) {
    const cached = clientMetadataDocumentCache.get(clientId);
    if (cached) return cached;
    if (!isAllowedClientMetadataUrl(clientId)) return undefined;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CLIENT_METADATA_TIMEOUT_MS);
    try {
        const response = await fetch(clientId, {
            headers: { accept: 'application/json' },
            signal: controller.signal,
        });
        if (!response.ok) return undefined;
        const metadata = parseClientMetadata(await response.json(), clientId);
        if (!metadata) return undefined;
        clientMetadataDocumentCache.set(clientId, metadata);
        return metadata;
    } catch {
        return undefined;
    } finally {
        clearTimeout(timeout);
    }
}

/**
 * @param {unknown} value
 * @param {string} clientId
 * @returns {DevOAuthClient | undefined}
 */
function parseClientMetadata(value, clientId) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const metadata = /** @type {Record<string, unknown>} */ (value);
    if (metadata['client_id'] !== clientId) return undefined;
    const redirectUris = normalizeStringArray(metadata['redirect_uris']).filter(isAllowedRedirectUri);
    if (redirectUris.length === 0) return undefined;
    return {
        clientId,
        clientName: typeof metadata['client_name'] === 'string' ? metadata['client_name'] : 'MCP Client Metadata Document',
        redirectUris,
        createdAt: Date.now(),
        source: 'cimd',
    };
}

/**
 * @param {string} scope
 * @param {import('./auth.js').McpAuthConfig} config
 * @returns {string}
 */
function normalizeScope(scope, config) {
    const allowed = new Set([...config.scopesSupported, ...OIDC_SCOPES].map(String));
    const requested = scope
        .split(/\s+/u)
        .map((item) => item.trim())
        .filter((item) => allowed.has(item));
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
 * @param {string | string[] | undefined} header
 * @returns {string | undefined}
 */
function parseBearerToken(header) {
    const raw = Array.isArray(header) ? header[0] : header;
    const match = /^Bearer\s+(.+)$/iu.exec(String(raw ?? '').trim());
    return match?.[1]?.trim() || undefined;
}

/**
 * @param {string} value
 * @returns {boolean}
 */
function isAllowedClientMetadataUrl(value) {
    try {
        const url = new URL(value);
        if (url.protocol !== 'https:' || url.username || url.password || url.pathname === '/' || url.hash) return false;
        return !isLocalOrPrivateHostname(url.hostname);
    } catch {
        return false;
    }
}

/**
 * @param {string} value
 * @returns {boolean}
 */
function isAllowedRedirectUri(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' || url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    } catch {
        return false;
    }
}

/**
 * @param {string} hostname
 * @returns {boolean}
 */
function isLocalOrPrivateHostname(hostname) {
    const normalized = hostname.toLowerCase();
    return (
        normalized === 'localhost' ||
        normalized === '127.0.0.1' ||
        normalized === '[::1]' ||
        normalized.startsWith('10.') ||
        normalized.startsWith('192.168.') ||
        /^172\.(1[6-9]|2\d|3[0-1])\./u.test(normalized) ||
        normalized.startsWith('169.254.')
    );
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
