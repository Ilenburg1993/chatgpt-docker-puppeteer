// @ts-check
/**
 * Built-in development OAuth 2.1 authorization server for the ChatGPT MCP connector.
 *
 * This is intentionally scoped to local/dev MCP usage. It gives ChatGPT a real OAuth flow for the permanent Cloudflare
 * endpoint without introducing an external IdP dependency before the project chooses a production issuer.
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
import { lookup as lookupDns } from 'node:dns/promises';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import path from 'node:path';

const AUTH_CODE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
const DEFAULT_REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
const DEFAULT_CLIENT_TTL_SECONDS = 30 * 24 * 60 * 60;
const DEFAULT_KEY_FILE = 'src/copilot/.ai/mcp/oauth-dev-private-key.pem';
const DEFAULT_REFRESH_TOKEN_FILE = 'src/copilot/.ai/mcp/oauth-refresh-tokens.json';
const REFRESH_TOKEN_STORE_SCHEMA_VERSION = 1;
const DEFAULT_CLIENT_FILE = 'src/copilot/.ai/mcp/oauth-clients.json';
const CLIENT_STORE_SCHEMA_VERSION = 1;
const CLIENT_METADATA_TIMEOUT_MS = 5000;
const CLIENT_METADATA_MAX_REDIRECTS = 3;
const MAX_REGISTERED_CLIENTS = 100;
const MAX_CLIENT_METADATA_CACHE_ENTRIES = 100;
const CLIENT_METADATA_CACHE_TTL_MS = 15 * 60 * 1000;
const DEFAULT_REQUEST_BUDGET_WINDOW_MS = 60 * 1000;
const MAX_AUTHORIZATION_CODES = 200;
const MAX_REFRESH_TOKEN_RECORDS = 500;
const MAX_CLIENT_NAME_LENGTH = 120;
const CONTROL_CHARACTERS_PATTERN = new RegExp(
    `[${String.fromCharCode(0)}-${String.fromCharCode(31)}${String.fromCharCode(127)}]`,
    'u',
);
const MAX_REDIRECT_URIS_PER_CLIENT = 10;
const MAX_CLIENT_METADATA_RESPONSE_BYTES = 64 * 1024;
const MAX_SCOPE_TOKENS = 50;
const MAX_SCOPE_TOKEN_LENGTH = 256;
const MAX_STATE_LENGTH = 512;
const MAX_NONCE_LENGTH = 512;
const MAX_CLIENT_ID_LENGTH = 2048;
const MAX_REDIRECT_URI_LENGTH = 2048;
const MAX_RESOURCE_LENGTH = 2048;
const MAX_PKCE_CODE_CHALLENGE_LENGTH = 128;
const MIN_PKCE_CODE_CHALLENGE_LENGTH = 43;
const MAX_PKCE_CODE_VERIFIER_LENGTH = 128;
const MIN_PKCE_CODE_VERIFIER_LENGTH = 43;
const MAX_REQUEST_BUDGET_SUBJECT_LENGTH = 128;
/** @type {Record<string, number>} */
const REQUEST_BUDGET_LIMITS = {
    authorize: 120,
    register: 30,
    revoke: 60,
    token: 60,
    userinfo: 120,
};
const MAX_REQUEST_BODY_BYTES = 64 * 1024;
const FORM_CONTENT_TYPE = 'application/x-www-form-urlencoded';
const JSON_CONTENT_TYPE = 'application/json';
const DEV_CLIENT_METADATA_PATH = '/.well-known/oauth-client/codex-smoke.json';
const DEV_CLIENT_REDIRECT_URI = 'https://chatgpt.com/connector/oauth/codex-smoke';
const OIDC_SCOPES = /** @type {const} */ (['openid', 'profile', 'email']);
const REFRESH_TOKEN_GRANT = 'refresh_token';
const REFRESH_TOKEN_PREFIX = 'rt_';
const DEV_OAUTH_SUBJECT = 'chatgpt-dev-connector';
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

/**
 * @type {Promise<{
 *     privateKey: CryptoKey | import('node:crypto').KeyObject;
 *     publicJwk: Record<string, unknown>;
 *     kid: string;
 * }> | null}
 */
let keyMaterialPromise = null;

/**
 * @type {Map<
 *     string,
 *     {
 *         clientId: string;
 *         redirectUri: string;
 *         scope: string;
 *         resource: string;
 *         codeChallenge: string;
 *         codeChallengeMethod: string;
 *         nonce: string | null;
 *         createdAt: number;
 *     }
 * >}
 */
const authorizationCodes = new Map();

/**
 * @typedef {{
 *     clientId: string;
 *     clientName: string;
 *     redirectUris: string[];
 *     createdAt: number;
 *     expiresAt?: number;
 *     source: 'dcr' | 'cimd';
 * }} DevOAuthClient
 */

/** @type {Map<string, DevOAuthClient>} */
const registeredClients = new Map();

/** @type {Map<string, { client: DevOAuthClient; expiresAt: number }>} */
const clientMetadataDocumentCache = new Map();

/** @type {Map<string, { count: number; resetAt: number }>} */
const requestBudgets = new Map();

/** @type {Map<string, { clientId: string; scope: string; resource: string; expiresAt: number }>} */
const renewCredentials = new Map();

/** @type {Promise<void> | null} */
let renewCredentialsLoadPromise = null;
let renewCredentialsLoaded = false;
let renewCredentialsLoadedFromFile = false;
let renewCredentialsLastLoadedAt = /** @type {string | null} */ (null);
let renewCredentialsLastPersistedAt = /** @type {string | null} */ (null);
let renewCredentialsLastPersistenceError = /** @type {string | null} */ (null);
/** @type {Promise<void>} */
let renewCredentialsPersistPromise = Promise.resolve();

