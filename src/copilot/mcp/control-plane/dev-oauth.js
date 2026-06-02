// @ts-check
/**
 * Built-in development OAuth 2.1 authorization server for the ChatGPT MCP connector.
 *
 * This is intentionally scoped to local/dev MCP usage. It gives ChatGPT a real OAuth flow for the permanent Cloudflare
 * endpoint without introducing an external IdP dependency before the project chooses a production issuer.
 *
 * Version: 1.6.0
 *
 * @module copilot/mcp/control-plane/dev-oauth
 */

import {
    calculateJwkThumbprint,
    createLocalJWKSet,
    exportJWK,
    exportPKCS8,
    generateKeyPair,
    importJWK,
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

export const DEV_OAUTH_IMPLEMENTATION_VERSION = '1.6.0';
export const DEV_OAUTH_IMPLEMENTATION_NAME = 'copilot-mcp-dev-oauth';

const AUTH_CODE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
const DEFAULT_REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
const DEFAULT_CLIENT_TTL_SECONDS = 30 * 24 * 60 * 60;
const DEFAULT_KEY_FILE = 'src/copilot/.ai/mcp/oauth-dev-private-key.pem';
const DEFAULT_ES256_KEY_FILE = 'src/copilot/.ai/mcp/oauth-dev-es256-private-key.pem';
const DEFAULT_SIGNING_ALGORITHM = 'ES256';
const DEFAULT_REFRESH_TOKEN_FILE = 'src/copilot/.ai/mcp/oauth-refresh-tokens.json';
const REFRESH_TOKEN_STORE_SCHEMA_VERSION = 3;
const DEFAULT_CLIENT_FILE = 'src/copilot/.ai/mcp/oauth-clients.json';
const CLIENT_STORE_SCHEMA_VERSION = 1;
const CLIENT_METADATA_TIMEOUT_MS = 5000;
const CLIENT_METADATA_MAX_REDIRECTS = 3;
const MAX_REGISTERED_CLIENTS = 100;
const MAX_CLIENT_METADATA_CACHE_ENTRIES = 100;
const CLIENT_METADATA_CACHE_TTL_MS = 15 * 60 * 1000;
const MIN_CLIENT_METADATA_CACHE_TTL_MS = 30 * 1000;
const MAX_CLIENT_METADATA_HTTP_CACHE_TTL_MS = 60 * 60 * 1000;
const CLIENT_ASSERTION_JWKS_CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_CLIENT_ASSERTION_JWKS_CACHE_ENTRIES = 100;
const DEFAULT_REQUEST_BUDGET_WINDOW_MS = 60 * 1000;
const MAX_AUTHORIZATION_CODES = 200;
const PAR_REQUEST_TTL_MS = 90 * 1000;
const MAX_PAR_REQUESTS = 200;
const MAX_REQUEST_URI_LENGTH = 512;
const PAR_REQUEST_URI_PREFIX = 'urn:ietf:params:oauth:request_uri:';
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
    metadata: 300,
    register: 30,
    par: 60,
    revoke: 60,
    token: 60,
    jwks: 300,
    userinfo: 120,
    status: 60,
    introspect: 60,
};
const MAX_REQUEST_BODY_BYTES = 64 * 1024;
const FORM_CONTENT_TYPE = 'application/x-www-form-urlencoded';
const JSON_CONTENT_TYPE = 'application/json';
const DEV_CLIENT_METADATA_PATH = '/.well-known/oauth-client/codex-smoke.json';
const DEV_CLIENT_REDIRECT_URI = 'https://chatgpt.com/connector/oauth/codex-smoke';
const CHATGPT_CIMD_ORIGIN = 'https://chatgpt.com';
const CHATGPT_CIMD_CLIENT_PATH_PATTERN = /^\/oauth\/([A-Za-z0-9_-]{6,128})\/client\.json$/u;
const CHATGPT_CONNECTOR_REDIRECT_PATH_PREFIX = '/connector/oauth/';
const CHATGPT_LEGACY_REDIRECT_URI = 'https://chatgpt.com/connector_platform_oauth_redirect';
const PRIVATE_KEY_JWT_MAX_TTL_SECONDS = 5 * 60;
const PRIVATE_KEY_JWT_CLOCK_TOLERANCE_SECONDS = 30;
const PRIVATE_KEY_JWT_REPLAY_CACHE_MAX_ENTRIES = 2000;
const DPOP_MAX_TTL_SECONDS = 5 * 60;
const DPOP_CLOCK_TOLERANCE_SECONDS = 30;
const DPOP_REPLAY_CACHE_MAX_ENTRIES = 2000;
const DPOP_NONCE_TTL_MS = 5 * 60 * 1000;
const MAX_DPOP_NONCES = 2000;
const MAX_DPOP_NONCE_LENGTH = 256;
const MAX_DPOP_PROOF_LENGTH = 16 * 1024;
const MAX_DPOP_JKT_LENGTH = 256;
const DPOP_SIGNING_ALGORITHMS = /** @type {const} */ (['ES256', 'RS256']);
const OIDC_SCOPES = /** @type {const} */ (['openid', 'profile', 'email']);
const REFRESH_TOKEN_GRANT = 'refresh_token';
const REFRESH_TOKEN_PREFIX = 'rt_';
const REFRESH_TOKEN_FAMILY_PREFIX = 'rtf_';
const CONSUMED_REFRESH_TOKEN_HASH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const REVOKED_REFRESH_TOKEN_FAMILY_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const DEV_OAUTH_SUBJECT = 'chatgpt-dev-connector';
const SUPPORTED_TOKEN_ENDPOINT_AUTH_METHODS = /** @type {const} */ (['none', 'private_key_jwt']);
const CLIENT_ASSERTION_TYPE_JWT_BEARER = 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer';
const MAX_CLIENT_ASSERTION_LENGTH = 16 * 1024;
const CLIENT_ASSERTION_JWT_ALGORITHMS = /** @type {const} */ (['RS256', 'ES256']);
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
 *     publicJwks: Record<string, unknown>[];
 *     kid: string;
 *     alg: 'ES256' | 'RS256';
 *     legacyKeyCount: number;
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
 *         dpopJkt: string;
 *         createdAt: number;
 *     }
 * >}
 */
const authorizationCodes = new Map();

/** @type {Map<string, { params: Record<string, string>; clientId: string; createdAt: number; expiresAt: number }>} */
const pushedAuthorizationRequests = new Map();

/**
 * @typedef {{
 *     clientId: string;
 *     clientName: string;
 *     redirectUris: string[];
 *     createdAt: number;
 *     expiresAt?: number;
 *     source: 'dcr' | 'cimd';
 *     tokenEndpointAuthMethod: 'none' | 'private_key_jwt';
 *     jwksUri?: string;
 *     jwks?: { keys: Record<string, unknown>[] };
 *     trustedFallback?: boolean;
 *     trustedFallbackReason?: string;
 * }} DevOAuthClient
 */

/** @type {Map<string, DevOAuthClient>} */
const registeredClients = new Map();

/** @type {Map<string, { client: DevOAuthClient; expiresAt: number }>} */
const clientMetadataDocumentCache = new Map();

/** @type {Map<string, { jwks: { keys: Record<string, unknown>[] }; expiresAt: number }>} */
const clientAssertionJwksCache = new Map();

/** @type {Map<string, { count: number; resetAt: number }>} */
const requestBudgets = new Map();

/** @type {Map<string, number>} */
const privateKeyJwtReplayCache = new Map();

/** @type {Map<string, number>} */
const dpopReplayCache = new Map();

/** @type {Map<string, number>} */
const dpopNonces = new Map();

/** @type {Map<
    string,
    { clientId: string; scope: string; resource: string; expiresAt: number; familyId: string; dpopJkt?: string }
>} */
const renewCredentials = new Map();

/** @type {Map<string, { clientId: string; familyId: string; expiresAt: number }>} */
const consumedRefreshTokenHashes = new Map();

/** @type {Map<string, { clientId: string; expiresAt: number; reason: string }>} */
const revokedRefreshTokenFamilies = new Map();

/** @type {Promise<void> | null} */
let renewCredentialsLoadPromise = null;
let renewCredentialsLoaded = false;
let renewCredentialsLoadedFromFile = false;
let renewCredentialsLastLoadedAt = /** @type {string | null} */ (null);
let renewCredentialsLastPersistedAt = /** @type {string | null} */ (null);
let renewCredentialsLastPersistenceError = /** @type {string | null} */ (null);
let renewCredentialsLoadedConfigKey = /** @type {string | null} */ (null);
/** @type {Promise<void>} */
let renewCredentialsPersistPromise = Promise.resolve();

/** @type {Promise<void> | null} */
let registeredClientsLoadPromise = null;
let registeredClientsLoaded = false;
let registeredClientsLoadedFromFile = false;
let registeredClientsLastLoadedAt = /** @type {string | null} */ (null);
let registeredClientsLastPersistedAt = /** @type {string | null} */ (null);
let registeredClientsLastPersistenceError = /** @type {string | null} */ (null);
let registeredClientsLoadedConfigKey = /** @type {string | null} */ (null);
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
    if (config.mode !== 'oauth' || config.expectedIssuer !== config.resource) return false;
    return isAllowedDevOAuthResourceIdentifier(config.resource, env);
}

/**
 * @param {string} resource
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean}
 */
function isAllowedDevOAuthResourceIdentifier(resource, env = process.env) {
    try {
        const url = new URL(resource);
        if (url.username || url.password || url.hash || url.search) return false;
        if (url.protocol === 'https:') return true;
        if (url.protocol === 'http:' && isLoopbackRedirectHostname(url.hostname)) {
            const raw = String(env['COPILOT_MCP_DEV_OAUTH_ALLOW_HTTP_LOCALHOST'] ?? 'true')
                .trim()
                .toLowerCase();
            return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
        }
        return false;
    } catch {
        return false;
    }
}

/**
 * CIMD stays enabled by default because ChatGPT and MCP 2025-11-25 prefer Client ID Metadata Documents when the
 * authorization server advertises support. DCR remains enabled as a compatibility fallback.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean}
 */