/** @type {Promise<void> | null} */
let registeredClientsLoadPromise = null;
let registeredClientsLoaded = false;
let registeredClientsLoadedFromFile = false;
let registeredClientsLastLoadedAt = /** @type {string | null} */ (null);
let registeredClientsLastPersistedAt = /** @type {string | null} */ (null);
let registeredClientsLastPersistenceError = /** @type {string | null} */ (null);
/** @type {Promise<void>} */
let registeredClientsPersistPromise = Promise.resolve();

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
        revocation_endpoint: `${config.resource}/oauth/revoke`,
        client_id_metadata_document_supported: true,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', REFRESH_TOKEN_GRANT],
        token_endpoint_auth_methods_supported: ['none'],
        code_challenge_methods_supported: ['S256'],
        scopes_supported: scopesSupported,
        resource_parameter_supported: true,
        resource_indicators_supported: [config.resource, `${config.resource}/mcp`],
        authorization_response_iss_parameter_supported: true,
        bearer_methods_supported: ['header'],
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
        grant_types: ['authorization_code', REFRESH_TOKEN_GRANT],
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

    const budgetName = resolveDevOAuthBudgetName(req.method, url.pathname);
    if (budgetName && !consumeDevOAuthBudget(req, budgetName)) {
        writeJson(res, 429, { error: 'temporarily_unavailable' });
        return true;
    }

    if (
        req.method === 'GET' &&
        (url.pathname === '/.well-known/oauth-authorization-server' ||
            url.pathname === '/.well-known/openid-configuration')
    ) {
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

    if (req.method === 'GET' && url.pathname === '/oauth/status') {
        if (!isDevOAuthDiagnosticsEnabled()) return false;
        writeJson(res, 200, await buildDevOAuthStatus(config));
        return true;
    }

    if (req.method === 'POST' && url.pathname === '/oauth/register') {
        await ensureRegisteredClientsLoaded();
        const body = await readOAuthRequestBody(req, res, { allowJson: true, allowForm: false });
        if (!body) return true;
        const validation = validateDynamicClientRegistration(body);
        if (!validation.ok) {
            writeJson(res, 400, { error: 'invalid_client_metadata', error_description: validation.error });
            return true;
        }
        const { clientTtlSeconds } = readDevOAuthClientLifetimePolicy();
        pruneRegisteredClients(MAX_REGISTERED_CLIENTS - 1);
        if (registeredClients.size >= MAX_REGISTERED_CLIENTS) {
            writeJson(res, 503, { error: 'temporarily_unavailable' });
            return true;
        }
        const clientId = `mcp_dev_${randomUUID()}`;
        const nowMs = Date.now();
        const client = {
            clientId,
            clientName: validation.clientName,
            redirectUris: validation.redirectUris,
            createdAt: nowMs,
            expiresAt: nowMs + clientTtlSeconds * 1000,
            source: /** @type {const} */ ('dcr'),
        };
        registeredClients.set(clientId, client);
        await persistRegisteredClients();
        writeJson(res, 201, {
            client_id: clientId,
            client_id_issued_at: Math.floor(client.createdAt / 1000),
            client_id_expires_at: Math.floor((client.expiresAt ?? client.createdAt + clientTtlSeconds * 1000) / 1000),
            client_name: client.clientName,
            redirect_uris: client.redirectUris,
            token_endpoint_auth_method: 'none',
            grant_types: ['authorization_code', REFRESH_TOKEN_GRANT],
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

    if (req.method === 'POST' && url.pathname === '/oauth/revoke') {
        await handleRevoke(req, res);
        return true;
    }

    if (req.method === 'GET' && url.pathname === '/oauth/userinfo') {
        await handleUserInfo(req, res, config);
        return true;
    }

    return false;
}
/**
 * @param {import('./auth.js').McpAuthConfig} config
 * @returns {Promise<Record<string, unknown>>}
 */
async function buildDevOAuthStatus(config) {
    const persistence = await readDevOAuthPersistenceStatus();
    const { kid } = await getKeyMaterial();
    return {
        issuer: config.resource,
        subject: DEV_OAUTH_SUBJECT,
        oauthEnabled: true,
        diagnosticsEnabled: true,
        key: { kid },
        authorizationCodes: authorizationCodes.size,
        clientMetadataCacheEntries: clientMetadataDocumentCache.size,
        requestBudgetEntries: requestBudgets.size,
        persistence,
    };
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean}
 */
function isDevOAuthDiagnosticsEnabled(env = process.env) {
    const raw = String(env['COPILOT_MCP_DEV_OAUTH_DIAGNOSTICS_ENABLED'] ?? '')
        .trim()
        .toLowerCase();
    return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

/**
 * @returns {Promise<{
 *     privateKey: CryptoKey | import('node:crypto').KeyObject;
 *     publicJwk: Record<string, unknown>;
 *     kid: string;
 * }>}
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
    const responseType = boundedQueryParam(url, 'response_type', 32);
    const clientId = boundedQueryParam(url, 'client_id', MAX_CLIENT_ID_LENGTH);
    const redirectUri = boundedQueryParam(url, 'redirect_uri', MAX_REDIRECT_URI_LENGTH);
    const codeChallenge = boundedQueryParam(url, 'code_challenge', MAX_PKCE_CODE_CHALLENGE_LENGTH);
    const codeChallengeMethod = boundedQueryParam(url, 'code_challenge_method', 16);
    const resource = boundedQueryParam(url, 'resource', MAX_RESOURCE_LENGTH) || config.resource;
    const scopeResult = normalizeScope(url.searchParams.get('scope'), config);
    const stateResult = normalizeAuthorizationResponseParameter(url.searchParams.get('state'), MAX_STATE_LENGTH);
    const nonceResult = normalizeAuthorizationResponseParameter(url.searchParams.get('nonce'), MAX_NONCE_LENGTH);

    if (!stateResult.ok || !nonceResult.ok) {
        writeJson(res, 400, {
            error: 'invalid_request',
            error_description: !stateResult.ok ? 'state is invalid or too large.' : 'nonce is invalid or too large.',
        });
        return;
    }

    await ensureRegisteredClientsLoaded();
    pruneRegisteredClients();
    const client = registeredClients.get(clientId) ?? (await resolveClientMetadataDocument(clientId));

    if (!scopeResult.ok) {
        rejectOrRedirectAuthorizeError(res, config, client, redirectUri, stateResult.value, 'invalid_scope');
        return;
    }

    if (
        responseType !== 'code' ||
        !client ||
        !client.redirectUris.includes(redirectUri) ||
        !isAllowedOAuthResource(resource, config) ||
        codeChallengeMethod !== 'S256' ||
        !isValidPkceCodeChallenge(codeChallenge)
    ) {
        rejectOrRedirectAuthorizeError(res, config, client, redirectUri, stateResult.value, 'invalid_request');
        return;
    }

    pruneExpiredAuthorizationCodes(MAX_AUTHORIZATION_CODES - 1);
    if (authorizationCodes.size >= MAX_AUTHORIZATION_CODES) {
        rejectOrRedirectAuthorizeError(res, config, client, redirectUri, stateResult.value, 'temporarily_unavailable');
        return;
    }

    const code = `code_${randomUUID()}`;
    authorizationCodes.set(code, {
        clientId,
        redirectUri,
        scope: scopeResult.scope,
        resource,
        codeChallenge,
        codeChallengeMethod,
        nonce: nonceResult.value || null,
        createdAt: Date.now(),
    });
    const target = new URL(redirectUri);
    target.searchParams.set('code', code);
    target.searchParams.set('iss', config.resource);
    if (stateResult.value) target.searchParams.set('state', stateResult.value);
    redirect(res, target);
}
/**
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {import('./auth.js').McpAuthConfig} config
 * @returns {Promise<void>}
 */
async function handleToken(req, res, config) {
    const body = await readOAuthRequestBody(req, res, { allowJson: false, allowForm: true });
    if (!body) return;
    const grantType = String(body['grant_type'] ?? '');
    if (grantType === 'authorization_code') {
        await handleAuthorizationCodeToken(body, res, config);
        return;
    }
    if (grantType === REFRESH_TOKEN_GRANT) {
        await handleRefreshToken(body, res, config);
        return;
    }
    writeJson(res, 400, { error: 'unsupported_grant_type' });
}
/**
 * @param {Record<string, unknown>} body
 * @param {import('node:http').ServerResponse} res
 * @param {import('./auth.js').McpAuthConfig} config
 * @returns {Promise<void>}
 */
async function handleAuthorizationCodeToken(body, res, config) {
    const code = String(body['code'] ?? '');
    const clientId = String(body['client_id'] ?? '');
    const redirectUri = String(body['redirect_uri'] ?? '');
    const codeVerifier = String(body['code_verifier'] ?? '');
    const resource = String(body['resource'] ?? config.resource);
    const saved = authorizationCodes.get(code);
    authorizationCodes.delete(code);

    if (
        !saved ||
        saved.clientId !== clientId ||
        saved.redirectUri !== redirectUri ||
        saved.resource !== resource ||
        Date.now() - saved.createdAt > AUTH_CODE_TTL_MS ||
        !isValidPkceCodeVerifier(codeVerifier) ||
        !verifyPkceS256(codeVerifier, saved.codeChallenge)
    ) {
        writeJson(res, 400, { error: 'invalid_grant' });
        return;
    }

    writeJson(
        res,
        200,
        await issueTokenSet(
            {
                clientId,
                scope: saved.scope,
                resource,
                nonce: saved.nonce,
                includeIdToken: saved.scope.split(/\s+/u).includes('openid'),
            },
            config,
        ),
    );
}
/**
 * @param {Record<string, unknown>} body
 * @param {import('node:http').ServerResponse} res
 * @param {import('./auth.js').McpAuthConfig} config
 * @returns {Promise<void>}
 */
async function handleRefreshToken(body, res, config) {
    const clientId = String(body['client_id'] ?? '');
    const credential = String(body[REFRESH_TOKEN_GRANT] ?? '');
    await ensureRenewCredentialsLoaded();
    const credentialHash = hashRefreshToken(credential);
    const saved = renewCredentials.get(credentialHash);
    const scopeResult = saved ? normalizeScope(saved.scope, config) : { ok: false, scope: '' };

    if (
        !saved ||
        saved.clientId !== clientId ||
        !scopeResult.ok ||
        !isAllowedOAuthResource(saved.resource, config) ||
        Date.now() > saved.expiresAt
    ) {
        if (saved) {
            renewCredentials.delete(credentialHash);
            await persistRenewCredentials();
        }
        writeJson(res, 400, { error: 'invalid_grant' });
        return;
    }

    renewCredentials.delete(credentialHash);
    await persistRenewCredentials();
    writeJson(
        res,
        200,
        await issueTokenSet(
            {
                clientId,
                scope: scopeResult.scope,
                resource: saved.resource,
                nonce: null,
                includeIdToken: scopeResult.scope.split(/\s+/u).includes('openid'),
            },
            config,
        ),
    );
}
/**
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @returns {Promise<void>}
 */
async function handleRevoke(req, res) {
    const body = await readOAuthRequestBody(req, res, { allowJson: false, allowForm: true });
    if (!body) return;
    const credential = String(body['token'] ?? '');
    const clientId = String(body['client_id'] ?? '');
    if (credential.startsWith(REFRESH_TOKEN_PREFIX)) {
        await ensureRenewCredentialsLoaded();
        const credentialHash = hashRefreshToken(credential);
        const saved = renewCredentials.get(credentialHash);
        if (saved && (!clientId || saved.clientId === clientId)) {
            renewCredentials.delete(credentialHash);
            await persistRenewCredentials();
        }
    }
    writeJson(res, 200, {});
}

/**
 * @param {{ clientId: string; scope: string; resource: string; includeIdToken: boolean; nonce?: string | null }} options
 * @param {import('./auth.js').McpAuthConfig} config
 * @returns {Promise<Record<string, unknown>>}
 */
async function issueTokenSet(options, config) {
    const { privateKey, kid } = await getKeyMaterial();
    const nowSeconds = Math.floor(Date.now() / 1000);
    const { accessTokenTtlSeconds, refreshTokenTtlSeconds } = readDevOAuthTokenLifetimePolicy();
    const accessToken = await new SignJWT({
        scope: options.scope,
        client_id: options.clientId,
        resource: options.resource,
    })
        .setProtectedHeader({ alg: 'RS256', kid })
        .setIssuer(config.resource)
        .setSubject(DEV_OAUTH_SUBJECT)
        .setAudience(options.resource)
        .setIssuedAt(nowSeconds)
        .setExpirationTime(nowSeconds + accessTokenTtlSeconds)
        .setJti(randomUUID())
        .sign(privateKey);

    const idTokenPayload = {
        email: `${DEV_OAUTH_SUBJECT}@mcp.aurelin.org`,
        email_verified: true,
        name: 'ChatGPT Dev Connector',
        preferred_username: DEV_OAUTH_SUBJECT,
        ...(options.nonce ? { nonce: options.nonce } : {}),
    };

    const idToken = options.includeIdToken
        ? await new SignJWT(idTokenPayload)
              .setProtectedHeader({ alg: 'RS256', kid })
              .setIssuer(config.resource)
              .setSubject(DEV_OAUTH_SUBJECT)
              .setAudience(options.clientId)
              .setIssuedAt(nowSeconds)
              .setExpirationTime(nowSeconds + accessTokenTtlSeconds)
              .setJti(randomUUID())
              .sign(privateKey)
        : undefined;

    return {
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: accessTokenTtlSeconds,
        scope: options.scope,
        [REFRESH_TOKEN_GRANT]: await issueRefreshToken(
            options.clientId,
            options.scope,
            options.resource,
            refreshTokenTtlSeconds,
        ),
        refresh_token_expires_in: refreshTokenTtlSeconds,
        ...(idToken ? { id_token: idToken } : {}),
    };
}
/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{
 *     accessTokenTtlSeconds: number;
 *     refreshTokenTtlSeconds: number;
 *     defaults: { accessTokenTtlSeconds: number; refreshTokenTtlSeconds: number };
 * }}
 */
export function readDevOAuthTokenLifetimePolicy(env = process.env) {
    return {
        accessTokenTtlSeconds: readPositiveIntegerEnv(
            'COPILOT_MCP_DEV_OAUTH_ACCESS_TOKEN_TTL_SECONDS',
            DEFAULT_ACCESS_TOKEN_TTL_SECONDS,
            60,
            env,
        ),
        refreshTokenTtlSeconds: readPositiveIntegerEnv(
            'COPILOT_MCP_DEV_OAUTH_REFRESH_TOKEN_TTL_SECONDS',
            DEFAULT_REFRESH_TOKEN_TTL_SECONDS,
            60 * 60,
            env,
        ),
        defaults: {
            accessTokenTtlSeconds: DEFAULT_ACCESS_TOKEN_TTL_SECONDS,
            refreshTokenTtlSeconds: DEFAULT_REFRESH_TOKEN_TTL_SECONDS,
        },
    };
}
/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ clientTtlSeconds: number; defaults: { clientTtlSeconds: number } }}
 */
export function readDevOAuthClientLifetimePolicy(env = process.env) {
    return {
        clientTtlSeconds: readPositiveIntegerEnv(
            'COPILOT_MCP_DEV_OAUTH_CLIENT_TTL_SECONDS',
            DEFAULT_CLIENT_TTL_SECONDS,
            60 * 60,
            env,
        ),
        defaults: {
            clientTtlSeconds: DEFAULT_CLIENT_TTL_SECONDS,
        },
    };
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ refreshTokenFile: string; clientFile: string; persistenceEnabled: true }}
 */
export function readDevOAuthPersistenceConfig(env = process.env) {
    const refreshTokenFile =
        String(env['COPILOT_MCP_DEV_OAUTH_REFRESH_TOKEN_FILE'] ?? DEFAULT_REFRESH_TOKEN_FILE).trim() ||
        DEFAULT_REFRESH_TOKEN_FILE;
    const clientFile =
        String(env['COPILOT_MCP_DEV_OAUTH_CLIENT_FILE'] ?? DEFAULT_CLIENT_FILE).trim() || DEFAULT_CLIENT_FILE;
    return {
        refreshTokenFile,
        clientFile,
        persistenceEnabled: true,
    };
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Promise<{
 *     refreshTokenFile: string;
 *     persistenceEnabled: true;
 *     loaded: boolean;
 *     loadedFromFile: boolean;
 *     tokenCount: number;
 *     lastLoadedAt: string | null;
 *     lastPersistedAt: string | null;
 *     lastPersistenceError: string | null;
 *     storesOnlyTokenHashes: true;
 *     rotation: 'one-time-rotating-persistent';
 *     dynamicClientCount: number;
 *     clientStore: {
 *         clientFile: string;
 *         loaded: boolean;
 *         loadedFromFile: boolean;
 *         lastLoadedAt: string | null;
 *         lastPersistedAt: string | null;
 *         lastPersistenceError: string | null;
 *     };
 * }>}
 */
export async function readDevOAuthPersistenceStatus(env = process.env) {
    await ensureRenewCredentialsLoaded(env);
    await ensureRegisteredClientsLoaded(env);
    const pruned = pruneExpiredRenewCredentials();
    if (pruned) await persistRenewCredentials(env);
    const prunedClients = pruneRegisteredClients();
    if (prunedClients) await persistRegisteredClients(env);
    const persistenceConfig = readDevOAuthPersistenceConfig(env);
    return {
        ...persistenceConfig,
        loaded: renewCredentialsLoaded,
        loadedFromFile: renewCredentialsLoadedFromFile,
        tokenCount: renewCredentials.size,
        lastLoadedAt: renewCredentialsLastLoadedAt,
        lastPersistedAt: renewCredentialsLastPersistedAt,
        lastPersistenceError: renewCredentialsLastPersistenceError,
        storesOnlyTokenHashes: true,
        rotation: 'one-time-rotating-persistent',
        dynamicClientCount: registeredClients.size,
        clientStore: {
            clientFile: persistenceConfig.clientFile,
            loaded: registeredClientsLoaded,
            loadedFromFile: registeredClientsLoadedFromFile,
            lastLoadedAt: registeredClientsLastLoadedAt,
            lastPersistedAt: registeredClientsLastPersistedAt,
            lastPersistenceError: registeredClientsLastPersistenceError,
        },
    };
}
/**
 * Reset in-memory OAuth state for unit tests that need to simulate a process restart.
 *
 * @returns {void}
 */