function isDevOAuthCimdEnabled(env = process.env) {
    const raw = String(env['COPILOT_MCP_DEV_OAUTH_CIMD_ENABLED'] ?? 'true')
        .trim()
        .toLowerCase();
    return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

/**
 * @param {import('./auth.js').McpAuthConfig} config
 * @returns {Record<string, unknown>}
 */
export function buildBuiltInDevOAuthMetadata(config) {
    const scopesSupported = [...new Set([...config.scopesSupported, ...OIDC_SCOPES])];
    const cimdEnabled = isDevOAuthCimdEnabled();
    return {
        issuer: config.resource,
        authorization_endpoint: `${config.resource}/oauth/authorize`,
        pushed_authorization_request_endpoint: `${config.resource}/oauth/par`,
        require_pushed_authorization_requests: false,
        token_endpoint: `${config.resource}/oauth/token`,
        userinfo_endpoint: `${config.resource}/oauth/userinfo`,
        jwks_uri: `${config.resource}/oauth/jwks.json`,
        registration_endpoint: `${config.resource}/oauth/register`,
        revocation_endpoint: `${config.resource}/oauth/revoke`,
        introspection_endpoint: `${config.resource}/oauth/introspect`,
        client_id_metadata_document_supported: cimdEnabled,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', REFRESH_TOKEN_GRANT],
        token_endpoint_auth_methods_supported: [...SUPPORTED_TOKEN_ENDPOINT_AUTH_METHODS],
        token_endpoint_auth_signing_alg_values_supported: [...CLIENT_ASSERTION_JWT_ALGORITHMS],
        dpop_signing_alg_values_supported: [...DPOP_SIGNING_ALGORITHMS],
        code_challenge_methods_supported: ['S256'],
        scopes_supported: scopesSupported,
        resource_parameter_supported: true,
        resource_indicators_supported: [config.resource, `${config.resource}/mcp`],
        authorization_response_iss_parameter_supported: true,
        bearer_methods_supported: ['header'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['ES256', 'RS256'],
        claims_supported: [...OIDC_CLAIMS],
        authorization_signing_alg_values_supported: ['ES256', 'RS256'],
    };
}

/**
 * @param {import('./auth.js').McpAuthConfig} config
 * @returns {Record<string, unknown>}
 */
function buildBuiltInDevOpenIdConfiguration(config) {
    return {
        ...buildBuiltInDevOAuthMetadata(config),
        claims_parameter_supported: false,
        request_parameter_supported: false,
        request_uri_parameter_supported: false,
        require_request_uri_registration: false,
        userinfo_signing_alg_values_supported: ['ES256', 'RS256'],
        id_token_signing_alg_values_supported: ['ES256', 'RS256'],
    };
}

/**
 * @param {import('./auth.js').McpAuthConfig} config
 * @param {string} pathname
 * @returns {Record<string, unknown>}
 */
function buildBuiltInDevProtectedResourceMetadata(config, pathname) {
    const resource = protectedResourceIdentifierForPath(config, pathname);
    return {
        resource,
        authorization_servers: [config.resource],
        scopes_supported: [...config.scopesSupported],
        bearer_methods_supported: ['header'],
        resource_name: config.resourceName ?? 'Copilot Workspace MCP',
        resource_documentation: config.resourceDocumentation || `${config.resource}/oauth/status`,
        token_endpoint_auth_methods_supported: [...SUPPORTED_TOKEN_ENDPOINT_AUTH_METHODS],
    };
}

/**
 * @param {import('./auth.js').McpAuthConfig} config
 * @param {string} pathname
 * @returns {string}
 */
function protectedResourceIdentifierForPath(config, pathname) {
    const resourcePath = resourcePathname(config.resource);
    const pathSpecificPrefix = '/.well-known/oauth-protected-resource';
    const suffix = pathname.startsWith(pathSpecificPrefix) ? pathname.slice(pathSpecificPrefix.length) : '';
    if (suffix && suffix !== '/' && suffix !== resourcePath) {
        return `${config.resource}${suffix.startsWith('/') ? suffix : `/${suffix}`}`.replace(/\/+$/u, '');
    }
    if (suffix && suffix !== '/') return `${config.resource}${suffix}`.replace(/\/+$/u, '');
    return config.resource;
}

/**
 * @param {string} pathname
 * @param {import('./auth.js').McpAuthConfig} config
 * @returns {boolean}
 */
function isProtectedResourceMetadataEndpoint(pathname, config) {
    const resourcePath = resourcePathname(config.resource);
    return (
        pathname === '/.well-known/oauth-protected-resource' ||
        (resourcePath && pathname === `/.well-known/oauth-protected-resource${resourcePath}`) ||
        pathname === '/.well-known/oauth-protected-resource/mcp'
    );
}

/**
 * @param {string} pathname
 * @param {import('./auth.js').McpAuthConfig} config
 * @returns {boolean}
 */
function isAuthorizationServerDiscoveryEndpoint(pathname, config) {
    const resourcePath = resourcePathname(config.resource);
    const basePaths = ['/.well-known/oauth-authorization-server', '/.well-known/openid-configuration'];
    return basePaths.some(
        (basePath) =>
            pathname === basePath ||
            (resourcePath && pathname === `${basePath}${resourcePath}`) ||
            pathname === `${basePath}/mcp` ||
            (resourcePath && pathname === `${resourcePath}${basePath}`) ||
            pathname === `/mcp${basePath}`,
    );
}

/**
 * @param {string} pathname
 * @returns {boolean}
 */
function isOpenIdDiscoveryEndpoint(pathname) {
    return (
        pathname === '/.well-known/openid-configuration' ||
        pathname.startsWith('/.well-known/openid-configuration/') ||
        pathname.endsWith('/.well-known/openid-configuration')
    );
}

/**
 * @param {string} pathname
 * @returns {boolean}
 */
function isWellKnownDevOAuthPath(pathname) {
    return (
        pathname.startsWith('/.well-known/oauth-authorization-server') ||
        pathname.startsWith('/.well-known/openid-configuration') ||
        pathname.startsWith('/.well-known/oauth-protected-resource')
    );
}

/**
 * @param {string} resource
 * @returns {string}
 */
function resourcePathname(resource) {
    try {
        const pathname = new URL(resource).pathname.replace(/\/+$/u, '');
        return pathname === '/' ? '' : pathname;
    } catch {
        return '';
    }
}

/**
 * @param {string} pathname
 * @param {import('./auth.js').McpAuthConfig} config
 * @returns {boolean}
 */
function isBuiltInDevOAuthCorsPath(pathname, config) {
    return (
        isWellKnownDevOAuthPath(pathname) ||
        isAuthorizationServerDiscoveryEndpoint(pathname, config) ||
        pathname === DEV_CLIENT_METADATA_PATH ||
        pathname === '/oauth/authorize' ||
        pathname === '/oauth/par' ||
        pathname === '/oauth/token' ||
        pathname === '/oauth/register' ||
        pathname === '/oauth/revoke' ||
        pathname === '/oauth/introspect' ||
        pathname === '/oauth/userinfo' ||
        pathname === '/oauth/jwks.json' ||
        pathname === '/oauth/status'
    );
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

    if (req.method === 'OPTIONS' && isBuiltInDevOAuthCorsPath(url.pathname, config)) {
        writeCorsPreflight(res);
        return true;
    }

    const budgetName = resolveDevOAuthBudgetName(req.method, url.pathname);
    if (budgetName && !consumeDevOAuthBudget(req, budgetName)) {
        writeRateLimitExceeded(req, res, budgetName);
        return true;
    }

    if (req.method === 'GET' && isProtectedResourceMetadataEndpoint(url.pathname, config)) {
        writeJson(res, 200, buildBuiltInDevProtectedResourceMetadata(config, url.pathname));
        return true;
    }

    if (req.method === 'GET' && isAuthorizationServerDiscoveryEndpoint(url.pathname, config)) {
        writeJson(
            res,
            200,
            isOpenIdDiscoveryEndpoint(url.pathname)
                ? buildBuiltInDevOpenIdConfiguration(config)
                : buildBuiltInDevOAuthMetadata(config),
        );
        return true;
    }

    if (req.method === 'GET' && url.pathname === DEV_CLIENT_METADATA_PATH) {
        writeJson(res, 200, buildBuiltInDevOAuthClientMetadata(config));
        return true;
    }

    if (req.method === 'GET' && url.pathname === '/oauth/jwks.json') {
        const { publicJwks } = await getKeyMaterial();
        writeJson(res, 200, { keys: publicJwks });
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
            logDevOAuthEvent('WARN', 'OAuth dynamic client registration rejected.', { reason: validation.error });
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
            tokenEndpointAuthMethod: validation.tokenEndpointAuthMethod,
            ...(validation.jwksUri ? { jwksUri: validation.jwksUri } : {}),
            ...(validation.jwks ? { jwks: validation.jwks } : {}),
        };
        registeredClients.set(clientId, client);
        await persistRegisteredClients();
        writeJson(res, 201, {
            client_id: clientId,
            client_id_issued_at: Math.floor(client.createdAt / 1000),
            client_id_expires_at: Math.floor((client.expiresAt ?? client.createdAt + clientTtlSeconds * 1000) / 1000),
            client_name: client.clientName,
            redirect_uris: client.redirectUris,
            token_endpoint_auth_method: client.tokenEndpointAuthMethod,
            grant_types: ['authorization_code', REFRESH_TOKEN_GRANT],
            response_types: ['code'],
        });
        return true;
    }


    if (req.method === 'POST' && url.pathname === '/oauth/par') {
        await handlePushedAuthorizationRequest(req, res, config);
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
        await handleRevoke(req, res, config);
        return true;
    }

    if (req.method === 'POST' && url.pathname === '/oauth/introspect') {
        await handleIntrospect(req, res, config);
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
    const { kid, alg, publicJwks, legacyKeyCount } = await getKeyMaterial();
    return {
        issuer: config.resource,
        subject: DEV_OAUTH_SUBJECT,
        implementation: {
            name: DEV_OAUTH_IMPLEMENTATION_NAME,
            version: DEV_OAUTH_IMPLEMENTATION_VERSION,
        },
        oauthEnabled: true,
        diagnosticsEnabled: true,
        cimdEnabled: isDevOAuthCimdEnabled(),
        trustedChatGptCimdFallbackEnabled: isTrustedChatGptCimdFallbackEnabled(),
        trustedChatGptCimdFastPathEnabled: isTrustedChatGptCimdFastPathEnabled(),
        resourceParameterRequired: isResourceParameterRequired(),
        dpopEnabled: isDevOAuthDpopEnabled(),
        dpopAuthorizationCodeBindingEnabled: true,
        dpopNonceRequired: isDpopNonceRequired(),
        dpopTypRequired: isDpopTypRequired(),
        introspectionEnabled: true,
        introspectionClientAuthenticationRequired: isIntrospectionClientAuthenticationRequired(),
        key: { kid, alg, jwksKeyCount: publicJwks.length, legacyKeyCount },
        authorizationCodes: authorizationCodes.size,
        clientMetadataCacheEntries: clientMetadataDocumentCache.size,
        clientAssertionJwksCacheEntries: clientAssertionJwksCache.size,
        privateKeyJwtReplayCacheEntries: privateKeyJwtReplayCache.size,
        dpopReplayCacheEntries: dpopReplayCache.size,
        dpopNonceEntries: dpopNonces.size,
        pushedAuthorizationRequests: pushedAuthorizationRequests.size,
        parEnabled: true,
        pushedAuthorizationRequestTtlMs: PAR_REQUEST_TTL_MS,
        consumedRefreshTokenHashes: consumedRefreshTokenHashes.size,
        revokedRefreshTokenFamilies: revokedRefreshTokenFamilies.size,
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
 * MCP 2025-11-25 requires clients to send a Resource Indicator in both authorization and token requests. Keep this
 * enabled by default because ChatGPT already echoes the protected resource URI, and audience binding is the central
 * confused-deputy defense for remote MCP servers. It remains configurable to support ad-hoc interoperability testing
 * with older clients.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean}
 */
function isResourceParameterRequired(env = process.env) {
    const raw = String(env['COPILOT_MCP_DEV_OAUTH_REQUIRE_RESOURCE_PARAMETER'] ?? 'true')
        .trim()
        .toLowerCase();
    return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

/**
 * DPoP is optional and additive: bearer tokens remain supported for ChatGPT, while clients that send a valid DPoP proof
 * receive sender-constrained access tokens with a `cnf.jkt` confirmation claim and token_type `DPoP`.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean}
 */
function isDevOAuthDpopEnabled(env = process.env) {
    const raw = String(env['COPILOT_MCP_DEV_OAUTH_DPOP_ENABLED'] ?? 'true')
        .trim()
        .toLowerCase();
    return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

/**
 * DPoP nonce support is enabled by default for DPoP clients. Bearer clients, including ChatGPT's current public-client
 * flow, are unaffected. A DPoP client that omits a nonce receives use_dpop_nonce and can retry with the supplied
 * DPoP-Nonce header.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean}
 */
function isDpopNonceRequired(env = process.env) {
    const raw = String(env['COPILOT_MCP_DEV_OAUTH_REQUIRE_DPOP_NONCE'] ?? 'true')
        .trim()
        .toLowerCase();
    return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

/**
 * Keep DPoP `typ` enforcement configurable because older experimental clients sometimes omit it, while RFC 9449
 * recommends `typ: dpop+jwt` to prevent proof confusion with other JWTs.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean}
 */
function isDpopTypRequired(env = process.env) {
    const raw = String(env['COPILOT_MCP_DEV_OAUTH_REQUIRE_DPOP_TYP'] ?? 'false')
        .trim()
        .toLowerCase();
    return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

/**
 * Introspection is useful for diagnostics and resource-server validation, but it must not become a public token oracle.
 * By default this dev issuer requires at least a known client_id, with private_key_jwt authentication enforced for
 * confidential clients. Set the env var to false only for local debugging.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean}
 */
function isIntrospectionClientAuthenticationRequired(env = process.env) {
    const raw = String(env['COPILOT_MCP_DEV_OAUTH_INTROSPECTION_AUTH_REQUIRED'] ?? 'true')
        .trim()
        .toLowerCase();
    return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

/**
 * @returns {Promise<{
 *     privateKey: CryptoKey | import('node:crypto').KeyObject;
 *     publicJwk: Record<string, unknown>;
 *     publicJwks: Record<string, unknown>[];
 *     kid: string;
 *     alg: 'ES256' | 'RS256';
 *     legacyKeyCount: number;
 * }>}
 */
async function getKeyMaterial() {
    keyMaterialPromise ??= (async () => {
        const alg = readDevOAuthSigningAlgorithm();
        const privateKey = await readOrCreatePrivateKey(alg);
        const publicJwk = await exportPublicJwk(privateKey);
        const kid = await calculateJwkThumbprint(publicJwk);
        const activePublicJwk = {
            ...publicJwk,
            kid,
            alg,
            use: 'sig',
        };
        const publicJwks = [activePublicJwk];
        let legacyKeyCount = 0;
        if (alg !== 'RS256' || isLegacyRsaJwksOverlapEnabled()) {
            const legacyPrivateKey = await readOrCreatePrivateKey('RS256');
            const legacyPublicJwk = await exportPublicJwk(legacyPrivateKey);
            const legacyKid = await calculateJwkThumbprint(legacyPublicJwk);
            if (legacyKid !== kid) {
                publicJwks.push({
                    ...legacyPublicJwk,
                    kid: legacyKid,
                    alg: 'RS256',
                    use: 'sig',
                });
                legacyKeyCount += 1;
            }
        }
        return { privateKey, kid, publicJwk: activePublicJwk, publicJwks, alg, legacyKeyCount };
    })();
    return keyMaterialPromise;
}

/**
 * @param {'ES256' | 'RS256'} alg
 * @returns {Promise<CryptoKey | import('node:crypto').KeyObject>}
 */
async function readOrCreatePrivateKey(alg = readDevOAuthSigningAlgorithm()) {
    const keyFile = readDevOAuthKeyFile(alg);
    if (!isDevOAuthKeyRotationRequested()) {
        try {
            const pem = await readFile(keyFile, 'utf8');
            if (pem.trim()) return importPKCS8(pem, alg, { extractable: true });
        } catch {
            // Missing or unreadable key files are repaired by generating a new dev key.
        }
    }
    const { privateKey } = await generateKeyPair(alg, { extractable: true });
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
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {'ES256' | 'RS256'}
 */
function readDevOAuthSigningAlgorithm(env = process.env) {
    const raw = String(env['COPILOT_MCP_DEV_OAUTH_SIGNING_ALG'] ?? DEFAULT_SIGNING_ALGORITHM)
        .trim()
        .toUpperCase();
    return raw === 'RS256' ? 'RS256' : 'ES256';
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean}
 */
function isLegacyRsaJwksOverlapEnabled(env = process.env) {
    const raw = String(env['COPILOT_MCP_DEV_OAUTH_JWKS_INCLUDE_LEGACY_RS256'] ?? 'true')
        .trim()
        .toLowerCase();
    return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

/**
 * @returns {string}
 */
function readDevOAuthKeyFile(alg = 'RS256') {
    if (alg === 'ES256') {
        return (
            String(process.env['COPILOT_MCP_DEV_OAUTH_ES256_KEY_FILE'] ?? DEFAULT_ES256_KEY_FILE).trim() ||
            DEFAULT_ES256_KEY_FILE
        );
    }
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
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {import('./auth.js').McpAuthConfig} config
 * @returns {Promise<void>}
 */
async function handlePushedAuthorizationRequest(req, res, config) {
    const body = await readOAuthRequestBody(req, res, { allowJson: false, allowForm: true });
    if (!body) return;
    await ensureRegisteredClientsLoaded();
    prunePushedAuthorizationRequests();

    const clientId = String(body['client_id'] ?? '');
    const client = await resolveOAuthClientById(clientId);
    if (!client) {
        setBearerChallenge(res, config, 'invalid_client', 'client_id is unknown.');
        writeJson(res, 401, { error: 'invalid_client' });
        return;
    }
    if (!(await verifyClientTokenEndpointAuthentication(body, client, config, `${config.resource}/oauth/par`))) {
        setBearerChallenge(res, config, 'invalid_client', 'client authentication failed.');
        writeJson(res, 401, { error: 'invalid_client' });
        return;
    }

    const responseType = boundedBodyParam(body, 'response_type', 32);
    const redirectUri = boundedBodyParam(body, 'redirect_uri', MAX_REDIRECT_URI_LENGTH);
    const codeChallenge = boundedBodyParam(body, 'code_challenge', MAX_PKCE_CODE_CHALLENGE_LENGTH);
    const codeChallengeMethod = boundedBodyParam(body, 'code_challenge_method', 16);
    const resourceParam = boundedBodyParam(body, 'resource', MAX_RESOURCE_LENGTH);
    const resource = resourceParam || config.resource;
    const dpopJkt = boundedBodyParam(body, 'dpop_jkt', MAX_DPOP_JKT_LENGTH);
    const scopeResult = normalizeScope(String(body['scope'] ?? ''), config);
    const stateResult = normalizeAuthorizationResponseParameter(String(body['state'] ?? ''), MAX_STATE_LENGTH);
    const nonceResult = normalizeAuthorizationResponseParameter(String(body['nonce'] ?? ''), MAX_NONCE_LENGTH);

    const errors = [];
    if (responseType !== 'code') errors.push('unsupported_response_type');
    if (!client.redirectUris.includes(redirectUri)) errors.push('redirect_uri_mismatch');
    if (isResourceParameterRequired() && !resourceParam) errors.push('resource_missing');
    if (!isAllowedOAuthResource(resource, config)) errors.push('resource_not_allowed');
    if (!scopeResult.ok) errors.push('invalid_scope');
    if (!stateResult.ok || !nonceResult.ok) errors.push('invalid_request');
    if (dpopJkt && !isValidDpopJkt(dpopJkt)) errors.push('dpop_jkt_invalid');
    if (codeChallengeMethod !== 'S256') errors.push('pkce_method_not_s256');
    if (!isValidPkceCodeChallenge(codeChallenge)) errors.push('pkce_challenge_invalid');

    if (errors.length > 0) {
        logDevOAuthEvent('WARN', 'OAuth pushed authorization request rejected.', {
            errors,
            clientId: summarizeClientIdForLog(clientId),
            redirectUri: summarizeUrlForLog(redirectUri),
            resource: summarizeUrlForLog(resource),
            resourceParameterPresent: Boolean(resourceParam),
        });
        writeJson(res, 400, {
            error: errors.some((item) => item.startsWith('resource_')) ? 'invalid_target' : 'invalid_request',
            error_description: 'Pushed authorization request parameters are invalid.',
        });
        return;
    }

    trimPushedAuthorizationRequests(MAX_PAR_REQUESTS - 1);
    if (pushedAuthorizationRequests.size >= MAX_PAR_REQUESTS) {
        writeJson(res, 503, { error: 'temporarily_unavailable' });
        return;
    }

    const requestUri = `${PAR_REQUEST_URI_PREFIX}${randomUUID()}`;
    const nowMs = Date.now();
    /** @type {Record<string, string>} */
    const params = {
        response_type: responseType,
        client_id: clientId,
        redirect_uri: redirectUri,
        scope: scopeResult.scope,
        resource,
        code_challenge: codeChallenge,
        code_challenge_method: codeChallengeMethod,
        ...(stateResult.value ? { state: stateResult.value } : {}),
        ...(nonceResult.value ? { nonce: nonceResult.value } : {}),
        ...(dpopJkt ? { dpop_jkt: dpopJkt } : {}),
    };
    pushedAuthorizationRequests.set(requestUri, {
        params,
        clientId,
        createdAt: nowMs,
        expiresAt: nowMs + PAR_REQUEST_TTL_MS,
    });
    writeJson(res, 201, {
        request_uri: requestUri,
        expires_in: Math.floor(PAR_REQUEST_TTL_MS / 1000),
    });
}

/**
 * @param {string} requestUri
 * @returns {{ params: Record<string, string>; clientId: string; createdAt: number; expiresAt: number } | undefined}
 */
function consumePushedAuthorizationRequest(requestUri) {
    prunePushedAuthorizationRequests();
    if (!requestUri || requestUri.length > MAX_REQUEST_URI_LENGTH || hasControlCharacters(requestUri)) return undefined;
    const saved = pushedAuthorizationRequests.get(requestUri);
    if (!saved) return undefined;
    pushedAuthorizationRequests.delete(requestUri);
    if (saved.expiresAt <= Date.now()) return undefined;
    return saved;
}

/**
 * @param {number} [nowMs]
 * @returns {number}
 */
function prunePushedAuthorizationRequests(nowMs = Date.now()) {
    let removed = 0;
    for (const [requestUri, metadata] of pushedAuthorizationRequests) {
        if (metadata.expiresAt <= nowMs) {
            pushedAuthorizationRequests.delete(requestUri);
            removed += 1;
        }
    }
    return removed;
}

/**
 * @param {number} maxSize
 * @returns {void}
 */
function trimPushedAuthorizationRequests(maxSize) {
    if (pushedAuthorizationRequests.size <= maxSize) return;
    const oldest = [...pushedAuthorizationRequests.entries()].sort(
        (left, right) => left[1].expiresAt - right[1].expiresAt,
    );
    for (const [requestUri] of oldest) {
        if (pushedAuthorizationRequests.size <= maxSize) break;
        pushedAuthorizationRequests.delete(requestUri);
    }
}

/**
 * @param {Record<string, unknown>} body
 * @param {string} name
 * @param {number} maxLength
 * @returns {string}
 */
function boundedBodyParam(body, name, maxLength) {
    const value = String(body[name] ?? '');
    if (value.length > maxLength || hasControlCharacters(value)) return '';
    return value;
}

/**
 * @param {URLSearchParams} params
 * @param {string} name
 * @param {number} maxLength
 * @returns {string}
 */
function boundedSearchParam(params, name, maxLength) {
    const value = params.get(name) ?? '';
    if (value.length > maxLength || hasControlCharacters(value)) return '';
    return value;
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {URL} url
 * @param {import('./auth.js').McpAuthConfig} config
 * @returns {Promise<void>}
 */
async function handleAuthorize(res, url, config) {
    const requestUri = boundedQueryParam(url, 'request_uri', MAX_REQUEST_URI_LENGTH);
    const authorizeQueryClientId = boundedQueryParam(url, 'client_id', MAX_CLIENT_ID_LENGTH);
    const pushed = requestUri ? consumePushedAuthorizationRequest(requestUri) : undefined;
    if (requestUri && !pushed) {
        writeJson(res, 400, { error: 'invalid_request_uri' });
        return;
    }
    const params = pushed ? new URLSearchParams(pushed.params) : url.searchParams;
    const responseType = boundedSearchParam(params, 'response_type', 32);
    const clientId = boundedSearchParam(params, 'client_id', MAX_CLIENT_ID_LENGTH);
    const redirectUri = boundedSearchParam(params, 'redirect_uri', MAX_REDIRECT_URI_LENGTH);
    const codeChallenge = boundedSearchParam(params, 'code_challenge', MAX_PKCE_CODE_CHALLENGE_LENGTH);
    const codeChallengeMethod = boundedSearchParam(params, 'code_challenge_method', 16);
    const resourceParam = boundedSearchParam(params, 'resource', MAX_RESOURCE_LENGTH);
    const resource = resourceParam || config.resource;
    const dpopJkt = boundedSearchParam(params, 'dpop_jkt', MAX_DPOP_JKT_LENGTH);
    const scopeResult = normalizeScope(params.get('scope'), config);
    const stateResult = normalizeAuthorizationResponseParameter(params.get('state'), MAX_STATE_LENGTH);
    const nonceResult = normalizeAuthorizationResponseParameter(params.get('nonce'), MAX_NONCE_LENGTH);

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

    const authorizationRequestErrors = [];
    if (responseType !== 'code') authorizationRequestErrors.push('unsupported_response_type');
    if (pushed && authorizeQueryClientId && authorizeQueryClientId !== pushed.clientId) authorizationRequestErrors.push('request_uri_client_mismatch');
    if (!client) authorizationRequestErrors.push('unknown_client');
    if (client && !client.redirectUris.includes(redirectUri)) authorizationRequestErrors.push('redirect_uri_mismatch');
    if (isResourceParameterRequired() && !resourceParam) authorizationRequestErrors.push('resource_missing');
    if (!isAllowedOAuthResource(resource, config)) authorizationRequestErrors.push('resource_not_allowed');
    if (dpopJkt && !isValidDpopJkt(dpopJkt)) authorizationRequestErrors.push('dpop_jkt_invalid');
    if (codeChallengeMethod !== 'S256') authorizationRequestErrors.push('pkce_method_not_s256');
    if (!isValidPkceCodeChallenge(codeChallenge)) authorizationRequestErrors.push('pkce_challenge_invalid');
    if (authorizationRequestErrors.length > 0) {
        logDevOAuthEvent('WARN', 'OAuth authorization request rejected.', {
            errors: authorizationRequestErrors,
            clientId: summarizeClientIdForLog(clientId),
            clientResolved: Boolean(client),
            redirectUri: summarizeUrlForLog(redirectUri),
            resource: summarizeUrlForLog(resource),
            resourceParameterPresent: Boolean(resourceParam),
            dpopJktPresent: Boolean(dpopJkt),
            requestedScopeCount: scopeResult.ok ? scopeResult.scope.split(/\s+/u).filter(Boolean).length : null,
        });
        const authorizationError = authorizationRequestErrors.some((item) => item.startsWith('resource_'))
            ? 'invalid_target'
            : 'invalid_request';
        rejectOrRedirectAuthorizeError(res, config, client, redirectUri, stateResult.value, authorizationError);
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
        dpopJkt,
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
    const dpop = await resolveDpopBindingForRequest(req, config);
    if (!dpop.ok) {
        if (dpop.errorCode === 'use_dpop_nonce') {
            setDpopChallenge(res, 'use_dpop_nonce', 'Authorization server requires nonce in DPoP proof.');
            res.setHeader('DPoP-Nonce', issueDpopNonce());
            writeJson(res, 400, {
                error: 'use_dpop_nonce',
                error_description: 'Authorization server requires nonce in DPoP proof.',
            });
            return;
        }
        setDpopChallenge(res, 'invalid_dpop_proof', dpop.error);
        writeJson(res, 400, { error: 'invalid_dpop_proof', error_description: dpop.error });
        return;
    }
    if (dpop.jkt) res.setHeader('DPoP-Nonce', issueDpopNonce());
    const grantType = String(body['grant_type'] ?? '');
    if (grantType === 'authorization_code') {
        await handleAuthorizationCodeToken(body, res, config, dpop.jkt);
        return;
    }
    if (grantType === REFRESH_TOKEN_GRANT) {
        await handleRefreshToken(body, res, config, dpop.jkt);
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
async function handleAuthorizationCodeToken(body, res, config, dpopJkt = '') {
    const code = String(body['code'] ?? '');
    const redirectUri = String(body['redirect_uri'] ?? '');
    const codeVerifier = String(body['code_verifier'] ?? '');
    const resourceParam = String(body['resource'] ?? '');
    const clientId = String(body['client_id'] ?? '');
    const saved = authorizationCodes.get(code);
    const resource = resourceParam || saved?.resource || config.resource;

    if (!clientId) {
        logDevOAuthEvent('WARN', 'OAuth authorization-code token exchange rejected.', {
            reason: 'client_id_missing',
            redirectUri: summarizeUrlForLog(redirectUri),
            codePresent: Boolean(code),
        });
        writeJson(res, 400, { error: 'invalid_request', error_description: 'client_id is required.' });
        return;
    }

    if (isResourceParameterRequired() && !resourceParam) {
        logDevOAuthEvent('WARN', 'OAuth authorization-code token exchange rejected.', {
            reason: 'resource_missing',
            clientId: summarizeClientIdForLog(clientId),
            redirectUri: summarizeUrlForLog(redirectUri),
            codePresent: Boolean(code),
        });
        writeJson(res, 400, { error: 'invalid_target', error_description: 'resource parameter is required.' });
        return;
    }

    if (saved?.dpopJkt && saved.dpopJkt !== dpopJkt) {
        logDevOAuthEvent('WARN', 'OAuth authorization-code token exchange rejected.', {
            reason: dpopJkt ? 'dpop_jkt_mismatch' : 'dpop_required',
            clientId: summarizeClientIdForLog(clientId),
            redirectUri: summarizeUrlForLog(redirectUri),
            codePresent: Boolean(code),
        });
        writeJson(res, 400, {
            error: 'invalid_dpop_proof',
            error_description: 'DPoP proof does not match the authorization request dpop_jkt.',
        });
        return;
    }

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
        logDevOAuthEvent('WARN', 'OAuth authorization-code token exchange rejected.', {
            reason: 'invalid_grant',
            clientId: summarizeClientIdForLog(clientId),
            redirectUri: summarizeUrlForLog(redirectUri),
            resource: summarizeUrlForLog(resource),
            codePresent: Boolean(code),
        });
        writeJson(res, 400, { error: 'invalid_grant' });
        return;
    }

    const client = await resolveOAuthClientById(clientId);
    if (!client || !(await verifyClientTokenEndpointAuthentication(body, client, config))) {
        logDevOAuthEvent('WARN', 'OAuth authorization-code token exchange rejected.', {
            reason: !client ? 'unknown_client' : 'client_authentication_failed',
            clientId: summarizeClientIdForLog(clientId),
            tokenEndpointAuthMethod: client?.tokenEndpointAuthMethod ?? null,
        });
        setBearerChallenge(res, config, 'invalid_client', 'Client authentication failed.');
        writeJson(res, 401, { error: 'invalid_client' });
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
                dpopJkt,
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
async function handleRefreshToken(body, res, config, dpopJkt = '') {
    const clientId = String(body['client_id'] ?? '');
    const credential = String(body[REFRESH_TOKEN_GRANT] ?? '');
    const resourceParam = String(body['resource'] ?? '');
    await ensureRenewCredentialsLoaded();
    pruneConsumedRefreshTokenHashes();
    pruneRevokedRefreshTokenFamilies();
    const credentialHash = hashRefreshToken(credential);
    const saved = renewCredentials.get(credentialHash);
    const consumed = saved ? undefined : lookupConsumedRefreshTokenHash(credentialHash);
    if (consumed) {
        const removed = revokeRefreshTokenFamily(consumed.familyId, consumed.clientId, 'refresh-token-reuse');
        await persistRenewCredentials();
        logDevOAuthEvent('WARN', 'OAuth refresh token reuse detected; refresh token family revoked.', {
            clientId: summarizeClientIdForLog(clientId || consumed.clientId),
            familyRevoked: true,
            activeTokensRemoved: removed,
        });
        writeJson(res, 400, { error: 'invalid_grant' });
        return;
    }

    const scopeResult = saved ? normalizeScope(saved.scope, config) : { ok: false, scope: '' };

    if (isResourceParameterRequired() && !resourceParam) {
        logDevOAuthEvent('WARN', 'OAuth refresh token exchange rejected.', {
            reason: 'resource_missing',
            clientId: summarizeClientIdForLog(clientId),
            resource: summarizeUrlForLog(resourceParam || saved?.resource || ''),
            credentialPresent: Boolean(credential),
        });
        writeJson(res, 400, { error: 'invalid_target', error_description: 'resource parameter is required.' });
        return;
    }

    if (saved?.dpopJkt && saved.dpopJkt !== dpopJkt) {
        logDevOAuthEvent('WARN', 'OAuth refresh token exchange rejected.', {
            reason: dpopJkt ? 'dpop_jkt_mismatch' : 'dpop_required',
            clientId: summarizeClientIdForLog(clientId),
            credentialPresent: Boolean(credential),
        });
        setDpopChallenge(res, 'invalid_dpop_proof', 'DPoP proof is required for this refresh token.');
        writeJson(res, 401, {
            error: 'invalid_token',
            error_description: 'DPoP proof is required for this refresh token.',
        });
        return;
    }

    if (
        !saved ||
        saved.clientId !== clientId ||
        !scopeResult.ok ||
        !isAllowedOAuthResource(saved.resource, config) ||
        (resourceParam && resourceParam !== saved.resource) ||
        isRefreshTokenFamilyRevoked(saved.familyId) ||
        Date.now() > saved.expiresAt
    ) {
        if (saved) {
            renewCredentials.delete(credentialHash);
            rememberConsumedRefreshTokenHash(credentialHash, saved);
            await persistRenewCredentials();
        }
        logDevOAuthEvent('WARN', 'OAuth refresh token exchange rejected.', {
            reason: 'invalid_grant',
            clientId: summarizeClientIdForLog(clientId),
            credentialPresent: Boolean(credential),
        });
        writeJson(res, 400, { error: 'invalid_grant' });
        return;
    }

    const client = await resolveOAuthClientById(clientId);
    if (!client || !(await verifyClientTokenEndpointAuthentication(body, client, config))) {
        logDevOAuthEvent('WARN', 'OAuth refresh token exchange rejected.', {
            reason: !client ? 'unknown_client' : 'client_authentication_failed',
            clientId: summarizeClientIdForLog(clientId),
            tokenEndpointAuthMethod: client?.tokenEndpointAuthMethod ?? null,
        });
        setBearerChallenge(res, config, 'invalid_client', 'Client authentication failed.');
        writeJson(res, 401, { error: 'invalid_client' });
        return;
    }

    let tokenSet;
    try {
        tokenSet = await issueTokenSet(
            {
                clientId,
                scope: scopeResult.scope,
                resource: saved.resource,
                nonce: null,
                includeIdToken: scopeResult.scope.split(/\s+/u).includes('openid'),
                refreshFamilyId: saved.familyId,
                dpopJkt: saved.dpopJkt || dpopJkt,
            },
            config,
        );
    } catch (error) {
        logDevOAuthEvent('ERROR', 'OAuth refresh token rotation failed before consuming old token.', {
            clientId: summarizeClientIdForLog(clientId),
            error: error instanceof Error ? error.message : String(error),
        });
        writeJson(res, 503, { error: 'temporarily_unavailable' });
        return;
    }

    renewCredentials.delete(credentialHash);
    rememberConsumedRefreshTokenHash(credentialHash, saved);
    await persistRenewCredentials();
    writeJson(res, 200, tokenSet);
}
/**
 * @param {string} clientId
 * @returns {Promise<DevOAuthClient | undefined>}
 */
async function resolveOAuthClientById(clientId) {
    await ensureRegisteredClientsLoaded();
    return registeredClients.get(clientId) ?? (await resolveClientMetadataDocument(clientId));
}

/**
 * @param {Record<string, unknown>} body
 * @param {DevOAuthClient} client
 * @param {import('./auth.js').McpAuthConfig} config
 * @param {string} [expectedAudience]
 * @returns {Promise<boolean>}
 */
async function verifyClientTokenEndpointAuthentication(body, client, config, expectedAudience = `${config.resource}/oauth/token`) {
    const method = client.tokenEndpointAuthMethod ?? 'none';
    if (method === 'none') return true;
    if (method !== 'private_key_jwt') return false;

    const assertionType = String(body['client_assertion_type'] ?? '');
    const assertion = String(body['client_assertion'] ?? '');
    if (
        assertionType !== CLIENT_ASSERTION_TYPE_JWT_BEARER ||
        !assertion ||
        assertion.length > MAX_CLIENT_ASSERTION_LENGTH ||
        hasControlCharacters(assertion)
    ) {
        return false;
    }

    try {
        const keySet = await resolveClientAssertionJwks(client);
        if (!keySet) return false;
        const verified = await jwtVerify(assertion, keySet, {
            issuer: client.clientId,
            subject: client.clientId,
            audience: [...new Set([expectedAudience, `${config.resource}/oauth/token`, config.resource])],
            algorithms: [...CLIENT_ASSERTION_JWT_ALGORITHMS],
            clockTolerance: PRIVATE_KEY_JWT_CLOCK_TOLERANCE_SECONDS,
        });
        return acceptPrivateKeyJwtClaims(verified.payload, client);
    } catch (error) {
        logDevOAuthEvent('WARN', 'OAuth private_key_jwt client assertion rejected.', {
            clientId: summarizeClientIdForLog(client.clientId),
            error: error instanceof Error ? error.message : String(error),
        });
        return false;
    }
}

/**
 * Resolve client assertion keys with the same SSRF-safe fetch path used for CIMD documents. Do not delegate jwks_uri
 * fetching to generic HTTP clients, because malicious metadata can otherwise turn token exchange into SSRF.
 *
 * @param {DevOAuthClient} client
 * @returns {Promise<ReturnType<typeof createLocalJWKSet> | undefined>}
 */
async function resolveClientAssertionJwks(client) {
    if (client.jwks && Array.isArray(client.jwks.keys) && client.jwks.keys.length > 0) {
        return createLocalJWKSet(client.jwks);
    }
    if (!client.jwksUri) return undefined;

    const nowMs = Date.now();
    const cached = clientAssertionJwksCache.get(client.jwksUri);
    if (cached && cached.expiresAt > nowMs) return createLocalJWKSet(cached.jwks);
    if (cached) clientAssertionJwksCache.delete(client.jwksUri);

    try {
        const fetched = await readHttpsJsonDocumentWithPublicDnsOnlyWithCache(
            new URL(client.jwksUri),
            MAX_CLIENT_METADATA_RESPONSE_BYTES,
            CLIENT_METADATA_MAX_REDIRECTS,
        );
        const jwks = normalizeInlineClientJwks(fetched?.document);
        if (!jwks) return undefined;
        trimClientAssertionJwksCache(MAX_CLIENT_ASSERTION_JWKS_CACHE_ENTRIES - 1);
        clientAssertionJwksCache.set(client.jwksUri, {
            jwks,
            expiresAt:
                Date.now() +
                Math.min(fetched?.cacheTtlMs ?? CLIENT_ASSERTION_JWKS_CACHE_TTL_MS, CLIENT_ASSERTION_JWKS_CACHE_TTL_MS),
        });
        return createLocalJWKSet(jwks);
    } catch (error) {
        logDevOAuthEvent('WARN', 'OAuth private_key_jwt JWKS resolution failed.', {
            clientId: summarizeClientIdForLog(client.clientId),
            jwksUri: summarizeUrlForLog(client.jwksUri),
            error: error instanceof Error ? error.message : String(error),
        });
        return undefined;
    }
}

/**
 * @param {number} maxSize
 * @returns {void}
 */
function trimClientAssertionJwksCache(maxSize) {
    if (clientAssertionJwksCache.size <= maxSize) return;
    const oldest = [...clientAssertionJwksCache.entries()].sort(
        (left, right) => left[1].expiresAt - right[1].expiresAt,
    );
    for (const [uri] of oldest) {
        if (clientAssertionJwksCache.size <= maxSize) break;
        clientAssertionJwksCache.delete(uri);
    }
}

/**
 * @param {import('jose').JWTPayload} payload
 * @param {DevOAuthClient} client
 * @returns {boolean}
 */
function acceptPrivateKeyJwtClaims(payload, client) {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const exp = Number(payload.exp);
    const iat = Number(payload.iat);
    const jti = typeof payload.jti === 'string' ? payload.jti : '';

    if (!Number.isFinite(exp) || !Number.isFinite(iat) || !jti || jti.length > 256 || hasControlCharacters(jti)) {
        logDevOAuthEvent('WARN', 'OAuth private_key_jwt rejected because required claims are missing or invalid.', {
            clientId: summarizeClientIdForLog(client.clientId),
            expPresent: Number.isFinite(exp),
            iatPresent: Number.isFinite(iat),
            jtiPresent: Boolean(jti),
            jtiValid: Boolean(jti && jti.length <= 256 && !hasControlCharacters(jti)),
        });
        return false;
    }

    if (iat > nowSeconds + PRIVATE_KEY_JWT_CLOCK_TOLERANCE_SECONDS) return false;
    if (exp <= nowSeconds - PRIVATE_KEY_JWT_CLOCK_TOLERANCE_SECONDS) return false;
    if (exp - iat > PRIVATE_KEY_JWT_MAX_TTL_SECONDS + PRIVATE_KEY_JWT_CLOCK_TOLERANCE_SECONDS) {
        logDevOAuthEvent('WARN', 'OAuth private_key_jwt rejected because its lifetime is too long.', {
            clientId: summarizeClientIdForLog(client.clientId),
            lifetimeSeconds: exp - iat,
        });
        return false;
    }

    prunePrivateKeyJwtReplayCache();
    const replayKey = `${client.clientId}:${jti}`;
    if (privateKeyJwtReplayCache.has(replayKey)) {
        logDevOAuthEvent('WARN', 'OAuth private_key_jwt replay rejected.', {
            clientId: summarizeClientIdForLog(client.clientId),
        });
        return false;
    }
    privateKeyJwtReplayCache.set(replayKey, exp * 1000);
    trimPrivateKeyJwtReplayCache(PRIVATE_KEY_JWT_REPLAY_CACHE_MAX_ENTRIES);
    return true;
}

/**
 * @param {number} [nowMs]
 * @returns {number}
 */
function prunePrivateKeyJwtReplayCache(nowMs = Date.now()) {
    let removed = 0;
    for (const [key, expiresAt] of privateKeyJwtReplayCache) {
        if (expiresAt <= nowMs) {
            privateKeyJwtReplayCache.delete(key);
            removed += 1;
        }
    }
    return removed;
}

/**
 * @param {number} maxSize
 * @returns {void}
 */
function trimPrivateKeyJwtReplayCache(maxSize) {
    if (privateKeyJwtReplayCache.size <= maxSize) return;
    const oldest = [...privateKeyJwtReplayCache.entries()].sort((left, right) => left[1] - right[1]);
    for (const [key] of oldest) {
        if (privateKeyJwtReplayCache.size <= maxSize) break;
        privateKeyJwtReplayCache.delete(key);
    }
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {import('./auth.js').McpAuthConfig} config
 * @returns {Promise<{ ok: true; jkt: string } | { ok: true; jkt: '' } | { ok: false; error: string; errorCode?: string }>}
 */
async function resolveDpopBindingForRequest(req, config) {
    const proof = firstHeaderValue(req.headers['dpop']);
    if (!proof) return { ok: true, jkt: '' };
    if (!isDevOAuthDpopEnabled()) return { ok: false, error: 'DPoP is not enabled for this issuer.' };
    return verifyDpopProof(proof, {
        method: String(req.method ?? 'POST').toUpperCase(),
        htu: `${config.resource}/oauth/token`,
    });
}

/**
 * @param {string} proof
 * @param {{ method: string; htu: string }} expected
 * @returns {Promise<{ ok: true; jkt: string } | { ok: false; error: string; errorCode?: string }>}
 */
async function verifyDpopProof(proof, expected) {
    if (!proof || proof.length > MAX_DPOP_PROOF_LENGTH || hasControlCharacters(proof)) {
        return { ok: false, error: 'DPoP proof is missing or too large.' };
    }
    try {
        const header = decodeJwtHeader(proof);
        const jwk = header['jwk'];
        const alg = String(header['alg'] ?? '');
        const typ = String(header['typ'] ?? '').toLowerCase();
        if (isDpopTypRequired() && typ !== 'dpop+jwt') {
            return { ok: false, error: 'DPoP proof typ must be dpop+jwt.' };
        }
        if (!DPOP_SIGNING_ALGORITHMS.includes(/** @type {'ES256' | 'RS256'} */ (alg))) {
            return { ok: false, error: 'DPoP proof uses an unsupported signing algorithm.' };
        }
        if (!jwk || typeof jwk !== 'object' || Array.isArray(jwk)) {
            return { ok: false, error: 'DPoP proof is missing an embedded public JWK.' };
        }
        if (hasPrivateJwkFields(/** @type {Record<string, unknown>} */ (jwk))) {
            return { ok: false, error: 'DPoP proof JWK must be public.' };
        }
        const key = await importJWK(/** @type {Record<string, unknown>} */ (jwk), alg);
        const verified = await jwtVerify(proof, key, {
            algorithms: [...DPOP_SIGNING_ALGORITHMS],
            clockTolerance: DPOP_CLOCK_TOLERANCE_SECONDS,
            maxTokenAge: `${DPOP_MAX_TTL_SECONDS}s`,
        });
        const payload = verified.payload;
        const htm = String(payload['htm'] ?? '').toUpperCase();
        const htu = normalizeDpopHtu(String(payload['htu'] ?? ''));
        const expectedHtu = normalizeDpopHtu(expected.htu);
        const iat = Number(payload.iat);
        const jti = typeof payload.jti === 'string' ? payload.jti : '';
        if (!Number.isFinite(iat)) return { ok: false, error: 'DPoP proof iat is missing.' };
        if (htm !== expected.method.toUpperCase()) return { ok: false, error: 'DPoP proof htm does not match.' };
        if (htu !== expectedHtu) return { ok: false, error: 'DPoP proof htu does not match.' };
        if (!jti || jti.length > 256 || hasControlCharacters(jti))
            return { ok: false, error: 'DPoP proof jti is missing or invalid.' };
        if (isDpopNonceRequired()) {
            const nonce = typeof payload['nonce'] === 'string' ? payload['nonce'] : '';
            if (!isValidDpopNonce(nonce)) {
                return {
                    ok: false,
                    error: 'Authorization server requires nonce in DPoP proof.',
                    errorCode: 'use_dpop_nonce',
                };
            }
        }
        const publicJwk = /** @type {Record<string, unknown>} */ ({ ...jwk });
        for (const privateField of ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth']) delete publicJwk[privateField];
        const jkt = await calculateJwkThumbprint(publicJwk);
        pruneDpopReplayCache();
        const replayKey = `${jkt}:${jti}`;
        if (dpopReplayCache.has(replayKey)) return { ok: false, error: 'DPoP proof replay detected.' };
        const expMs = Number(payload.exp) ? Number(payload.exp) * 1000 : Date.now() + DPOP_MAX_TTL_SECONDS * 1000;
        dpopReplayCache.set(replayKey, expMs);
        trimDpopReplayCache(DPOP_REPLAY_CACHE_MAX_ENTRIES);
        return { ok: true, jkt };
    } catch (error) {
        return {
            ok: false,
            error: error instanceof Error ? sanitizeLogString(error.message, 240) : 'DPoP proof could not be verified.',
        };
    }
}

/**
 * @param {string} jwt
 * @returns {Record<string, unknown>}
 */
function decodeJwtHeader(jwt) {
    const [encoded] = jwt.split('.', 1);
    if (!encoded) throw new Error('JWT header is missing.');
    return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
}

/**
 * @param {Record<string, unknown>} jwk
 * @returns {boolean}
 */
function hasPrivateJwkFields(jwk) {
    return ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth'].some((field) => Object.prototype.hasOwnProperty.call(jwk, field));
}

/**
 * @param {string} value
 * @returns {string}
 */
function normalizeDpopHtu(value) {
    try {
        const url = new URL(value);
        url.hash = '';
        return url.toString();
    } catch {
        return '';
    }
}

/**
 * @param {number} [nowMs]
 * @returns {number}
 */
function pruneDpopReplayCache(nowMs = Date.now()) {
    let removed = 0;
    for (const [key, expiresAt] of dpopReplayCache) {
        if (expiresAt <= nowMs) {
            dpopReplayCache.delete(key);
            removed += 1;
        }
    }
    return removed;
}

/**
 * @param {number} maxSize
 * @returns {void}
 */
function trimDpopReplayCache(maxSize) {
    if (dpopReplayCache.size <= maxSize) return;
    const oldest = [...dpopReplayCache.entries()].sort((left, right) => left[1] - right[1]);
    for (const [key] of oldest) {
        if (dpopReplayCache.size <= maxSize) break;
        dpopReplayCache.delete(key);
    }
}

/**
 * @returns {string}
 */
function issueDpopNonce() {
    pruneDpopNonces();
    trimDpopNonces(MAX_DPOP_NONCES - 1);
    const nonce = randomUUID().replace(/-/gu, '');
    dpopNonces.set(nonce, Date.now() + DPOP_NONCE_TTL_MS);
    return nonce;
}

/**
 * @param {string} nonce
 * @returns {boolean}
 */
function isValidDpopNonce(nonce) {
    if (!nonce || nonce.length > MAX_DPOP_NONCE_LENGTH || hasControlCharacters(nonce)) return false;
    pruneDpopNonces();
    const expiresAt = dpopNonces.get(nonce);
    return Number.isFinite(expiresAt) && Number(expiresAt) > Date.now();
}

/**
 * @param {number} [nowMs]
 * @returns {number}
 */
function pruneDpopNonces(nowMs = Date.now()) {
    let removed = 0;
    for (const [nonce, expiresAt] of dpopNonces) {
        if (expiresAt <= nowMs) {
            dpopNonces.delete(nonce);
            removed += 1;
        }
    }
    return removed;
}

/**
 * @param {number} maxSize
 * @returns {void}
 */
function trimDpopNonces(maxSize) {
    if (dpopNonces.size <= maxSize) return;
    const oldest = [...dpopNonces.entries()].sort((left, right) => left[1] - right[1]);
    for (const [nonce] of oldest) {
        if (dpopNonces.size <= maxSize) break;
        dpopNonces.delete(nonce);
    }
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {import('./auth.js').McpAuthConfig} config
 * @returns {Promise<void>}
 */
async function handleRevoke(req, res, config) {
    const body = await readOAuthRequestBody(req, res, { allowJson: false, allowForm: true });
    if (!body) return;
    const credential = String(body['token'] ?? '');
    const clientId = String(body['client_id'] ?? '');
    await ensureRenewCredentialsLoaded();
    const credentialHash = credential.startsWith(REFRESH_TOKEN_PREFIX) ? hashRefreshToken(credential) : '';
    const saved = credentialHash ? renewCredentials.get(credentialHash) : undefined;
    const effectiveClientId = clientId || saved?.clientId || '';
    const client = effectiveClientId ? await resolveOAuthClientById(effectiveClientId) : undefined;

    if (client && client.tokenEndpointAuthMethod !== 'none') {
        if (!(await verifyClientTokenEndpointAuthentication(body, client, config))) {
            logDevOAuthEvent('WARN', 'OAuth token revocation rejected.', {
                reason: 'client_authentication_failed',
                clientId: summarizeClientIdForLog(effectiveClientId),
                tokenEndpointAuthMethod: client.tokenEndpointAuthMethod,
            });
            writeJson(res, 401, { error: 'invalid_client' });
            return;
        }
    }

    if (credentialHash && saved && (!clientId || saved.clientId === clientId)) {
        renewCredentials.delete(credentialHash);
        rememberConsumedRefreshTokenHash(credentialHash, saved);
        await persistRenewCredentials();
    }

    writeJson(res, 200, {});
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {import('./auth.js').McpAuthConfig} config
 * @returns {Promise<void>}
 */
async function handleIntrospect(req, res, config) {
    const body = await readOAuthRequestBody(req, res, { allowJson: false, allowForm: true });
    if (!body) return;
    const token = String(body['token'] ?? '');
    const clientId = String(body['client_id'] ?? '');
    if (!token || hasControlCharacters(token) || token.length > MAX_CLIENT_ASSERTION_LENGTH * 4) {
        writeJson(res, 200, { active: false });
        return;
    }
    const client = clientId ? await resolveOAuthClientById(clientId) : undefined;
    if (isIntrospectionClientAuthenticationRequired() && !client) {
        setBearerChallenge(res, config, 'invalid_client', 'Client authentication failed.');
        writeJson(res, 401, { error: 'invalid_client' });
        return;
    }
    if (client && client.tokenEndpointAuthMethod !== 'none') {
        if (!(await verifyClientTokenEndpointAuthentication(body, client, config))) {
            writeJson(res, 401, { error: 'invalid_client' });
            return;
        }
    }

    if (token.startsWith(REFRESH_TOKEN_PREFIX)) {
        await ensureRenewCredentialsLoaded();
        const saved = renewCredentials.get(hashRefreshToken(token));
        if (
            !saved ||
            (clientId && saved.clientId !== clientId) ||
            Date.now() > saved.expiresAt ||
            isRefreshTokenFamilyRevoked(saved.familyId)
        ) {
            writeJson(res, 200, { active: false });
            return;
        }
        writeJson(res, 200, {
            active: true,
            token_type: 'refresh_token',
            client_id: saved.clientId,
            scope: saved.scope,
            aud: saved.resource,
            resource: saved.resource,
            exp: Math.floor(saved.expiresAt / 1000),
            ...(saved.dpopJkt ? { cnf: { jkt: saved.dpopJkt } } : {}),
        });
        return;
    }

    try {
        const { publicJwks } = await getKeyMaterial();
        const jwks = createLocalJWKSet({ keys: publicJwks });
        const verified = await jwtVerify(token, jwks, {
            issuer: config.resource,
            audience: [config.resource, `${config.resource}/mcp`],
            algorithms: ['ES256', 'RS256'],
        });
        const payload = verified.payload;
        if (clientId && String(payload['client_id'] ?? '') !== clientId) {
            writeJson(res, 200, { active: false });
            return;
        }
        writeJson(res, 200, {
            active: true,
            token_type: payload['cnf'] ? 'DPoP' : 'Bearer',
            client_id: payload['client_id'] ?? null,
            scope: payload['scope'] ?? '',
            sub: payload.sub ?? DEV_OAUTH_SUBJECT,
            iss: payload.iss ?? config.resource,
            aud: payload.aud ?? null,
            resource: payload['resource'] ?? null,
            exp: payload.exp ?? null,
            iat: payload.iat ?? null,
            jti: payload.jti ?? null,
            ...(payload['cnf'] ? { cnf: payload['cnf'] } : {}),
        });
    } catch {
        writeJson(res, 200, { active: false });
    }
}

/**
 * @param {{
 *     clientId: string;
 *     scope: string;
 *     resource: string;
 *     includeIdToken: boolean;
 *     nonce?: string | null;
 *     refreshFamilyId?: string;
 *     dpopJkt?: string;
 * }} options
 * @param {import('./auth.js').McpAuthConfig} config
 * @returns {Promise<Record<string, unknown>>}
 */
async function issueTokenSet(options, config) {
    const { privateKey, kid, alg } = await getKeyMaterial();
    const nowSeconds = Math.floor(Date.now() / 1000);
    const { accessTokenTtlSeconds, refreshTokenTtlSeconds } = readDevOAuthTokenLifetimePolicy();
    const accessToken = await new SignJWT({
        scope: options.scope,
        client_id: options.clientId,
        resource: options.resource,
        ...(options.dpopJkt ? { cnf: { jkt: options.dpopJkt } } : {}),
    })
        .setProtectedHeader({ alg, kid })
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
              .setProtectedHeader({ alg, kid })
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
        token_type: options.dpopJkt ? 'DPoP' : 'Bearer',
        expires_in: accessTokenTtlSeconds,
        scope: options.scope,
        [REFRESH_TOKEN_GRANT]: await issueRefreshToken(
            options.clientId,
            options.scope,
            options.resource,
            refreshTokenTtlSeconds,
            options.refreshFamilyId,
            options.dpopJkt,
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
 * @returns {string}
 */
function devOAuthPersistenceConfigKey(env = process.env) {
    const config = readDevOAuthPersistenceConfig(env);
    return `${config.refreshTokenFile}\n${config.clientFile}`;
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Promise<{
 *     refreshTokenFile: string;
 *     persistenceEnabled: true;
 *     loaded: boolean;
 *     loadedFromFile: boolean;
 *     tokenCount: number;
 *     consumedRefreshTokenHashCount: number;
 *     revokedRefreshTokenFamilyCount: number;
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
    pruneConsumedRefreshTokenHashes();
    pruneRevokedRefreshTokenFamilies();
    if (pruned) await persistRenewCredentials(env);
    const prunedClients = pruneRegisteredClients();
    if (prunedClients) await persistRegisteredClients(env);
    const persistenceConfig = readDevOAuthPersistenceConfig(env);
    return {
        ...persistenceConfig,
        loaded: renewCredentialsLoaded,
        loadedFromFile: renewCredentialsLoadedFromFile,
        tokenCount: renewCredentials.size,
        consumedRefreshTokenHashCount: consumedRefreshTokenHashes.size,
        revokedRefreshTokenFamilyCount: revokedRefreshTokenFamilies.size,
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
    clientAssertionJwksCache.clear();
    requestBudgets.clear();
    privateKeyJwtReplayCache.clear();
    dpopReplayCache.clear();
    dpopNonces.clear();
    pushedAuthorizationRequests.clear();
    renewCredentials.clear();
    consumedRefreshTokenHashes.clear();
    revokedRefreshTokenFamilies.clear();
    renewCredentialsLoadPromise = null;
    renewCredentialsLoaded = false;
    renewCredentialsLoadedFromFile = false;
    renewCredentialsLastLoadedAt = null;
    renewCredentialsLastPersistedAt = null;
    renewCredentialsLastPersistenceError = null;
    renewCredentialsLoadedConfigKey = null;
    renewCredentialsPersistPromise = Promise.resolve();
    registeredClientsLoadPromise = null;
    registeredClientsLoaded = false;
    registeredClientsLoadedFromFile = false;
    registeredClientsLastLoadedAt = null;
    registeredClientsLastPersistedAt = null;
    registeredClientsLastPersistenceError = null;
    registeredClientsLoadedConfigKey = null;
    registeredClientsPersistPromise = Promise.resolve();
}
/**
 * @param {string | undefined} method
 * @param {string} pathname
 * @returns {string | null}
 */
function resolveDevOAuthBudgetName(method, pathname) {
    if (method === 'GET' && pathname === '/oauth/authorize') return 'authorize';
    if (method === 'GET' && isWellKnownDevOAuthPath(pathname)) return 'metadata';
    if (method === 'GET' && pathname === DEV_CLIENT_METADATA_PATH) return 'metadata';
    if (method === 'GET' && pathname === '/oauth/jwks.json') return 'jwks';
    if (method === 'GET' && pathname === '/oauth/status') return 'status';
    if (method === 'POST' && pathname === '/oauth/register') return 'register';
    if (method === 'POST' && pathname === '/oauth/par') return 'par';
    if (method === 'POST' && pathname === '/oauth/revoke') return 'revoke';
    if (method === 'POST' && pathname === '/oauth/introspect') return 'introspect';
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
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {string} name
 * @returns {void}
 */
function writeRateLimitExceeded(req, res, name) {
    const subject = readRequestBudgetSubject(req);
    const current = requestBudgets.get(`${name}:${subject}`);
    const nowMs = Date.now();
    const retryAfterSeconds = Math.max(1, Math.ceil(((current?.resetAt ?? nowMs + 1000) - nowMs) / 1000));
    const limit = readRequestBudgetLimit(name);
    res.setHeader('Retry-After', String(retryAfterSeconds));
    res.setHeader('X-RateLimit-Limit', String(limit));
    res.setHeader('X-RateLimit-Remaining', '0');
    res.setHeader('X-RateLimit-Reset', String(Math.floor(((current?.resetAt ?? nowMs) / 1000))));
    writeJson(res, 429, { error: 'temporarily_unavailable' });
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
    if (isTrustedCloudflareHeaderRequest(req) && isSafeRequestBudgetSubject(cloudflareIp)) return cloudflareIp;

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
 * @param {import('node:http').IncomingMessage} req
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean}
 */
function isTrustedCloudflareHeaderRequest(req, env = process.env) {
    const raw = String(env['COPILOT_MCP_DEV_OAUTH_TRUST_CLOUDFLARE_HEADERS'] ?? 'loopback')
        .trim()
        .toLowerCase();
    if (raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on') return true;
    if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'off') return false;
    return isLoopbackSocketAddress(String(req.socket?.remoteAddress ?? ''));
}

/**
 * @param {string} address
 * @returns {boolean}
 */
function isLoopbackSocketAddress(address) {
    const normalized = normalizeHostname(address);
    return (
        normalized === 'localhost' ||
        normalized === '127.0.0.1' ||
        normalized === '::1' ||
        normalized === '::ffff:127.0.0.1'
    );
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
 * @returns {{
 *           ok: true;
 *           clientName: string;
 *           redirectUris: string[];
 *           tokenEndpointAuthMethod: 'none' | 'private_key_jwt';
 *           jwksUri?: string;
 *           jwks?: { keys: Record<string, unknown>[] };
 *       }
 *     | { ok: false; error: string }}
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
    const authMetadata = parseClientAuthenticationMetadata(body);
    if (!authMetadata.ok) return authMetadata;
    return {
        ok: true,
        clientName: normalizeClientName(body['client_name'], 'ChatGPT MCP Connector'),
        redirectUris,
        tokenEndpointAuthMethod: authMetadata.tokenEndpointAuthMethod,
        ...(authMetadata.jwksUri ? { jwksUri: authMetadata.jwksUri } : {}),
        ...(authMetadata.jwks ? { jwks: authMetadata.jwks } : {}),
    };
}

/**
 * @param {Record<string, unknown>} metadata
 * @returns {{
 *           ok: true;
 *           tokenEndpointAuthMethod: 'none' | 'private_key_jwt';
 *           jwksUri?: string;
 *           jwks?: { keys: Record<string, unknown>[] };
 *       }
 *     | { ok: false; error: string }}
 */
function parseClientAuthenticationMetadata(metadata) {
    const tokenEndpointAuthMethod = String(metadata['token_endpoint_auth_method'] ?? 'none');
    if (
        !SUPPORTED_TOKEN_ENDPOINT_AUTH_METHODS.includes(
            /** @type {'none' | 'private_key_jwt'} */ (tokenEndpointAuthMethod),
        )
    ) {
        return { ok: false, error: 'token_endpoint_auth_method contains unsupported value.' };
    }
    const jwksUri = normalizeOptionalClientJwksUri(metadata['jwks_uri']);
    const jwks = normalizeInlineClientJwks(metadata['jwks']);
    if (tokenEndpointAuthMethod === 'private_key_jwt' && !jwksUri && !jwks) {
        return { ok: false, error: 'private_key_jwt clients must provide jwks_uri or jwks.' };
    }
    return {
        ok: true,
        tokenEndpointAuthMethod: /** @type {'none' | 'private_key_jwt'} */ (tokenEndpointAuthMethod),
        ...(jwksUri ? { jwksUri } : {}),
        ...(jwks ? { jwks } : {}),
    };
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeOptionalClientJwksUri(value) {
    if (value === undefined || value === null || value === '') return '';
    const raw = String(value).trim();
    if (!raw || raw.length > MAX_CLIENT_ID_LENGTH || hasControlCharacters(raw)) return '';
    return isAllowedClientMetadataUrl(raw) ? raw : '';
}

/**
 * @param {unknown} value
 * @returns {{ keys: Record<string, unknown>[] } | undefined}
 */
function normalizeInlineClientJwks(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const jwks = /** @type {Record<string, unknown>} */ (value);
    const keys = Array.isArray(jwks['keys'])
        ? jwks['keys'].filter((key) => key && typeof key === 'object' && !Array.isArray(key))
        : [];
    if (keys.length === 0 || keys.length > 10) return undefined;
    return { keys: /** @type {Record<string, unknown>[]} */ (keys) };
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
 * @param {string} [familyId]
 * @returns {Promise<string>}
 */
async function issueRefreshToken(
    clientId,
    scope,
    resource,
    ttlSeconds,
    familyId = newRefreshTokenFamilyId(),
    dpopJkt = '',
) {
    await ensureRenewCredentialsLoaded();
    pruneExpiredRenewCredentials();
    pruneConsumedRefreshTokenHashes();
    pruneRevokedRefreshTokenFamilies();
    trimRenewCredentials(MAX_REFRESH_TOKEN_RECORDS - 1);
    if (isRefreshTokenFamilyRevoked(familyId)) throw new Error('Refresh token family is revoked.');
    const credential = `${REFRESH_TOKEN_PREFIX}${randomUUID()}`;
    renewCredentials.set(hashRefreshToken(credential), {
        clientId,
        scope,
        resource,
        expiresAt: Date.now() + ttlSeconds * 1000,
        familyId,
        ...(dpopJkt ? { dpopJkt } : {}),
    });
    await persistRenewCredentials();
    return credential;
}

/**
 * @returns {string}
 */
function newRefreshTokenFamilyId() {
    return `${REFRESH_TOKEN_FAMILY_PREFIX}${randomUUID()}`;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeRefreshTokenFamilyId(value) {
    const normalized = String(value ?? '').trim();
    if (/^rtf_[A-Fa-f0-9-]{36}$/u.test(normalized)) return normalized;
    if (/^legacy_[a-f0-9]{16}$/u.test(normalized)) return normalized;
    return '';
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeDpopJkt(value) {
    const normalized = String(value ?? '').trim();
    return isValidDpopJkt(normalized) ? normalized : '';
}

/**
 * @param {string} value
 * @returns {boolean}
 */
function isValidDpopJkt(value) {
    return Boolean(
        value && value.length <= MAX_DPOP_JKT_LENGTH && value.length >= 32 && /^[A-Za-z0-9_-]+$/u.test(value),
    );
}

/**
 * @param {string} tokenHash
 * @param {{ clientId: string; familyId: string }} metadata
 * @returns {void}
 */
function rememberConsumedRefreshTokenHash(tokenHash, metadata) {
    if (!tokenHash || !metadata.familyId) return;
    pruneConsumedRefreshTokenHashes();
    consumedRefreshTokenHashes.set(tokenHash, {
        clientId: metadata.clientId,
        familyId: metadata.familyId,
        expiresAt: Date.now() + CONSUMED_REFRESH_TOKEN_HASH_TTL_MS,
    });
}

/**
 * @param {string} tokenHash
 * @returns {{ clientId: string; familyId: string; expiresAt: number } | undefined}
 */
function lookupConsumedRefreshTokenHash(tokenHash) {
    const consumed = consumedRefreshTokenHashes.get(tokenHash);
    if (!consumed) return undefined;
    if (consumed.expiresAt <= Date.now()) {
        consumedRefreshTokenHashes.delete(tokenHash);
        return undefined;
    }
    return consumed;
}

/**
 * @param {string} familyId
 * @param {string} clientId
 * @param {string} reason
 * @returns {number}
 */
function revokeRefreshTokenFamily(familyId, clientId, reason) {
    if (!familyId) return 0;
    let removed = 0;
    for (const [tokenHash, metadata] of renewCredentials) {
        if (metadata.familyId === familyId) {
            renewCredentials.delete(tokenHash);
            rememberConsumedRefreshTokenHash(tokenHash, metadata);
            removed += 1;
        }
    }
    revokedRefreshTokenFamilies.set(familyId, {
        clientId,
        reason,
        expiresAt: Date.now() + REVOKED_REFRESH_TOKEN_FAMILY_TTL_MS,
    });
    return removed;
}

/**
 * @param {string} familyId
 * @returns {boolean}
 */
function isRefreshTokenFamilyRevoked(familyId) {
    const revoked = revokedRefreshTokenFamilies.get(familyId);
    if (!revoked) return false;
    if (revoked.expiresAt <= Date.now()) {
        revokedRefreshTokenFamilies.delete(familyId);
        return false;
    }
    return true;
}

/**
 * @param {number} [nowMs]
 * @returns {number}
 */
function pruneConsumedRefreshTokenHashes(nowMs = Date.now()) {
    let removed = 0;
    for (const [tokenHash, metadata] of consumedRefreshTokenHashes) {
        if (metadata.expiresAt <= nowMs) {
            consumedRefreshTokenHashes.delete(tokenHash);
            removed += 1;
        }
    }
    return removed;
}

/**
 * @param {number} [nowMs]
 * @returns {number}
 */
function pruneRevokedRefreshTokenFamilies(nowMs = Date.now()) {
    let removed = 0;
    for (const [familyId, metadata] of revokedRefreshTokenFamilies) {
        if (metadata.expiresAt <= nowMs) {
            revokedRefreshTokenFamilies.delete(familyId);
            removed += 1;
        }
    }
    return removed;
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
    const configKey = devOAuthPersistenceConfigKey(env);
    if (renewCredentialsLoaded && renewCredentialsLoadedConfigKey === configKey) return;
    if (renewCredentialsLoaded && renewCredentialsLoadedConfigKey !== configKey) {
        renewCredentials.clear();
        consumedRefreshTokenHashes.clear();
        revokedRefreshTokenFamilies.clear();
        renewCredentialsLoaded = false;
        renewCredentialsLoadPromise = null;
    }
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
                familyId: record.familyId,
                ...(record.dpopJkt ? { dpopJkt: record.dpopJkt } : {}),
            });
        }
        for (const record of parseConsumedRefreshTokenHashRecords(parsed)) {
            consumedRefreshTokenHashes.set(record.tokenHash, {
                clientId: record.clientId,
                familyId: record.familyId,
                expiresAt: record.expiresAt,
            });
        }
        for (const record of parseRevokedRefreshTokenFamilyRecords(parsed)) {
            revokedRefreshTokenFamilies.set(record.familyId, {
                clientId: record.clientId,
                reason: record.reason,
                expiresAt: record.expiresAt,
            });
        }
        renewCredentialsLoadedFromFile = true;
        renewCredentialsLoadedConfigKey = devOAuthPersistenceConfigKey(env);
        pruneExpiredRenewCredentials();
        trimRenewCredentials(MAX_REFRESH_TOKEN_RECORDS);
    } catch (error) {
        const code = error && typeof error === 'object' ? /** @type {{ code?: unknown }} */ (error).code : undefined;
        if (code !== 'ENOENT')
            renewCredentialsLastPersistenceError = error instanceof Error ? error.message : String(error);
    } finally {
        renewCredentialsLoaded = true;
        renewCredentialsLoadedConfigKey ??= devOAuthPersistenceConfigKey(env);
    }
}
/**
 * @param {unknown} parsed
 * @returns {{
 *     tokenHash: string;
 *     clientId: string;
 *     scope: string;
 *     resource: string;
 *     expiresAt: number;
 *     familyId: string;
 *     dpopJkt?: string;
 * }[]}
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
        const familyId = normalizeRefreshTokenFamilyId(record['familyId']) || `legacy_${tokenHash.slice(0, 16)}`;
        const dpopJkt = normalizeDpopJkt(record['dpopJkt']);
        if (!/^[a-f0-9]{64}$/u.test(tokenHash)) continue;
        if (!clientId || !scope || !resource || !Number.isFinite(expiresAt)) continue;
        records.push({ tokenHash, clientId, scope, resource, expiresAt, familyId, ...(dpopJkt ? { dpopJkt } : {}) });
    }
    return records;
}

/**
 * @param {unknown} parsed
 * @returns {{ tokenHash: string; clientId: string; familyId: string; expiresAt: number }[]}
 */
function parseConsumedRefreshTokenHashRecords(parsed) {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
    const root = /** @type {Record<string, unknown>} */ (parsed);
    const rawConsumed = Array.isArray(root['consumedRefreshTokenHashes']) ? root['consumedRefreshTokenHashes'] : [];
    const records = [];
    for (const item of rawConsumed) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
        const record = /** @type {Record<string, unknown>} */ (item);
        const tokenHash = String(record['tokenHash'] ?? '');
        const clientId = String(record['clientId'] ?? '');
        const familyId = normalizeRefreshTokenFamilyId(record['familyId']);
        const expiresAt = Number(record['expiresAt']);
        if (!/^[a-f0-9]{64}$/u.test(tokenHash)) continue;
        if (!clientId || !familyId || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) continue;
        records.push({ tokenHash, clientId, familyId, expiresAt });
    }
    return records;
}

/**
 * @param {unknown} parsed
 * @returns {{ familyId: string; clientId: string; expiresAt: number; reason: string }[]}
 */
function parseRevokedRefreshTokenFamilyRecords(parsed) {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
    const root = /** @type {Record<string, unknown>} */ (parsed);
    const rawRevoked = Array.isArray(root['revokedRefreshTokenFamilies']) ? root['revokedRefreshTokenFamilies'] : [];
    const records = [];
    for (const item of rawRevoked) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
        const record = /** @type {Record<string, unknown>} */ (item);
        const familyId = normalizeRefreshTokenFamilyId(record['familyId']);
        const clientId = String(record['clientId'] ?? '');
        const expiresAt = Number(record['expiresAt']);
        const reason = sanitizeLogString(String(record['reason'] ?? 'revoked'), 80) || 'revoked';
        if (!familyId || !clientId || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) continue;
        records.push({ familyId, clientId, expiresAt, reason });
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
            consumedRefreshTokenHashes: [...consumedRefreshTokenHashes.entries()]
                .map(([tokenHash, metadata]) => ({ tokenHash, ...metadata }))
                .filter((record) => record.expiresAt > Date.now())
                .sort(
                    (left, right) => left.expiresAt - right.expiresAt || left.tokenHash.localeCompare(right.tokenHash),
                ),
            revokedRefreshTokenFamilies: [...revokedRefreshTokenFamilies.entries()]
                .map(([familyId, metadata]) => ({ familyId, ...metadata }))
                .filter((record) => record.expiresAt > Date.now())
                .sort((left, right) => left.expiresAt - right.expiresAt || left.familyId.localeCompare(right.familyId)),
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
    const configKey = devOAuthPersistenceConfigKey(env);
    if (registeredClientsLoaded && registeredClientsLoadedConfigKey === configKey) return;
    if (registeredClientsLoaded && registeredClientsLoadedConfigKey !== configKey) {
        registeredClients.clear();
        registeredClientsLoaded = false;
        registeredClientsLoadPromise = null;
    }
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
        registeredClientsLoadedConfigKey = devOAuthPersistenceConfigKey(env);
    } catch (error) {
        const code = error && typeof error === 'object' ? /** @type {{ code?: unknown }} */ (error).code : undefined;
        if (code !== 'ENOENT')
            registeredClientsLastPersistenceError = error instanceof Error ? error.message : String(error);
    } finally {
        registeredClientsLoaded = true;
        registeredClientsLoadedConfigKey ??= devOAuthPersistenceConfigKey(env);
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
        const authMetadata = parseClientAuthenticationMetadata(record);
        if (
            !clientId.startsWith('mcp_dev_') ||
            !clientName ||
            redirectUris.length === 0 ||
            !Number.isFinite(createdAt) ||
            !Number.isFinite(expiresAt) ||
            expiresAt <= Date.now() ||
            !authMetadata.ok
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
            tokenEndpointAuthMethod: authMetadata.tokenEndpointAuthMethod,
            ...(authMetadata.jwksUri ? { jwksUri: authMetadata.jwksUri } : {}),
            ...(authMetadata.jwks ? { jwks: authMetadata.jwks } : {}),
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
        setBearerChallenge(res, config);
        writeJson(res, 401, { error: 'invalid_token', error_description: 'Bearer token is required.' });
        return;
    }
    try {
        const { publicJwks } = await getKeyMaterial();
        const jwks = createLocalJWKSet({ keys: publicJwks });
        const verified = await jwtVerify(token, jwks, {
            issuer: config.resource,
            audience: [config.resource, `${config.resource}/mcp`],
            algorithms: ['ES256', 'RS256'],
        });
        const scope = String(verified.payload['scope'] ?? '');
        if (!scope.split(/\s+/u).includes('openid')) {
            setBearerChallenge(res, config, 'insufficient_scope', 'openid scope is required.', 'openid');
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
        setBearerChallenge(res, config, 'invalid_token', 'Bearer token could not be verified.');
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
        return parseFormObject(text);
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
 * @param {string} text
 * @returns {Record<string, unknown>}
 */
function parseFormObject(text) {
    const params = new URLSearchParams(text);
    /** @type {Record<string, unknown>} */
    const output = {};
    for (const [key, value] of params.entries()) {
        if (Object.prototype.hasOwnProperty.call(output, key)) {
            throw oauthRequestBodyError(`Duplicate OAuth form parameter: ${key}`, 400);
        }
        output[key] = value;
    }
    return output;
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
 * @returns {DevOAuthClient | undefined}
 */
function resolveBuiltInDevOAuthClientMetadataDocument(clientId) {
    if (!clientId || clientId.length > MAX_CLIENT_ID_LENGTH || hasControlCharacters(clientId)) return undefined;
    try {
        const url = new URL(clientId);
        if (`${url.origin}${url.pathname}` !== `${url.origin}${DEV_CLIENT_METADATA_PATH}`) return undefined;
        return {
            clientId,
            clientName: 'Copilot MCP CIMD smoke client',
            redirectUris: [DEV_CLIENT_REDIRECT_URI],
            createdAt: Date.now(),
            source: 'cimd',
            tokenEndpointAuthMethod: 'none',
        };
    } catch {
        return undefined;
    }
}

/**
 * @param {string} clientId
 * @returns {DevOAuthClient | undefined}
 */
function resolveTrustedChatGptClientMetadataDocument(clientId) {
    if (!isTrustedChatGptCimdFallbackEnabled()) return undefined;
    if (!clientId || clientId.length > MAX_CLIENT_ID_LENGTH || hasControlCharacters(clientId)) return undefined;
    try {
        const url = new URL(clientId);
        if (url.origin !== CHATGPT_CIMD_ORIGIN || url.search || url.hash || url.username || url.password || url.port) {
            return undefined;
        }
        const match = CHATGPT_CIMD_CLIENT_PATH_PATTERN.exec(url.pathname);
        const handle = match?.[1] ?? '';
        if (!handle) return undefined;
        return {
            clientId,
            clientName: 'ChatGPT Connector CIMD client',
            redirectUris: [
                `${CHATGPT_CIMD_ORIGIN}${CHATGPT_CONNECTOR_REDIRECT_PATH_PREFIX}${handle}`,
                CHATGPT_LEGACY_REDIRECT_URI,
            ],
            createdAt: Date.now(),
            source: 'cimd',
            tokenEndpointAuthMethod: 'none',
            trustedFallback: true,
            trustedFallbackReason: 'chatgpt-cimd-fetch-unavailable',
        };
    } catch {
        return undefined;
    }
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean}
 */
function isTrustedChatGptCimdFallbackEnabled(env = process.env) {
    const raw = String(env['COPILOT_MCP_DEV_OAUTH_TRUST_CHATGPT_CIMD_FALLBACK'] ?? 'true')
        .trim()
        .toLowerCase();
    return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

/**
 * Use the hardened ChatGPT CIMD trust policy before remote metadata fetch. The observed ChatGPT metadata endpoint can
 * be unreachable from the dev container, and waiting for that fetch on every authorization request causes connector
 * friction while not adding security for this specific allowlisted host/path/redirect tuple. Set this env to false to
 * force strict remote fetch.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean}
 */
function isTrustedChatGptCimdFastPathEnabled(env = process.env) {
    const raw = String(env['COPILOT_MCP_DEV_OAUTH_CHATGPT_CIMD_FAST_PATH'] ?? 'true')
        .trim()
        .toLowerCase();
    return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

/**
 * @param {string} clientId
 * @param {DevOAuthClient} client
 * @returns {DevOAuthClient}
 */
function cacheClientMetadataDocument(clientId, client, ttlMs = CLIENT_METADATA_CACHE_TTL_MS) {
    pruneClientMetadataDocumentCache();
    trimClientMetadataDocumentCache(MAX_CLIENT_METADATA_CACHE_ENTRIES - 1);
    clientMetadataDocumentCache.set(clientId, {
        client,
        expiresAt: Date.now() + clampClientMetadataCacheTtlMs(ttlMs),
    });
    return client;
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
    const builtInClient = resolveBuiltInDevOAuthClientMetadataDocument(clientId);
    if (builtInClient) return cacheClientMetadataDocument(clientId, builtInClient);
    const trustedChatGptFallback = resolveTrustedChatGptClientMetadataDocument(clientId);
    if (trustedChatGptFallback && isTrustedChatGptCimdFastPathEnabled()) {
        logDevOAuthEvent('INFO', 'Using trusted ChatGPT CIMD fast-path.', {
            clientId: summarizeClientIdForLog(clientId),
            redirectUris: trustedChatGptFallback.redirectUris.map(summarizeUrlForLog),
        });
        return cacheClientMetadataDocument(clientId, trustedChatGptFallback);
    }
    if (!isAllowedClientMetadataUrl(clientId)) {
        return trustedChatGptFallback ? cacheClientMetadataDocument(clientId, trustedChatGptFallback) : undefined;
    }

    try {
        const fetched = await readHttpsJsonDocumentWithPublicDnsOnlyWithCache(
            new URL(clientId),
            MAX_CLIENT_METADATA_RESPONSE_BYTES,
            CLIENT_METADATA_MAX_REDIRECTS,
        );
        const parsed = fetched?.document;
        if (!parsed) {
            if (trustedChatGptFallback) {
                logDevOAuthEvent('WARN', 'Using trusted ChatGPT CIMD fallback after metadata fetch failed.', {
                    clientId: summarizeClientIdForLog(clientId),
                    redirectUris: trustedChatGptFallback.redirectUris.map(summarizeUrlForLog),
                });
                return cacheClientMetadataDocument(clientId, trustedChatGptFallback);
            }
            return undefined;
        }
        const metadata = parseClientMetadata(parsed, clientId);
        if (!metadata) {
            if (trustedChatGptFallback) {
                logDevOAuthEvent(
                    'WARN',
                    'Using trusted ChatGPT CIMD fallback after metadata document validation failed.',
                    {
                        clientId: summarizeClientIdForLog(clientId),
                        redirectUris: trustedChatGptFallback.redirectUris.map(summarizeUrlForLog),
                    },
                );
                return cacheClientMetadataDocument(clientId, trustedChatGptFallback);
            }
            return undefined;
        }
        return cacheClientMetadataDocument(clientId, metadata, fetched?.cacheTtlMs);
    } catch (error) {
        if (trustedChatGptFallback) {
            logDevOAuthEvent('WARN', 'Using trusted ChatGPT CIMD fallback after metadata resolution threw.', {
                clientId: summarizeClientIdForLog(clientId),
                error: error instanceof Error ? error.message : String(error),
            });
            return cacheClientMetadataDocument(clientId, trustedChatGptFallback);
        }
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
 * @returns {Promise<{ document: unknown; cacheTtlMs: number } | undefined>}
 */
async function readHttpsJsonDocumentWithPublicDnsOnlyWithCache(url, maxBytes, redirectsRemaining) {
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
                    'user-agent': `${DEV_OAUTH_IMPLEMENTATION_NAME}/${DEV_OAUTH_IMPLEMENTATION_VERSION}`,
                },
                servername: url.hostname,
                timeout: CLIENT_METADATA_TIMEOUT_MS,
                lookup: /** @type {import('node:net').LookupFunction} */ (publicOnlyLookup),
            },
            (incoming) => {
                void handleClientMetadataIncomingMessage(url, incoming, maxBytes, redirectsRemaining).then(
                    (value) => resolve(value),
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
 * @returns {Promise<{ document: unknown; cacheTtlMs: number } | undefined>}
 */
async function handleClientMetadataIncomingMessage(currentUrl, incoming, maxBytes, redirectsRemaining) {
    const statusCode = Number(incoming.statusCode ?? 0);
    if (isRedirectStatus(statusCode)) {
        const location = firstHeaderValue(incoming.headers['location']);
        incoming.resume();
        if (!location || redirectsRemaining <= 0) return undefined;
        const nextUrl = new URL(location, currentUrl);
        if (!isAllowedClientMetadataUrl(nextUrl.toString())) return undefined;
        return readHttpsJsonDocumentWithPublicDnsOnlyWithCache(nextUrl, maxBytes, redirectsRemaining - 1);
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
        return {
            document: JSON.parse(Buffer.concat(chunks).toString('utf8')),
            cacheTtlMs: resolveHttpCacheTtlMs(incoming.headers),
        };
    } catch {
        return undefined;
    }
}

/**
 * @param {import('node:http').IncomingHttpHeaders} headers
 * @returns {number}
 */
function resolveHttpCacheTtlMs(headers) {
    const cacheControl = firstHeaderValue(headers['cache-control']).toLowerCase();
    if (/\bno-store\b/u.test(cacheControl)) return MIN_CLIENT_METADATA_CACHE_TTL_MS;
    const maxAgeMatch = /(?:^|,)\s*max-age=(\d+)\s*(?:,|$)/u.exec(cacheControl);
    if (maxAgeMatch) {
        const parsed = Number(maxAgeMatch[1]);
        if (Number.isFinite(parsed) && parsed >= 0) {
            return clampClientMetadataCacheTtlMs(parsed * 1000);
        }
    }
    const expires = firstHeaderValue(headers['expires']);
    if (expires) {
        const expiresAt = Date.parse(expires);
        if (Number.isFinite(expiresAt)) return clampClientMetadataCacheTtlMs(expiresAt - Date.now());
    }
    return CLIENT_METADATA_CACHE_TTL_MS;
}

/**
 * @param {number} ttlMs
 * @returns {number}
 */
function clampClientMetadataCacheTtlMs(ttlMs) {
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) return MIN_CLIENT_METADATA_CACHE_TTL_MS;
    return Math.min(
        Math.max(Math.floor(ttlMs), MIN_CLIENT_METADATA_CACHE_TTL_MS),
        MAX_CLIENT_METADATA_HTTP_CACHE_TTL_MS,
    );
}

/**
 * @param {string} hostname
 * @param {import('node:dns').LookupOptions} options
 * @param {(
 *     error: NodeJS.ErrnoException | null,
 *     address?: string | import('node:dns').LookupAddress[],
 *     family?: number,
 * ) => void} callback
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
            const requestedFamily =
                typeof options === 'object' && options && typeof options.family === 'number' ? options.family : 0;
            const preferred =
                (requestedFamily ? publicAddresses.find((entry) => entry.family === requestedFamily) : undefined) ??
                publicAddresses.find((entry) => entry.family === 4) ??
                publicAddresses[0];
            if (!preferred) {
                callback(
                    Object.assign(new Error('Resolved client metadata host has no usable address.'), {
                        code: 'ENOTFOUND',
                    }),
                );
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
    const authMetadata = parseClientAuthenticationMetadata(metadata);
    if (!authMetadata.ok) return undefined;
    return {
        clientId,
        clientName: normalizeClientName(metadata['client_name'], 'MCP Client Metadata Document'),
        redirectUris,
        createdAt: Date.now(),
        source: 'cimd',
        tokenEndpointAuthMethod: authMetadata.tokenEndpointAuthMethod,
        ...(authMetadata.jwksUri ? { jwksUri: authMetadata.jwksUri } : {}),
        ...(authMetadata.jwks ? { jwks: authMetadata.jwks } : {}),
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
    const length = Math.max(leftBuffer.length, rightBuffer.length, 1);
    const paddedLeft = Buffer.alloc(length);
    const paddedRight = Buffer.alloc(length);
    leftBuffer.copy(paddedLeft);
    rightBuffer.copy(paddedRight);
    return timingSafeEqual(paddedLeft, paddedRight) && leftBuffer.length === rightBuffer.length;
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
 * @returns {string}
 */
function ensureResponseRequestId(res) {
    const existing = res.getHeader('x-request-id');
    if (existing) return String(existing);
    const requestId = randomUUID();
    res.setHeader('X-Request-Id', requestId);
    return requestId;
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {import('./auth.js').McpAuthConfig} config
 * @param {string} [error]
 * @param {string} [description]
 * @param {string} [scope]
 * @returns {void}
 */
function setBearerChallenge(res, config, error = '', description = '', scope = '') {
    /** @type {[string, string][]} */
    const params = [['realm', config.resource]];
    if (error) params.push(['error', error]);
    if (description) params.push(['error_description', description]);
    if (scope) params.push(['scope', scope]);
    res.setHeader('WWW-Authenticate', `Bearer ${params.map(([name, value]) => `${name}=${quoteAuthParam(value)}`).join(', ')}`);
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {string} error
 * @param {string} description
 * @returns {void}
 */
function setDpopChallenge(res, error, description) {
    /** @type {[string, string][]} */
    const params = [['error', error]];
    if (description) params.push(['error_description', description]);
    res.setHeader('WWW-Authenticate', `DPoP ${params.map(([name, value]) => `${name}=${quoteAuthParam(value)}`).join(', ')}`);
}

/**
 * @param {string} value
 * @returns {string}
 */
function quoteAuthParam(value) {
    return `"${String(value).replace(/["\\]/gu, '\\$&')}"`;
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {unknown} body
 * @returns {void}
 */
function writeJson(res, status, body) {
    ensureResponseRequestId(res);
    const payload = `${JSON.stringify(body, null, 2)}\n`;
    res.writeHead(status, {
        ...securityHeaders(),
        ...devOAuthCorsHeaders(),
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
 * @param {import('node:http').ServerResponse} res
 * @returns {void}
 */
function writeCorsPreflight(res) {
    ensureResponseRequestId(res);
    res.writeHead(204, {
        ...securityHeaders(),
        ...devOAuthCorsHeaders(),
        'access-control-allow-methods': 'GET, POST, OPTIONS',
        'access-control-allow-headers':
            'accept, authorization, content-type, dpop, mcp-session-id, mcp-protocol-version, x-requested-with',
        'access-control-max-age': '600',
        'content-length': '0',
    });
    res.end();
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
        'cross-origin-opener-policy': 'same-origin',
    };
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Record<string, string>}
 */
function devOAuthCorsHeaders(env = process.env) {
    const raw = String(env['COPILOT_MCP_DEV_OAUTH_CORS_ORIGIN'] ?? '*').trim();
    if (!raw || raw.toLowerCase() === 'off' || raw.toLowerCase() === 'false') return {};
    const origin = raw.length > 256 || hasControlCharacters(raw) ? '*' : raw;
    return {
        'access-control-allow-origin': origin,
        'access-control-expose-headers': 'location, www-authenticate, dpop-nonce, x-request-id',
        vary: origin === '*' ? 'Access-Control-Request-Method, Access-Control-Request-Headers' : 'Origin',
    };
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {URL} target
 * @returns {void}
 */
function redirect(res, target) {
    ensureResponseRequestId(res);
    res.writeHead(302, {
        ...securityHeaders(),
        ...devOAuthCorsHeaders(),
        location: target.toString(),
        'cache-control': 'no-store, no-transform',
        pragma: 'no-cache',
        expires: '0',
    });
    res.end();
}

/**
 * @param {'INFO' | 'WARN' | 'ERROR'} level
 * @param {string} message
 * @param {Record<string, unknown>} [fields]
 * @returns {void}
 */
function logDevOAuthEvent(level, message, fields = {}) {
    const entry = {
        ts: new Date().toISOString(),
        level,
        component: 'copilot-mcp-dev-oauth',
        message: sanitizeLogString(message, 240),
        fields: sanitizeLogValue(fields, 0),
    };
    process.stderr.write(`${JSON.stringify(entry)}\n`);
}

/**
 * @param {unknown} value
 * @param {number} depth
 * @returns {unknown}
 */
function sanitizeLogValue(value, depth) {
    if (depth > 4) return '[max-depth]';
    if (typeof value === 'string') return sanitizeLogString(value, 512);
    if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
    if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizeLogValue(item, depth + 1));
    if (value && typeof value === 'object') {
        /** @type {Record<string, unknown>} */
        const output = {};
        for (const [key, item] of Object.entries(/** @type {Record<string, unknown>} */ (value)).slice(0, 50)) {
            output[sanitizeLogString(key, 80)] = sanitizeLogValue(item, depth + 1);
        }
        return output;
    }
    return value === undefined ? null : String(value);
}

/**
 * @param {string} value
 * @param {number} maxLength
 * @returns {string}
 */
function sanitizeLogString(value, maxLength) {
    return stripControlCharacters(String(value ?? ''))
        .replace(/\s+/gu, ' ')
        .trim()
        .slice(0, maxLength);
}

/**
 * @param {string} value
 * @returns {Record<string, unknown>}
 */
function summarizeClientIdForLog(value) {
    if (!value) return { present: false };
    try {
        const url = new URL(value);
        return { present: true, kind: 'url', origin: url.origin, path: url.pathname.slice(0, 160) };
    } catch {
        return { present: true, kind: value.startsWith('mcp_dev_') ? 'dcr' : 'opaque', prefix: value.slice(0, 24) };
    }
}

/**
 * @param {string} value
 * @returns {Record<string, unknown> | null}
 */
function summarizeUrlForLog(value) {
    if (!value) return null;
    try {
        const url = new URL(value);
        return { origin: url.origin, path: url.pathname.slice(0, 160) };
    } catch {
        return { invalid: true, prefix: value.slice(0, 80) };
    }
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