export function resetDevOAuthRuntimeForTests() {
    keyMaterialPromise = null;
    authorizationCodes.clear();
    registeredClients.clear();
    clientMetadataDocumentCache.clear();
    requestBudgets.clear();
    renewCredentials.clear();
    renewCredentialsLoadPromise = null;
    renewCredentialsLoaded = false;
    renewCredentialsLoadedFromFile = false;
    renewCredentialsLastLoadedAt = null;
    renewCredentialsLastPersistedAt = null;
    renewCredentialsLastPersistenceError = null;
    renewCredentialsPersistPromise = Promise.resolve();
    registeredClientsLoadPromise = null;
    registeredClientsLoaded = false;
    registeredClientsLoadedFromFile = false;
    registeredClientsLastLoadedAt = null;
    registeredClientsLastPersistedAt = null;
    registeredClientsLastPersistenceError = null;
    registeredClientsPersistPromise = Promise.resolve();
}
/**
 * @param {string | undefined} method
 * @param {string} pathname
 * @returns {string | null}
 */
function resolveDevOAuthBudgetName(method, pathname) {
    if (method === 'GET' && pathname === '/oauth/authorize') return 'authorize';
    if (method === 'POST' && pathname === '/oauth/register') return 'register';
    if (method === 'POST' && pathname === '/oauth/revoke') return 'revoke';
    if (method === 'POST' && pathname === '/oauth/token') return 'token';
    if (method === 'GET' && pathname === '/oauth/userinfo') return 'userinfo';
    return null;
}
/**
 * @param {import('node:http').IncomingMessage} req
 * @param {string} name
 * @param {number} [nowMs]
 * @returns {boolean}
 */
function consumeDevOAuthBudget(req, name, nowMs = Date.now()) {
    pruneExpiredRequestBudgets(nowMs);
    const subject = readRequestBudgetSubject(req);
    const key = `${name}:${subject}`;
    const current = requestBudgets.get(key);
    const limit = readRequestBudgetLimit(name);
    const windowMs = readRequestBudgetWindowMs();
    if (!current || current.resetAt <= nowMs) {
        requestBudgets.set(key, { count: 1, resetAt: nowMs + windowMs });
        return true;
    }
    current.count += 1;
    return current.count <= limit;
}
/**
 * @param {string} name
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {number}
 */
function readRequestBudgetLimit(name, env = process.env) {
    const envName = `COPILOT_MCP_DEV_OAUTH_RATE_LIMIT_${name.toUpperCase()}_PER_WINDOW`;
    return readPositiveIntegerEnv(envName, REQUEST_BUDGET_LIMITS[name] ?? 60, 1, env);
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {number}
 */
function readRequestBudgetWindowMs(env = process.env) {
    return (
        readPositiveIntegerEnv(
            'COPILOT_MCP_DEV_OAUTH_RATE_LIMIT_WINDOW_SECONDS',
            Math.floor(DEFAULT_REQUEST_BUDGET_WINDOW_MS / 1000),
            1,
            env,
        ) * 1000
    );
}

/**
 * @param {number} [nowMs]
 * @returns {number}
 */
function pruneExpiredRequestBudgets(nowMs = Date.now()) {
    let removed = 0;
    for (const [key, budget] of requestBudgets) {
        if (budget.resetAt <= nowMs) {
            requestBudgets.delete(key);
            removed += 1;
        }
    }
    return removed;
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @returns {string}
 */
function readRequestBudgetSubject(req) {
    const cloudflareIp = firstHeaderValue(req.headers['cf-connecting-ip']);
    if (isSafeRequestBudgetSubject(cloudflareIp)) return cloudflareIp;

    if (isDevOAuthXForwardedForTrusted()) {
        const forwardedFor = firstHeaderValue(req.headers['x-forwarded-for']);
        const forwardedSubject = forwardedFor.split(',')[0]?.trim() || '';
        if (isSafeRequestBudgetSubject(forwardedSubject)) return forwardedSubject;
    }

    const remoteAddress = String(req.socket?.remoteAddress ?? 'unknown');
    return isSafeRequestBudgetSubject(remoteAddress) ? remoteAddress : 'unknown';
}
/**
 * @param {string} value
 * @returns {boolean}
 */
function isSafeRequestBudgetSubject(value) {
    return Boolean(value && value.length <= MAX_REQUEST_BUDGET_SUBJECT_LENGTH && /^[A-Za-z0-9:._\-[\]]+$/u.test(value));
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean}
 */
function isDevOAuthXForwardedForTrusted(env = process.env) {
    const raw = String(env['COPILOT_MCP_DEV_OAUTH_TRUST_X_FORWARDED_FOR'] ?? '')
        .trim()
        .toLowerCase();
    return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

/**
 * @param {string | string[] | undefined} value
 * @returns {string}
 */
function firstHeaderValue(value) {
    const raw = Array.isArray(value) ? value[0] : value;
    return String(raw ?? '').trim();
}

/**
 * @param {number} [maxSize]
 * @param {number} [nowMs]
 * @returns {number}
 */
function pruneExpiredAuthorizationCodes(maxSize = MAX_AUTHORIZATION_CODES, nowMs = Date.now()) {
    let removed = 0;
    for (const [code, metadata] of authorizationCodes) {
        if (nowMs - metadata.createdAt > AUTH_CODE_TTL_MS) {
            authorizationCodes.delete(code);
            removed += 1;
        }
    }
    if (authorizationCodes.size <= maxSize) return removed;
    const oldest = [...authorizationCodes.entries()].sort((left, right) => left[1].createdAt - right[1].createdAt);
    for (const [code] of oldest) {
        if (authorizationCodes.size <= maxSize) break;
        authorizationCodes.delete(code);
        removed += 1;
    }
    return removed;
}
/**
 * @param {number} [maxSize]
 * @param {number} [nowMs]
 * @returns {boolean}
 */
function pruneRegisteredClients(maxSize = MAX_REGISTERED_CLIENTS, nowMs = Date.now()) {
    let changed = false;
    for (const [clientId, client] of registeredClients) {
        if (client.source === 'dcr' && isRegisteredClientExpired(client, nowMs)) {
            registeredClients.delete(clientId);
            changed = true;
        }
    }
    if (registeredClients.size <= maxSize) return changed;
    const dcrClients = [...registeredClients.values()]
        .filter((client) => client.source === 'dcr')
        .sort((left, right) => left.createdAt - right.createdAt || left.clientId.localeCompare(right.clientId));
    for (const client of dcrClients) {
        if (registeredClients.size <= maxSize) break;
        registeredClients.delete(client.clientId);
        changed = true;
    }
    return changed;
}
/**
 * @param {DevOAuthClient} client
 * @param {number} [nowMs]
 * @returns {boolean}
 */
function isRegisteredClientExpired(client, nowMs = Date.now()) {
    return client.source === 'dcr' && Number.isFinite(client.expiresAt) && Number(client.expiresAt) <= nowMs;
}

/**
 * @param {number} createdAt
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {number}
 */
function deriveRegisteredClientExpiresAt(createdAt, env = process.env) {
    const { clientTtlSeconds } = readDevOAuthClientLifetimePolicy(env);
    return createdAt + clientTtlSeconds * 1000;
}

/**
 * @param {Record<string, unknown>} body
 * @returns {{ ok: true; clientName: string; redirectUris: string[] } | { ok: false; error: string }}
 */
function validateDynamicClientRegistration(body) {
    const redirectUris = uniqueStrings(normalizeStringArray(body['redirect_uris']));
    if (redirectUris.length === 0) return { ok: false, error: 'redirect_uris is required.' };
    if (redirectUris.length > MAX_REDIRECT_URIS_PER_CLIENT) {
        return { ok: false, error: `redirect_uris must contain at most ${MAX_REDIRECT_URIS_PER_CLIENT} entries.` };
    }
    if (redirectUris.some((redirectUri) => !isAllowedRedirectUri(redirectUri))) {
        return { ok: false, error: 'redirect_uris contains an unsupported URI.' };
    }
    if (!isSupportedStringArrayMetadata(body['grant_types'], ['authorization_code', REFRESH_TOKEN_GRANT])) {
        return { ok: false, error: 'grant_types contains unsupported values.' };
    }
    if (!isSupportedStringArrayMetadata(body['response_types'], ['code'])) {
        return { ok: false, error: 'response_types contains unsupported values.' };
    }
    const tokenEndpointAuthMethod = String(body['token_endpoint_auth_method'] ?? 'none');
    if (tokenEndpointAuthMethod !== 'none') {
        return { ok: false, error: 'token_endpoint_auth_method must be none.' };
    }
    return {
        ok: true,
        clientName: normalizeClientName(body['client_name'], 'ChatGPT MCP Connector'),
        redirectUris,
    };
}
/**
 * @param {unknown} value
 * @param {string[]} supported
 * @returns {boolean}
 */
function isSupportedStringArrayMetadata(value, supported) {
    if (value === undefined) return true;
    const items = normalizeStringArray(value);
    if (items.length === 0) return false;
    return items.every((item) => supported.includes(item));
}

/**
 * @param {unknown} value
 * @param {string} fallback
 * @returns {string}
 */
function normalizeClientName(value, fallback) {
    const raw = typeof value === 'string' ? stripControlCharacters(value).trim() : '';
    const normalized = raw || fallback;
    return normalized.slice(0, MAX_CLIENT_NAME_LENGTH);
}
/**
 * @param {string[]} values
 * @returns {string[]}
 */
function uniqueStrings(values) {
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
/**
 * @param {string} value
 * @returns {string}
 */
function stripControlCharacters(value) {
    return value.replace(new RegExp(CONTROL_CHARACTERS_PATTERN, 'gu'), '');
}

/**
 * @param {string} name
 * @param {number} fallback
 * @param {number} minimum
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {number}
 */
function readPositiveIntegerEnv(name, fallback, minimum, env = process.env) {
    const parsed = Number(env[name] ?? fallback);
    return Number.isFinite(parsed) && parsed >= minimum ? Math.floor(parsed) : fallback;
}

/**
 * @param {string} clientId
 * @param {string} scope
 * @param {string} resource
 * @param {number} ttlSeconds
 * @returns {Promise<string>}
 */
async function issueRefreshToken(clientId, scope, resource, ttlSeconds) {
    await ensureRenewCredentialsLoaded();
    pruneExpiredRenewCredentials();
    trimRenewCredentials(MAX_REFRESH_TOKEN_RECORDS - 1);
    const credential = `${REFRESH_TOKEN_PREFIX}${randomUUID()}`;
    renewCredentials.set(hashRefreshToken(credential), {
        clientId,
        scope,
        resource,
        expiresAt: Date.now() + ttlSeconds * 1000,
    });
    await persistRenewCredentials();
    return credential;
}
/**
 * @param {number} [nowMs]
 * @returns {boolean}
 */
function pruneExpiredRenewCredentials(nowMs = Date.now()) {
    let changed = false;
    for (const [credential, metadata] of renewCredentials) {
        if (metadata.expiresAt <= nowMs) {
            renewCredentials.delete(credential);
            changed = true;
        }
    }
    return changed;
}

/**
 * @param {number} maxSize
 * @returns {boolean}
 */
function trimRenewCredentials(maxSize) {
    if (renewCredentials.size <= maxSize) return false;
    let changed = false;
    const oldest = [...renewCredentials.entries()].sort((left, right) => left[1].expiresAt - right[1].expiresAt);
    for (const [credential] of oldest) {
        if (renewCredentials.size <= maxSize) break;
        renewCredentials.delete(credential);
        changed = true;
    }
    return changed;
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Promise<void>}
 */
async function ensureRenewCredentialsLoaded(env = process.env) {
    if (renewCredentialsLoaded) return;
    renewCredentialsLoadPromise ??= loadRenewCredentials(env);
    await renewCredentialsLoadPromise;
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Promise<void>}
 */
async function loadRenewCredentials(env = process.env) {
    const { refreshTokenFile } = readDevOAuthPersistenceConfig(env);
    renewCredentials.clear();
    renewCredentialsLoaded = false;
    renewCredentialsLoadedFromFile = false;
    renewCredentialsLastLoadedAt = new Date().toISOString();
    renewCredentialsLastPersistenceError = null;
    try {
        const text = await readFile(refreshTokenFile, 'utf8');
        const parsed = JSON.parse(text);
        const records = parseRefreshTokenRecords(parsed);
        for (const record of records) {
            renewCredentials.set(record.tokenHash, {
                clientId: record.clientId,
                scope: record.scope,
                resource: record.resource,
                expiresAt: record.expiresAt,
            });
        }
        renewCredentialsLoadedFromFile = true;
        pruneExpiredRenewCredentials();
        trimRenewCredentials(MAX_REFRESH_TOKEN_RECORDS);
    } catch (error) {
        const code = error && typeof error === 'object' ? /** @type {{ code?: unknown }} */ (error).code : undefined;
        if (code !== 'ENOENT')
            renewCredentialsLastPersistenceError = error instanceof Error ? error.message : String(error);
    } finally {
        renewCredentialsLoaded = true;
    }
}
/**
 * @param {unknown} parsed
 * @returns {{ tokenHash: string; clientId: string; scope: string; resource: string; expiresAt: number }[]}
 */
function parseRefreshTokenRecords(parsed) {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
    const root = /** @type {Record<string, unknown>} */ (parsed);
    const rawTokens = Array.isArray(root['tokens']) ? root['tokens'] : [];
    const records = [];
    for (const item of rawTokens) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
        const record = /** @type {Record<string, unknown>} */ (item);
        const tokenHash = String(record['tokenHash'] ?? '');
        const clientId = String(record['clientId'] ?? '');
        const scope = String(record['scope'] ?? '');
        const resource = String(record['resource'] ?? '');
        const expiresAt = Number(record['expiresAt']);
        if (!/^[a-f0-9]{64}$/u.test(tokenHash)) continue;
        if (!clientId || !scope || !resource || !Number.isFinite(expiresAt)) continue;
        records.push({ tokenHash, clientId, scope, resource, expiresAt });
    }
    return records;
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Promise<void>}
 */
async function persistRenewCredentials(env = process.env) {
    renewCredentialsPersistPromise = renewCredentialsPersistPromise.then(
        () => writeRenewCredentialsFile(env),
        () => writeRenewCredentialsFile(env),
    );
    await renewCredentialsPersistPromise;
}
/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Promise<void>}
 */
async function writeRenewCredentialsFile(env = process.env) {
    const { refreshTokenFile } = readDevOAuthPersistenceConfig(env);
    const tempFile = `${refreshTokenFile}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
    try {
        await mkdir(path.dirname(refreshTokenFile), { recursive: true });
        const body = {
            schemaVersion: REFRESH_TOKEN_STORE_SCHEMA_VERSION,
            updatedAt: new Date().toISOString(),
            storesOnlyTokenHashes: true,
            tokens: [...renewCredentials.entries()]
                .map(([tokenHash, metadata]) => ({ tokenHash, ...metadata }))
                .sort(
                    (left, right) => left.expiresAt - right.expiresAt || left.tokenHash.localeCompare(right.tokenHash),
                ),
        };
        await writeFile(tempFile, `${JSON.stringify(body, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
        await rename(tempFile, refreshTokenFile);
        renewCredentialsLastPersistedAt = body.updatedAt;
        renewCredentialsLastPersistenceError = null;
    } catch (error) {
        renewCredentialsLastPersistenceError = error instanceof Error ? error.message : String(error);
        try {
            await rm(tempFile, { force: true });
        } catch {
            // Best-effort temp cleanup only.
        }
    }
}

/**
 * @param {string} credential
 * @returns {string}
 */
function hashRefreshToken(credential) {
    return createHash('sha256').update(credential).digest('hex');
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Promise<void>}
 */
async function ensureRegisteredClientsLoaded(env = process.env) {
    if (registeredClientsLoaded) return;
    registeredClientsLoadPromise ??= loadRegisteredClients(env);
    await registeredClientsLoadPromise;
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Promise<void>}
 */
async function loadRegisteredClients(env = process.env) {
    const { clientFile } = readDevOAuthPersistenceConfig(env);
    registeredClients.clear();
    registeredClientsLoaded = false;
    registeredClientsLoadedFromFile = false;
    registeredClientsLastLoadedAt = new Date().toISOString();
    registeredClientsLastPersistenceError = null;
    try {
        const text = await readFile(clientFile, 'utf8');
        const parsed = JSON.parse(text);
        for (const client of parseRegisteredClientRecords(parsed, env)) registeredClients.set(client.clientId, client);
        pruneRegisteredClients();
        registeredClientsLoadedFromFile = true;
    } catch (error) {
        const code = error && typeof error === 'object' ? /** @type {{ code?: unknown }} */ (error).code : undefined;
        if (code !== 'ENOENT')
            registeredClientsLastPersistenceError = error instanceof Error ? error.message : String(error);
    } finally {
        registeredClientsLoaded = true;
    }
}
/**
 * @param {unknown} parsed
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {DevOAuthClient[]}
 */
function parseRegisteredClientRecords(parsed, env = process.env) {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
    const root = /** @type {Record<string, unknown>} */ (parsed);
    const rawClients = Array.isArray(root['clients']) ? root['clients'] : [];
    const clients = [];
    for (const item of rawClients) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
        const record = /** @type {Record<string, unknown>} */ (item);
        const clientId = String(record['clientId'] ?? '');
        const clientName = normalizeClientName(record['clientName'], 'ChatGPT MCP Connector');
        const redirectUris = uniqueStrings(
            normalizeStringArray(record['redirectUris']).filter(isAllowedRedirectUri),
        ).slice(0, MAX_REDIRECT_URIS_PER_CLIENT);
        const createdAt = Number(record['createdAt']);
        const rawExpiresAt = Number(record['expiresAt']);
        const expiresAt = Number.isFinite(rawExpiresAt)
            ? rawExpiresAt
            : deriveRegisteredClientExpiresAt(createdAt, env);
        if (
            !clientId.startsWith('mcp_dev_') ||
            !clientName ||
            redirectUris.length === 0 ||
            !Number.isFinite(createdAt) ||
            !Number.isFinite(expiresAt) ||
            expiresAt <= Date.now()
        ) {
            continue;
        }
        clients.push({
            clientId,
            clientName,
            redirectUris,
            createdAt,
            expiresAt,
            source: /** @type {const} */ ('dcr'),
        });
    }
    return clients;
}
/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Promise<void>}
 */
async function persistRegisteredClients(env = process.env) {
    registeredClientsPersistPromise = registeredClientsPersistPromise.then(
        () => writeRegisteredClientsFile(env),
        () => writeRegisteredClientsFile(env),
    );
    await registeredClientsPersistPromise;
}
/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Promise<void>}
 */
async function writeRegisteredClientsFile(env = process.env) {
    pruneRegisteredClients();
    const { clientFile } = readDevOAuthPersistenceConfig(env);
    const tempFile = `${clientFile}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
    try {
        await mkdir(path.dirname(clientFile), { recursive: true });
        const body = {
            schemaVersion: CLIENT_STORE_SCHEMA_VERSION,
            updatedAt: new Date().toISOString(),
            clients: [...registeredClients.values()]
                .filter((client) => client.source === 'dcr')
                .sort((left, right) => left.createdAt - right.createdAt || left.clientId.localeCompare(right.clientId)),
        };
        await writeFile(tempFile, `${JSON.stringify(body, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
        await rename(tempFile, clientFile);
        registeredClientsLastPersistedAt = body.updatedAt;
        registeredClientsLastPersistenceError = null;
    } catch (error) {
        registeredClientsLastPersistenceError = error instanceof Error ? error.message : String(error);
        try {
            await rm(tempFile, { force: true });
        } catch {
            // Best-effort temp cleanup only.
        }
    }
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
            audience: [config.resource, `${config.resource}/mcp`],
        });
        const scope = String(verified.payload['scope'] ?? '');
        if (!scope.split(/\s+/u).includes('openid')) {
            writeJson(res, 403, { error: 'insufficient_scope', error_description: 'openid scope is required.' });
            return;
        }
        writeJson(res, 200, {
            sub: verified.payload.sub ?? DEV_OAUTH_SUBJECT,
            email: `${DEV_OAUTH_SUBJECT}@mcp.aurelin.org`,
            email_verified: true,
            name: 'ChatGPT Dev Connector',
            preferred_username: DEV_OAUTH_SUBJECT,
        });
    } catch {
        writeJson(res, 401, { error: 'invalid_token', error_description: 'Bearer token could not be verified.' });
    }
}
/**
 * @typedef {{ allowJson: boolean; allowForm: boolean }} OAuthBodyOptions
 */

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {OAuthBodyOptions} options
 * @returns {Promise<Record<string, unknown> | undefined>}
 */
async function readOAuthRequestBody(req, res, options) {
    try {
        return await readRequestBody(req, options);
    } catch (error) {
        const statusCode =
            error && typeof error === 'object'
                ? Number(/** @type {{ statusCode?: unknown }} */ (error).statusCode)
                : 400;
        const errorDescription = error instanceof Error ? error.message : 'Invalid OAuth request body.';
        if (statusCode === 413) {
            writeJson(res, 413, { error: 'invalid_request', error_description: 'request body is too large.' });
            return undefined;
        }
        writeJson(res, Number.isFinite(statusCode) && statusCode >= 400 ? statusCode : 400, {
            error: 'invalid_request',
            error_description: errorDescription,
        });
        return undefined;
    }
}
/**
 * @param {import('node:http').IncomingMessage} req
 * @param {OAuthBodyOptions} options
 * @returns {Promise<Record<string, unknown>>}
 */
async function readRequestBody(req, options) {
    const chunks = [];
    let totalBytes = 0;
    for await (const chunk of req) {
        const buffer = Buffer.from(chunk);
        totalBytes += buffer.length;
        if (totalBytes > MAX_REQUEST_BODY_BYTES) {
            throw oauthRequestBodyError('OAuth request body is too large.', 413);
        }
        chunks.push(buffer);
    }
    const text = Buffer.concat(chunks).toString('utf8');
    if (!text.trim()) return {};
    const contentType = normalizeContentType(req.headers['content-type']);
    if (contentType === JSON_CONTENT_TYPE) {
        if (!options.allowJson)
            throw oauthRequestBodyError('application/json is not supported for this endpoint.', 415);
        return parseJsonObject(text);
    }
    if (contentType === FORM_CONTENT_TYPE) {
        if (!options.allowForm) {
            throw oauthRequestBodyError('application/x-www-form-urlencoded is not supported for this endpoint.', 415);
        }
        return Object.fromEntries(new URLSearchParams(text).entries());
    }
    throw oauthRequestBodyError('Unsupported content-type for OAuth request body.', 415);
}
/**
 * @param {string | string[] | undefined} raw
 * @returns {string}
 */
function normalizeContentType(raw) {
    const value = Array.isArray(raw) ? raw[0] : raw;
    return (
        String(value ?? '')
            .split(';', 1)[0]
            ?.trim()
            .toLowerCase() ?? ''
    );
}

/**
 * @param {string} message
 * @param {number} statusCode
 * @returns {Error & { statusCode: number }}
 */
function oauthRequestBodyError(message, statusCode) {
    return Object.assign(new Error(message), { statusCode });
}

/**
 * @param {string} text
 * @returns {Record<string, unknown>}
 */
function parseJsonObject(text) {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw oauthRequestBodyError('JSON request body must be an object.', 400);
    }
    return /** @type {Record<string, unknown>} */ (parsed);
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
    const nowMs = Date.now();
    const cached = clientMetadataDocumentCache.get(clientId);
    if (cached && cached.expiresAt > nowMs) return cached.client;
    if (cached) clientMetadataDocumentCache.delete(clientId);
    if (!isAllowedClientMetadataUrl(clientId)) return undefined;

    try {
        const parsed = await readHttpsJsonDocumentWithPublicDnsOnly(
            new URL(clientId),
            MAX_CLIENT_METADATA_RESPONSE_BYTES,
            CLIENT_METADATA_MAX_REDIRECTS,
        );
        if (!parsed) return undefined;
        const metadata = parseClientMetadata(parsed, clientId);
        if (!metadata) return undefined;
        pruneClientMetadataDocumentCache();
        trimClientMetadataDocumentCache(MAX_CLIENT_METADATA_CACHE_ENTRIES - 1);
        clientMetadataDocumentCache.set(clientId, {
            client: metadata,
            expiresAt: Date.now() + CLIENT_METADATA_CACHE_TTL_MS,
        });
        return metadata;
    } catch {
        return undefined;
    }
}
/**
 * @param {number} [nowMs]
 * @returns {number}
 */
function pruneClientMetadataDocumentCache(nowMs = Date.now()) {
    let removed = 0;
    for (const [clientId, cached] of clientMetadataDocumentCache) {
        if (cached.expiresAt <= nowMs) {
            clientMetadataDocumentCache.delete(clientId);
            removed += 1;
        }
    }
    return removed;
}

/**
 * @param {number} maxSize
 * @returns {number}
 */
function trimClientMetadataDocumentCache(maxSize) {
    if (clientMetadataDocumentCache.size <= maxSize) return 0;
    let removed = 0;
    const oldest = [...clientMetadataDocumentCache.entries()].sort(
        (left, right) => left[1].expiresAt - right[1].expiresAt,
    );
    for (const [clientId] of oldest) {
        if (clientMetadataDocumentCache.size <= maxSize) break;
        clientMetadataDocumentCache.delete(clientId);
        removed += 1;
    }
    return removed;
}

/**
 * @param {URL} url
 * @param {number} maxBytes
 * @param {number} redirectsRemaining
 * @returns {Promise<unknown | undefined>}
 */
async function readHttpsJsonDocumentWithPublicDnsOnly(url, maxBytes, redirectsRemaining) {
    if (!isAllowedClientMetadataUrl(url.toString())) return undefined;
    return new Promise((resolve) => {
        const req = httpsRequest(
            {
                protocol: 'https:',
                hostname: url.hostname,
                port: url.port || '443',
                path: `${url.pathname}${url.search}`,
                method: 'GET',
                headers: {
                    accept: 'application/json',
                    'user-agent': 'copilot-mcp-dev-oauth/1.0',
                },
                servername: url.hostname,
                timeout: CLIENT_METADATA_TIMEOUT_MS,
                lookup: /** @type {import('node:net').LookupFunction} */ (publicOnlyLookup),
            },
            (incoming) => {
                void handleClientMetadataIncomingMessage(url, incoming, maxBytes, redirectsRemaining).then(
                    resolve,
                    () => resolve(undefined),
                );
            },
        );
        req.on('timeout', () => req.destroy(new Error('Client metadata request timed out.')));
        req.on('error', () => resolve(undefined));
        req.end();
    });
}

/**
 * @param {URL} currentUrl
 * @param {import('node:http').IncomingMessage} incoming
 * @param {number} maxBytes
 * @param {number} redirectsRemaining
 * @returns {Promise<unknown | undefined>}
 */
async function handleClientMetadataIncomingMessage(currentUrl, incoming, maxBytes, redirectsRemaining) {
    const statusCode = Number(incoming.statusCode ?? 0);
    if (isRedirectStatus(statusCode)) {
        const location = firstHeaderValue(incoming.headers['location']);
        incoming.resume();
        if (!location || redirectsRemaining <= 0) return undefined;
        const nextUrl = new URL(location, currentUrl);
        if (!isAllowedClientMetadataUrl(nextUrl.toString())) return undefined;
        return readHttpsJsonDocumentWithPublicDnsOnly(nextUrl, maxBytes, redirectsRemaining - 1);
    }

    if (statusCode !== 200) {
        incoming.resume();
        return undefined;
    }

    const contentType = normalizeContentType(incoming.headers['content-type']);
    if (contentType !== JSON_CONTENT_TYPE && !contentType.endsWith('+json')) {
        incoming.resume();
        return undefined;
    }

    let totalBytes = 0;
    const chunks = [];
    for await (const chunk of incoming) {
        const buffer = Buffer.from(chunk);
        totalBytes += buffer.length;
        if (totalBytes > maxBytes) {
            incoming.destroy();
            return undefined;
        }
        chunks.push(buffer);
    }

    try {
        return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
        return undefined;
    }
}

/**
 * @param {string} hostname
 * @param {import('node:dns').LookupOptions} options
 * @param {(error: NodeJS.ErrnoException | null, address?: string | import('node:dns').LookupAddress[], family?: number) => void} callback
 * @returns {void}
 */
function publicOnlyLookup(hostname, options, callback) {
    void lookupDns(hostname, { all: true, verbatim: true })
        .then((addresses) => {
            const publicAddresses = addresses.filter((entry) => !isPrivateIpAddress(entry.address));
            if (publicAddresses.length === 0) {
                callback(
                    Object.assign(new Error('Resolved client metadata host is not public.'), { code: 'ENOTFOUND' }),
                );
                return;
            }
            const preferred =
                publicAddresses.find((entry) => typeof options === 'object' && options && entry.family === 4) ??
                publicAddresses[0];
            if (!preferred) {
                callback(Object.assign(new Error('Resolved client metadata host has no usable address.'), { code: 'ENOTFOUND' }));
                return;
            }
            callback(null, preferred.address, preferred.family);
        })
        .catch((error) =>
            callback(
                error instanceof Error
                    ? /** @type {NodeJS.ErrnoException} */ (error)
                    : Object.assign(new Error(String(error)), { code: 'ELOOKUP' }),
            ),
        );
}

/**
 * @param {number} statusCode
 * @returns {boolean}
 */
function isRedirectStatus(statusCode) {
    return statusCode === 301 || statusCode === 302 || statusCode === 303 || statusCode === 307 || statusCode === 308;
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
    const redirectUris = uniqueStrings(normalizeStringArray(metadata['redirect_uris']));
    if (redirectUris.length === 0 || redirectUris.length > MAX_REDIRECT_URIS_PER_CLIENT) return undefined;
    if (redirectUris.some((redirectUri) => !isAllowedRedirectUri(redirectUri))) return undefined;
    if (!isSupportedStringArrayMetadata(metadata['grant_types'], ['authorization_code', REFRESH_TOKEN_GRANT]))
        return undefined;
    if (!isSupportedStringArrayMetadata(metadata['response_types'], ['code'])) return undefined;
    const tokenEndpointAuthMethod = String(metadata['token_endpoint_auth_method'] ?? 'none');
    if (tokenEndpointAuthMethod !== 'none') return undefined;
    return {
        clientId,
        clientName: normalizeClientName(metadata['client_name'], 'MCP Client Metadata Document'),
        redirectUris,
        createdAt: Date.now(),
        source: 'cimd',
    };
}
/**
 * @param {string | null} scope
 * @param {import('./auth.js').McpAuthConfig} config
 * @returns {{ ok: true; scope: string } | { ok: false; scope: string }}
 */
function normalizeScope(scope, config) {
    const defaultScope = config.scopesSupported.join(' ');
    if (!scope || !scope.trim()) return { ok: true, scope: defaultScope };
    const allowed = new Set([...config.scopesSupported, ...OIDC_SCOPES].map(String));
    const requested = uniqueStrings(
        scope
            .split(/\s+/u)
            .map((item) => item.trim())
            .filter(Boolean),
    );
    if (requested.length === 0) return { ok: true, scope: defaultScope };
    if (
        requested.length > MAX_SCOPE_TOKENS ||
        requested.some((item) => !allowed.has(item) || !isValidScopeToken(item))
    ) {
        return { ok: false, scope: '' };
    }
    return { ok: true, scope: requested.join(' ') };
}
/**
 * @param {string} value
 * @returns {boolean}
 */
function isValidScopeToken(value) {
    return value.length <= MAX_SCOPE_TOKEN_LENGTH && /^[\u0021\u0023-\u005b\u005d-\u007e]+$/u.test(value);
}

/**
 * @param {URL} url
 * @param {string} name
 * @param {number} maxLength
 * @returns {string}
 */
function boundedQueryParam(url, name, maxLength) {
    const value = url.searchParams.get(name) ?? '';
    if (value.length > maxLength || hasControlCharacters(value)) return '';
    return value;
}

/**
 * @param {string | null} value
 * @param {number} maxLength
 * @returns {{ ok: true; value: string } | { ok: false; value: string }}
 */
function normalizeAuthorizationResponseParameter(value, maxLength) {
    const normalized = value ?? '';
    if (normalized.length > maxLength || hasControlCharacters(normalized)) return { ok: false, value: '' };
    return { ok: true, value: normalized };
}

/**
 * @param {string} value
 * @returns {boolean}
 */
function hasControlCharacters(value) {
    return CONTROL_CHARACTERS_PATTERN.test(value);
}

/**
 * @param {string} resource
 * @param {import('./auth.js').McpAuthConfig} config
 * @returns {boolean}
 */
function isAllowedOAuthResource(resource, config) {
    return resource === config.resource || resource === `${config.resource}/mcp`;
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
 * @param {string} value
 * @returns {boolean}
 */
function isValidPkceCodeChallenge(value) {
    return (
        value.length >= MIN_PKCE_CODE_CHALLENGE_LENGTH &&
        value.length <= MAX_PKCE_CODE_CHALLENGE_LENGTH &&
        /^[A-Za-z0-9_-]+$/u.test(value)
    );
}

/**
 * @param {string} value
 * @returns {boolean}
 */
function isValidPkceCodeVerifier(value) {
    return (
        value.length >= MIN_PKCE_CODE_VERIFIER_LENGTH &&
        value.length <= MAX_PKCE_CODE_VERIFIER_LENGTH &&
        /^[A-Za-z0-9._~-]+$/u.test(value)
    );
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
        if (value.length > MAX_CLIENT_ID_LENGTH || hasControlCharacters(value)) return false;
        const url = new URL(value);
        if (url.protocol !== 'https:' || url.username || url.password || url.pathname === '/' || url.hash) return false;
        if (url.port && url.port !== '443') return false;
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
        if (value.length > MAX_REDIRECT_URI_LENGTH || hasControlCharacters(value)) return false;
        const url = new URL(value);
        if (url.username || url.password || url.hash) return false;
        if (url.protocol === 'https:') return true;
        if (url.protocol === 'http:' && isLoopbackRedirectHostname(url.hostname)) return true;
        return false;
    } catch {
        return false;
    }
}
/**
 * @param {string} hostname
 * @returns {boolean}
 */
function isLoopbackRedirectHostname(hostname) {
    const normalized = normalizeHostname(hostname);
    if (normalized === 'localhost' || normalized.endsWith('.localhost')) return true;
    const ipv4 = parseIpv4Address(normalized);
    if (ipv4) return ipv4[0] === 127;
    return normalized === '::1' || normalized === '[::1]';
}

/**
 * @param {string} hostname
 * @returns {string}
 */
function normalizeHostname(hostname) {
    return hostname.toLowerCase().replace(/^\[/u, '').replace(/\]$/u, '').replace(/\.$/u, '');
}

/**
 * @param {string} hostname
 * @returns {boolean}
 */
function isLocalOrPrivateHostname(hostname) {
    const normalized = normalizeHostname(hostname);
    if (
        normalized === 'localhost' ||
        normalized.endsWith('.localhost') ||
        normalized.endsWith('.local') ||
        normalized.endsWith('.internal')
    ) {
        return true;
    }
    return isPrivateIpAddress(normalized);
}
/**
 * @param {string} address
 * @returns {boolean}
 */
function isPrivateIpAddress(address) {
    const normalized = normalizeHostname(address);
    const ipVersion = isIP(normalized);
    if (ipVersion === 4) {
        const ipv4 = parseIpv4Address(normalized);
        if (!ipv4) return true;
        const [first, second] = ipv4;
        return (
            first === 0 ||
            first === 10 ||
            first === 127 ||
            (first === 100 && second >= 64 && second <= 127) ||
            (first === 169 && second === 254) ||
            (first === 172 && second >= 16 && second <= 31) ||
            (first === 192 && second === 168) ||
            (first === 198 && (second === 18 || second === 19)) ||
            first >= 224
        );
    }
    if (ipVersion === 6) {
        return (
            normalized === '::1' ||
            normalized === '::' ||
            normalized.startsWith('fc') ||
            normalized.startsWith('fd') ||
            normalized.startsWith('fe80:') ||
            normalized.startsWith('::ffff:127.') ||
            normalized.startsWith('::ffff:10.') ||
            normalized.startsWith('::ffff:192.168.')
        );
    }
    return false;
}

/**
 * @param {string} value
 * @returns {[number, number, number, number] | null}
 */
function parseIpv4Address(value) {
    const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u.exec(value);
    if (!match) return null;
    const octets = match.slice(1).map((item) => Number(item));
    if (octets.some((item) => !Number.isInteger(item) || item < 0 || item > 255)) return null;
    return /** @type {[number, number, number, number]} */ (octets);
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {unknown} body
 * @returns {void}
 */
function writeJson(res, status, body) {
    const payload = `${JSON.stringify(body, null, 2)}\n`;
    res.writeHead(status, {
        ...securityHeaders(),
        'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(payload),
        'cache-control': 'no-store, no-transform',
        pragma: 'no-cache',
        expires: '0',
        'x-content-type-options': 'nosniff',
    });
    res.end(payload);
}
/**
 * @returns {Record<string, string>}
 */
function securityHeaders() {
    return {
        'strict-transport-security': 'max-age=31536000; includeSubDomains',
        'content-security-policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
        'referrer-policy': 'no-referrer',
        'x-frame-options': 'DENY',
        'cross-origin-resource-policy': 'same-origin',
    };
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {URL} target
 * @returns {void}
 */
function redirect(res, target) {
    res.writeHead(302, {
        ...securityHeaders(),
        location: target.toString(),
        'cache-control': 'no-store, no-transform',
        pragma: 'no-cache',
        expires: '0',
    });
    res.end();
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {import('./auth.js').McpAuthConfig} config
 * @param {DevOAuthClient | undefined} client
 * @param {string} redirectUri
 * @param {string} state
 * @param {string} error
 * @returns {void}
 */
function rejectOrRedirectAuthorizeError(res, config, client, redirectUri, state, error) {
    if (client && client.redirectUris.includes(redirectUri) && isAllowedRedirectUri(redirectUri)) {
        redirectWithOAuthError(res, config, redirectUri, state, error);
        return;
    }
    writeJson(res, 400, { error });
}
/**
 * @param {import('node:http').ServerResponse} res
 * @param {import('./auth.js').McpAuthConfig} config
 * @param {string} redirectUri
 * @param {string} state
 * @param {string} error
 * @returns {void}
 */
function redirectWithOAuthError(res, config, redirectUri, state, error) {
    if (!redirectUri || !isAllowedRedirectUri(redirectUri)) {
        writeJson(res, 400, { error });
        return;
    }
    const target = new URL(redirectUri);
    target.searchParams.set('error', error);
    target.searchParams.set('iss', config.resource);
    if (state) target.searchParams.set('state', state);
    redirect(res, target);
}
