// @ts-check
/**
 * Canonical OAuth smoke test for the ChatGPT MCP endpoint.
 *
 * Version 1.4.0 focuses on MCP 2026-07-28 / OpenAI Apps SDK compatibility:
 *
 * - RFC 9728 Protected Resource Metadata discovery, path-specific and root.
 * - OAuth Authorization Server Metadata / OIDC discovery.
 * - Dynamic Client Registration public-client flow.
 * - Client ID Metadata Document flow.
 * - Optional private_key_jwt client-auth flow when advertised.
 * - Resource Indicator propagation in authorization-code and refresh-token requests.
 * - Auth MCP calls and tools/list registry diff.
 * - Retry/backoff for transient Cloudflare Tunnel edge windows after restarts.
 *
 * @module copilot/mcp/diagnostics/oauth-smoke/runtime
 */

import { readBoundedResponseText } from '#copilot/infra/public/platform/http-response';
import { readMcpAuthConfig } from '#copilot/mcp/public/auth';
import { MCP_PROTOCOL_LEGACY_DEFAULT_VERSION, MCP_PROTOCOL_MODERN_VERSION } from '#copilot/mcp/public/protocol/version';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
    asRecord,
    hasJsonRpcError,
    summarizeAuthenticatedToolsList,
    summarizeClientMetadata,
    summarizeIntrospection,
    summarizeJwks,
    summarizeMetadataProbe,
    summarizeModernSubscription,
    summarizeProtectedResourceProbe,
    summarizeRegistration,
    summarizeRuntimeProbe,
    summarizeSseProbe,
    summarizeToken,
    summarizeTokenCleanup,
    summarizeUserinfo,
} from './report.js';
import { isTransientOAuthSmokeHttpStatus, retryOAuthSmokeOperation } from './retry-policy.js';
import { runModernMcpRuntimeChecks } from './runtime-checks/modern.js';

export const OAUTH_SMOKE_IMPLEMENTATION_NAME = 'copilot-mcp-oauth-smoke';
export const OAUTH_SMOKE_IMPLEMENTATION_VERSION = '1.5.0';

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_RETRY_ATTEMPTS = 5;
const DEFAULT_RETRY_BASE_DELAY_MS = 250;
const DEFAULT_RETRY_MAX_DELAY_MS = 2_000;
const MAX_RESPONSE_TEXT_BYTES = 256 * 1024;
const MAX_SUMMARY_TEXT_LENGTH = 500;
const MAX_URL_LENGTH = 2048;
const MAX_TOKEN_LENGTH = 64 * 1024;
const FULL_REPO_SCOPE = 'repo:read repo:write repo:validate repo:admin';
const FULL_REPO_OIDC_SCOPE = `${FULL_REPO_SCOPE} openid profile email offline_access`;
const CLIENT_ASSERTION_TYPE_JWT_BEARER = 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer';

/**
 * @typedef {{
 *     ok: boolean;
 *     status?: number;
 *     body?: unknown;
 *     error?: string;
 *     headers?: Record<string, string>;
 *     attempts?: number;
 *     transient?: boolean;
 *     durationMs?: number;
 *     responseBytes?: number;
 *     eventReceived?: boolean | null;
 *     lastEventId?: string;
 *     skipped?: boolean;
 * }} ProbeResult
 *
 *
 * @typedef {{
 *     resource?: string;
 *     timeoutMs?: number;
 *     retryAttempts?: number;
 *     retryBaseDelayMs?: number;
 *     retryMaxDelayMs?: number;
 *     strict?: boolean;
 *     runDcrCompatibility?: boolean;
 *     runLegacyCompatibility?: boolean;
 *     runPrivateKeyJwt?: boolean;
 *     runNegativeResourceChecks?: boolean;
 *     verboseTools?: boolean;
 *     localToolNames?: string[];
 *     env: NodeJS.ProcessEnv;
 * }} OAuthSmokeOptions
 *
 *
 * @typedef {{
 *     timeoutMs: number;
 *     retryAttempts: number;
 *     retryBaseDelayMs: number;
 *     retryMaxDelayMs: number;
 *     strict: boolean;
 *     runDcrCompatibility: boolean;
 *     runLegacyCompatibility: boolean;
 *     runPrivateKeyJwt: boolean;
 *     runNegativeResourceChecks: boolean;
 *     verboseTools: boolean;
 *     localToolNames: string[];
 *     protocolVersion: typeof MCP_PROTOCOL_MODERN_VERSION;
 *     legacyProtocolVersion: string;
 * }} OAuthSmokeRuntimeOptions
 *
 *
 * @typedef {{
 *     clientId: string;
 *     redirectUri: string;
 *     resource: string;
 *     scope: string;
 *     clientAssertion?: (tokenEndpoint: string) => Promise<Record<string, string>>;
 *     omitResourceInAuthorize?: boolean;
 *     omitResourceInToken?: boolean;
 * }} AuthorizationClientRequest
 */

/**
 * @param {OAuthSmokeOptions} options
 * @returns {Promise<Record<string, unknown>>}
 */
export async function runMcpOAuthSmoke(options) {
    if (!options?.env) throw new TypeError('MCP OAuth smoke requires an explicit process environment.');
    const startedAtMs = Date.now();
    /** @type {Record<string, number>} */
    const phaseTimings = {};
    let phaseStartedAtMs = startedAtMs;
    /** @param {string} name */
    const finishPhase = (name) => {
        const nowMs = Date.now();
        phaseTimings[name] = nowMs - phaseStartedAtMs;
        phaseStartedAtMs = nowMs;
    };
    const env = options.env;
    const runtime = readSmokeRuntimeOptions(options, env);
    const config = readMcpAuthConfig(env);
    const resource = normalizeResource(options.resource ?? env['COPILOT_MCP_OAUTH_SMOKE_RESOURCE'] ?? config.resource);
    const mcpUrl = buildMcpUrlFromResource(resource);

    const protectedResourceUrl = buildProtectedResourceMetadataUrl(resource);
    const rootProtectedResourceUrl = buildRootProtectedResourceMetadataUrl(resource);
    // These probes share no mutable state and all target the pre-auth discovery surface. Running them concurrently keeps
    // the smoke bounded by the slowest network leg instead of serially accumulating four public round trips.
    const protectedResourcePromise = probeJsonWithRetry(protectedResourceUrl, { method: 'GET' }, runtime);
    const [protectedResource, rootProtectedResource, protectedResourceCors, mcpChallenge] = await Promise.all([
        protectedResourcePromise,
        rootProtectedResourceUrl === protectedResourceUrl
            ? protectedResourcePromise
            : probeJsonWithRetry(rootProtectedResourceUrl, { method: 'GET' }, runtime),
        probeCorsPreflightWithRetry(protectedResourceUrl, 'GET', runtime),
        probeMcpUnauthorizedChallenge(mcpUrl, runtime),
    ]);
    finishPhase('publicDiscovery');

    const authorizationServer =
        extractAuthorizationServer(protectedResource.body) ??
        extractAuthorizationServer(rootProtectedResource.body) ??
        resource;
    const oauthDiscovery = await discoverAuthorizationServerMetadata(authorizationServer, runtime);
    const oauthMetadata = oauthDiscovery.probe;
    const metadata = asRecord(oauthMetadata.body);
    const jwksUri =
        typeof metadata?.['jwks_uri'] === 'string' ? metadata['jwks_uri'] : `${authorizationServer}/oauth/jwks.json`;
    const [oauthMetadataCors, jwks] = await Promise.all([
        probeCorsPreflightWithRetry(oauthDiscovery.url, 'GET', runtime),
        probeJsonWithRetry(jwksUri, { method: 'GET' }, runtime),
    ]);

    const profile = buildComplianceProfile({
        resource,
        protectedResource,
        rootProtectedResource,
        mcpChallenge,
        authorizationServer,
        oauthMetadata,
        jwks,
    });
    finishPhase('authorizationMetadata');

    // CIMD is an independent client-identity flow once issuer metadata is known. Start it now so its metadata/token/
    // refresh/userinfo round trips overlap the DCR path instead of extending the critical path after runtime checks.
    const cimdAdvertised = metadata?.['client_id_metadata_document_supported'] === true;
    const cimdFlowPromise = runCimdSmoke({
        advertised: cimdAdvertised,
        metadata,
        authorizationServer,
        resource,
        runtime,
    });

    const dcrEnabled = runtime.runDcrCompatibility;
    const registration = dcrEnabled
        ? await registerPublicClient(metadata, authorizationServer, runtime)
        : skippedProbe('DCR compatibility smoke disabled; canonical remote smoke uses CIMD.');
    finishPhase('registration');
    // DCR remains an explicit compatibility probe, but it is no longer required to establish the canonical runtime
    // identity. This prevents our own remote smoke from manufacturing persistent DCR demand and polluting retirement
    // evidence while preserving a deliberate compatibility mode for release investigations.
    const [dcrToken, parToken] =
        dcrEnabled && registration.ok
            ? await Promise.all([
                  authorizeAndExchangeRegisteredClient(metadata, registration, resource, FULL_REPO_SCOPE, runtime),
                  authorizeAndExchangeRegisteredClientViaPar(
                      metadata,
                      registration,
                      resource,
                      FULL_REPO_SCOPE,
                      runtime,
                  ),
              ])
            : [skippedProbe('DCR compatibility smoke disabled.'), skippedProbe('DCR compatibility smoke disabled.')];
    finishPhase('authorizationFlows');
    const registrationBody = asRecord(registration.body);
    const dcrTokenBody = asRecord(dcrToken.body);
    const parTokenBody = asRecord(parToken.body);
    const parTokenValidation = validateAccessTokenClaims(parTokenBody?.['access_token'], {
        expectedIssuer: String(metadata?.['issuer'] ?? authorizationServer),
        expectedResource: resource,
        expectedScopes: FULL_REPO_SCOPE,
        expectedClientId: String(registrationBody?.['client_id'] ?? ''),
    });
    const dcrTokenClaims = summarizeJwtClaims(dcrTokenBody?.['access_token']);
    const dcrTokenValidation = validateAccessTokenClaims(dcrTokenBody?.['access_token'], {
        expectedIssuer: String(metadata?.['issuer'] ?? authorizationServer),
        expectedResource: resource,
        expectedScopes: FULL_REPO_SCOPE,
        expectedClientId: String(registrationBody?.['client_id'] ?? ''),
    });
    const initialDcrAccessToken =
        typeof dcrTokenBody?.['access_token'] === 'string' ? dcrTokenBody['access_token'] : null;
    const dcrRuntimeChecksPromise =
        dcrEnabled && initialDcrAccessToken ? runMcpToolRuntimeChecks(mcpUrl, initialDcrAccessToken, runtime) : null;
    const [dcrIntrospection, dcrRefreshToken] = dcrEnabled
        ? await Promise.all([
              typeof dcrTokenBody?.['access_token'] === 'string'
                  ? introspectToken(
                        metadata,
                        resource,
                        String(registrationBody?.['client_id'] ?? ''),
                        dcrTokenBody['access_token'],
                        runtime,
                    )
                  : Promise.resolve(failure('access_token missing')),
              typeof dcrTokenBody?.['refresh_token'] === 'string'
                  ? refreshToken(
                        metadata,
                        resource,
                        String(registrationBody?.['client_id'] ?? ''),
                        dcrTokenBody['refresh_token'],
                        runtime,
                    )
                  : Promise.resolve(failure('refresh_token missing')),
          ])
        : [skippedProbe('DCR compatibility smoke disabled.'), skippedProbe('DCR compatibility smoke disabled.')];
    finishPhase('tokenLifecycle');
    const dcrRefreshTokenBody = asRecord(dcrRefreshToken.body);
    const dcrRefreshTokenValidation = validateAccessTokenClaims(dcrRefreshTokenBody?.['access_token'], {
        expectedIssuer: String(metadata?.['issuer'] ?? authorizationServer),
        expectedResource: resource,
        expectedScopes: FULL_REPO_SCOPE,
        expectedClientId: String(registrationBody?.['client_id'] ?? ''),
    });
    const dcrRuntimeAccessToken =
        initialDcrAccessToken ??
        (typeof dcrRefreshTokenBody?.['access_token'] === 'string' ? dcrRefreshTokenBody['access_token'] : null);

    const cimdRun = await cimdFlowPromise;
    const cimdFlow = cimdRun.report;
    const primaryRuntimeIdentity = dcrEnabled ? 'dcr' : 'cimd';
    const primaryRuntimeAccessToken = dcrEnabled ? dcrRuntimeAccessToken : cimdRun.accessToken;
    const runtimeChecks = dcrRuntimeChecksPromise
        ? await dcrRuntimeChecksPromise
        : typeof primaryRuntimeAccessToken === 'string'
          ? await runMcpToolRuntimeChecks(mcpUrl, primaryRuntimeAccessToken, runtime)
          : {
                modern2026: {
                    protocolEra: /** @type {const} */ ('2026'),
                    protocolVersion: MCP_PROTOCOL_MODERN_VERSION,
                    discovery: failure(`${primaryRuntimeIdentity} token missing`),
                    runtimeHealth: failure(`${primaryRuntimeIdentity} token missing`),
                    authenticatedToolsList: failure(`${primaryRuntimeIdentity} token missing`),
                    subscription: failure(`${primaryRuntimeIdentity} token missing`),
                    requestEvidence: [],
                    serverVersion: null,
                },
                legacy2025Compatibility: {
                    enabled: false,
                    protocolVersion: runtime.legacyProtocolVersion,
                    reason: `${primaryRuntimeIdentity} token missing`,
                },
            };
    finishPhase('runtimeChecks');
    const modernRuntime = runtimeChecks.modern2026;
    const runtimeHealth = modernRuntime.runtimeHealth;
    const authenticatedToolsList = modernRuntime.authenticatedToolsList;
    const authenticatedToolsSummary = summarizeAuthenticatedToolsList(authenticatedToolsList, runtime);
    const modernSubscription = modernRuntime.subscription;
    const legacyCompatibility = asRecord(runtimeChecks.legacy2025Compatibility) ?? {};
    const legacyRuntimeHealth = asRecord(legacyCompatibility['runtimeHealth']);
    const legacyToolsList = asRecord(legacyCompatibility['authenticatedToolsList']);
    const legacySse = asRecord(legacyCompatibility['authenticatedSse']);
    const legacyCompatibilityOk =
        !runtime.runLegacyCompatibility ||
        (legacyRuntimeHealth?.['ok'] === true && legacyToolsList?.['ok'] === true && legacySse?.['ok'] === true);

    const dcrClientId = String(registrationBody?.['client_id'] ?? '');
    const dcrRefreshCredential =
        typeof dcrRefreshTokenBody?.['refresh_token'] === 'string'
            ? dcrRefreshTokenBody['refresh_token']
            : typeof dcrTokenBody?.['refresh_token'] === 'string'
              ? dcrTokenBody['refresh_token']
              : null;
    const parRefreshCredential =
        typeof parTokenBody?.['refresh_token'] === 'string' ? parTokenBody['refresh_token'] : null;
    const [dcrCleanup, parCleanup] = dcrEnabled
        ? await Promise.all([
              dcrRefreshCredential
                  ? revokeToken(metadata, resource, dcrClientId, dcrRefreshCredential, runtime)
                  : Promise.resolve(skippedProbe('DCR refresh credential unavailable.')),
              parRefreshCredential
                  ? revokeToken(metadata, resource, dcrClientId, parRefreshCredential, runtime)
                  : Promise.resolve(skippedProbe('PAR refresh credential unavailable.')),
          ])
        : [skippedProbe('DCR compatibility smoke disabled.'), skippedProbe('DCR compatibility smoke disabled.')];
    const dcrCleanupOk = !dcrEnabled || (dcrCleanup.ok && parCleanup.ok);

    const privateKeyJwtFlow = dcrEnabled
        ? await runPrivateKeyJwtSmoke({
              metadata,
              authorizationServer,
              resource,
              runtime,
          })
        : { ok: true, required: false, skipped: true, reason: 'DCR compatibility smoke disabled.' };

    const negativeResourceChecks = dcrEnabled
        ? await runNegativeResourceChecks({
              metadata,
              registration,
              resource,
              runtime,
          })
        : { ok: true, skipped: true, reason: 'DCR compatibility smoke disabled.' };
    finishPhase('optionalChecks');

    const checks = {
        protectedResource: protectedResource.ok,
        rootProtectedResource: rootProtectedResource.ok,
        mcpChallenge: mcpChallenge.ok,
        protectedResourceCors: protectedResourceCors.ok,
        oauthMetadata: oauthMetadata.ok,
        oauthMetadataCors: oauthMetadataCors.ok,
        jwks: jwks.ok,
        profile: profile.ok,
        registration: !dcrEnabled || registration.ok,
        dcrToken: !dcrEnabled || dcrToken.ok,
        dcrTokenClaims: !dcrEnabled || dcrTokenValidation.ok,
        par: !dcrEnabled || parToken.skipped === true || (parToken.ok && parTokenValidation.ok),
        dcrIntrospection: !dcrEnabled || dcrIntrospection.ok,
        dcrRefreshToken: !dcrEnabled || dcrRefreshToken.ok,
        dcrRefreshTokenClaims: !dcrEnabled || dcrRefreshTokenValidation.ok,
        dcrCleanup: dcrCleanupOk,
        modernDiscovery: modernRuntime.discovery.ok,
        runtimeHealth: runtimeHealth.ok,
        authenticatedToolsList: authenticatedToolsSummary.ok,
        modernSubscription: modernSubscription.ok,
        legacyCompatibility: legacyCompatibilityOk,
        cimd: dcrEnabled ? !cimdAdvertised || Boolean(cimdFlow.ok) : cimdAdvertised && Boolean(cimdFlow.ok),
        privateKeyJwt: !dcrEnabled || !privateKeyJwtFlow.required || privateKeyJwtFlow.ok,
        negativeResourceChecks: !dcrEnabled || !runtime.runNegativeResourceChecks || negativeResourceChecks.ok,
    };
    const failedChecks = Object.entries(checks)
        .filter(([, ok]) => !ok)
        .map(([name]) => name);

    return {
        ok: failedChecks.length === 0,
        implementation: {
            name: OAUTH_SMOKE_IMPLEMENTATION_NAME,
            version: OAUTH_SMOKE_IMPLEMENTATION_VERSION,
        },
        durationMs: Date.now() - startedAtMs,
        phaseTimings,
        resource,
        mcpUrl,
        protectedResourceUrl,
        rootProtectedResourceUrl,
        protectedResource: summarizeProtectedResourceProbe(protectedResource),
        rootProtectedResource: summarizeProtectedResourceProbe(rootProtectedResource),
        mcpChallenge,
        cors: {
            protectedResource: protectedResourceCors,
            oauthMetadata: oauthMetadataCors,
        },
        authorizationServer,
        oauthMetadataUrl: oauthDiscovery.url,
        oauthMetadataDiscoveryAttempts: oauthDiscovery.attempts,
        oauthMetadata: summarizeMetadataProbe(oauthMetadata),
        jwks: summarizeJwks(jwks),
        compliance: profile,
        registration: summarizeRegistration(registration),
        dcrFlow: {
            enabled: dcrEnabled,
            token: summarizeToken(dcrToken),
            tokenClaims: dcrTokenClaims,
            tokenValidation: dcrTokenValidation,
            parToken: summarizeToken(parToken),
            parTokenValidation,
            introspection: summarizeIntrospection(dcrIntrospection),
            refreshToken: summarizeToken(dcrRefreshToken),
            refreshTokenValidation: dcrRefreshTokenValidation,
            cleanup: {
                ok: dcrCleanupOk,
                rotatedGrant: summarizeTokenCleanup(dcrCleanup),
                parGrant: summarizeTokenCleanup(parCleanup),
            },
        },
        runtimeFlow: {
            identity: primaryRuntimeIdentity,
            protocolEra: modernRuntime.protocolEra,
            protocolVersion: modernRuntime.protocolVersion,
            modern2026: {
                discovery: summarizeRuntimeProbe(modernRuntime.discovery),
                runtimeHealth: summarizeRuntimeProbe(runtimeHealth),
                authenticatedToolsList: authenticatedToolsSummary,
                subscription: summarizeModernSubscription(modernSubscription),
                requestEvidence: modernRuntime.requestEvidence,
                serverVersion: modernRuntime.serverVersion,
            },
            // Compatibility aliases for existing connector-smoke consumers. They now project the modern engine only.
            runtimeHealth: summarizeRuntimeProbe(runtimeHealth),
            authenticatedToolsList: authenticatedToolsSummary,
            modernSubscription: summarizeModernSubscription(modernSubscription),
            legacy2025Compatibility: {
                ...legacyCompatibility,
                ok: legacyCompatibilityOk,
                ...(legacySse ? { authenticatedSse: summarizeSseProbe(/** @type {ProbeResult} */ (legacySse)) } : {}),
            },
        },
        cimdFlow,
        privateKeyJwtFlow,
        negativeResourceChecks,
        checks,
        failedChecks,
    };
}

/**
 * @param {OAuthSmokeOptions} options
 * @param {NodeJS.ProcessEnv} env
 * @returns {OAuthSmokeRuntimeOptions}
 */
function readSmokeRuntimeOptions(options, env) {
    return {
        timeoutMs: readPositiveInteger(
            options.timeoutMs,
            readEnvInteger(env, 'COPILOT_MCP_OAUTH_SMOKE_TIMEOUT_MS', DEFAULT_TIMEOUT_MS),
            500,
        ),
        retryAttempts: readPositiveInteger(
            options.retryAttempts,
            readEnvInteger(env, 'COPILOT_MCP_OAUTH_SMOKE_RETRY_ATTEMPTS', DEFAULT_RETRY_ATTEMPTS),
            1,
        ),
        retryBaseDelayMs: readPositiveInteger(
            options.retryBaseDelayMs,
            readEnvInteger(env, 'COPILOT_MCP_OAUTH_SMOKE_RETRY_BASE_DELAY_MS', DEFAULT_RETRY_BASE_DELAY_MS),
            0,
        ),
        retryMaxDelayMs: readPositiveInteger(
            options.retryMaxDelayMs,
            readEnvInteger(env, 'COPILOT_MCP_OAUTH_SMOKE_RETRY_MAX_DELAY_MS', DEFAULT_RETRY_MAX_DELAY_MS),
            0,
        ),
        strict: readBooleanOption(options.strict, env, 'COPILOT_MCP_OAUTH_SMOKE_STRICT', true),
        runDcrCompatibility: readBooleanOption(
            options.runDcrCompatibility,
            env,
            'COPILOT_MCP_OAUTH_SMOKE_DCR_COMPATIBILITY',
            false,
        ),
        runLegacyCompatibility: readBooleanOption(
            options.runLegacyCompatibility,
            env,
            'COPILOT_MCP_OAUTH_SMOKE_LEGACY_COMPATIBILITY',
            false,
        ),
        runPrivateKeyJwt: readBooleanOption(
            options.runPrivateKeyJwt,
            env,
            'COPILOT_MCP_OAUTH_SMOKE_PRIVATE_KEY_JWT',
            true,
        ),
        runNegativeResourceChecks: readBooleanOption(
            options.runNegativeResourceChecks,
            env,
            'COPILOT_MCP_OAUTH_SMOKE_NEGATIVE_RESOURCE_CHECKS',
            true,
        ),
        verboseTools: readBooleanOption(options.verboseTools, env, 'COPILOT_MCP_OAUTH_SMOKE_VERBOSE_TOOLS', false),
        localToolNames: [...new Set(options.localToolNames ?? [])].sort((left, right) => left.localeCompare(right)),
        protocolVersion: MCP_PROTOCOL_MODERN_VERSION,
        legacyProtocolVersion: normalizeLegacyProtocolVersion(env['COPILOT_MCP_PROTOCOL_VERSION']),
    };
}

/** @param {unknown} value */
function normalizeLegacyProtocolVersion(value) {
    const configured = String(value ?? '').trim();
    return /^2025-\d{2}-\d{2}$/u.test(configured) ? configured : MCP_PROTOCOL_LEGACY_DEFAULT_VERSION;
}

/**
 * @param {unknown} value
 * @param {NodeJS.ProcessEnv} env
 * @param {string} envName
 * @param {boolean} fallback
 * @returns {boolean}
 */
function readBooleanOption(value, env, envName, fallback) {
    if (typeof value === 'boolean') return value;
    const raw = String(env[envName] ?? '')
        .trim()
        .toLowerCase();
    if (!raw) return fallback;
    if (raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on') return true;
    if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'off') return false;
    return fallback;
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @param {string} envName
 * @param {number} fallback
 * @returns {number}
 */
function readEnvInteger(env, envName, fallback) {
    const parsed = Number(env[envName] ?? fallback);
    return Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
}

/**
 * @param {unknown} value
 * @param {number} fallback
 * @param {number} minimum
 * @returns {number}
 */
function readPositiveInteger(value, fallback, minimum) {
    const parsed = Number(value ?? fallback);
    return Number.isFinite(parsed) && parsed >= minimum ? Math.floor(parsed) : fallback;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeResource(value) {
    const raw = String(value ?? '')
        .trim()
        .replace(/\/+$/u, '');
    if (!raw || raw.length > MAX_URL_LENGTH)
        throw new Error('OAuth smoke resource is required and must be reasonably short.');
    const url = new URL(raw);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopbackHostname(url.hostname))) {
        throw new Error('OAuth smoke resource must be HTTPS unless it is localhost.');
    }
    if (url.username || url.password || url.hash || url.search)
        throw new Error('OAuth smoke resource must not include credentials, query, or fragment.');
    return url.toString().replace(/\/+$/u, '');
}

/**
 * @param {string} resource
 * @returns {string}
 */
function buildProtectedResourceMetadataUrl(resource) {
    const normalized = resource.replace(/\/+$/u, '');
    if (normalized.endsWith('/mcp')) {
        const base = normalized.slice(0, -'/mcp'.length);
        return `${base}/.well-known/oauth-protected-resource/mcp`;
    }
    return `${normalized}/.well-known/oauth-protected-resource`;
}

/**
 * @param {string} resource
 * @returns {string}
 */
function buildRootProtectedResourceMetadataUrl(resource) {
    const url = new URL(resource);
    return `${url.origin}/.well-known/oauth-protected-resource`;
}

/**
 * @param {string} resource
 * @returns {string}
 */
function buildMcpUrlFromResource(resource) {
    const normalized = resource.replace(/\/+$/u, '');
    return normalized.endsWith('/mcp') ? normalized : `${normalized}/mcp`;
}

/**
 * @param {string} mcpUrl
 * @param {OAuthSmokeRuntimeOptions} runtime
 * @returns {Promise<Record<string, unknown> & { ok: boolean }>}
 */
async function probeMcpUnauthorizedChallenge(mcpUrl, runtime) {
    const probe = await probeJsonWithRetry(
        mcpUrl,
        {
            method: 'POST',
            headers: {
                accept: 'application/json, text/event-stream',
                'content-type': 'application/json',
                'mcp-protocol-version': runtime.protocolVersion,
            },
            body: JSON.stringify({ jsonrpc: '2.0', id: 401, method: 'tools/list', params: {} }),
        },
        runtime,
    );
    const authenticate = probe.headers?.['www-authenticate'] ?? '';
    return {
        ok:
            probe.status === 401 &&
            /^Bearer\b/iu.test(authenticate) &&
            /resource_metadata="/iu.test(authenticate) &&
            /scope="/iu.test(authenticate),
        status: probe.status ?? null,
        attempts: probe.attempts ?? null,
        challengePresent: /^Bearer\b/iu.test(authenticate),
        resourceMetadataPresent: /resource_metadata="/iu.test(authenticate),
        scopePresent: /scope="/iu.test(authenticate),
        wwwAuthenticate: authenticate,
        error: probe.error ?? null,
    };
}

/**
 * @param {string} url
 * @param {string} requestMethod
 * @param {OAuthSmokeRuntimeOptions} runtime
 * @returns {Promise<Record<string, unknown> & { ok: boolean }>}
 */
async function probeCorsPreflightWithRetry(url, requestMethod, runtime) {
    return retryOAuthSmokeOperation(
        async () => probeCorsPreflightOnce(url, requestMethod, runtime),
        runtime,
        isTransientCorsProbe,
    );
}

/**
 * @param {string} url
 * @param {string} requestMethod
 * @param {OAuthSmokeRuntimeOptions} runtime
 * @returns {Promise<Record<string, unknown> & { ok: boolean; transient?: boolean }>}
 */
async function probeCorsPreflightOnce(url, requestMethod, runtime) {
    try {
        const response = await fetch(url, {
            method: 'OPTIONS',
            headers: {
                origin: 'https://chatgpt.com',
                'access-control-request-method': requestMethod,
                'access-control-request-headers': 'authorization, content-type',
            },
            signal: AbortSignal.timeout(runtime.timeoutMs),
        });
        const allowOrigin = response.headers.get('access-control-allow-origin');
        const allowHeaders = response.headers.get('access-control-allow-headers') ?? '';
        const allowMethods = response.headers.get('access-control-allow-methods') ?? '';
        return {
            ok:
                response.status === 204 &&
                allowOrigin === 'https://chatgpt.com' &&
                /authorization/iu.test(allowHeaders) &&
                /content-type/iu.test(allowHeaders),
            transient: isTransientOAuthSmokeHttpStatus(response.status),
            status: response.status,
            allowOrigin,
            allowHeaders,
            allowMethods,
        };
    } catch (error) {
        return { ok: false, transient: true, error: error instanceof Error ? error.message : String(error) };
    }
}

/**
 * @param {Record<string, unknown> & { ok: boolean; transient?: boolean }} probe
 * @returns {boolean}
 */
function isTransientCorsProbe(probe) {
    return Boolean(!probe.ok && probe.transient);
}

/**
 * @param {string} authorizationServer
 * @param {OAuthSmokeRuntimeOptions} runtime
 * @returns {Promise<{
 *     url: string;
 *     probe: ProbeResult;
 *     attempts: { url: string; ok: boolean; status: number | null; error: string | null }[];
 * }>}
 */
async function discoverAuthorizationServerMetadata(authorizationServer, runtime) {
    const candidates = buildAuthorizationServerMetadataCandidates(authorizationServer);
    const attempts = [];
    for (const url of candidates) {
        const probe = await probeJsonWithRetry(url, { method: 'GET' }, runtime);
        attempts.push({ url, ok: probe.ok, status: probe.status ?? null, error: probe.error ?? null });
        const body = asRecord(probe.body);
        if (
            probe.ok &&
            typeof body?.['issuer'] === 'string' &&
            typeof body?.['authorization_endpoint'] === 'string' &&
            typeof body?.['token_endpoint'] === 'string'
        ) {
            return { url, probe, attempts };
        }
    }
    return {
        url: candidates[0] ?? authorizationServer,
        probe: failure('authorization server metadata discovery failed'),
        attempts,
    };
}

/**
 * @param {string} issuer
 * @returns {string[]}
 */
function buildAuthorizationServerMetadataCandidates(issuer) {
    const url = new URL(issuer);
    const path = url.pathname.replace(/\/+$/u, '');
    if (!path || path === '/') {
        return [
            `${url.origin}/.well-known/oauth-authorization-server`,
            `${url.origin}/.well-known/openid-configuration`,
        ];
    }
    return [
        `${url.origin}/.well-known/oauth-authorization-server${path}`,
        `${url.origin}/.well-known/openid-configuration${path}`,
        `${url.origin}${path}/.well-known/openid-configuration`,
    ];
}

/**
 * @param {{
 *     resource: string;
 *     protectedResource: ProbeResult;
 *     rootProtectedResource: ProbeResult;
 *     mcpChallenge: Record<string, unknown> & { ok: boolean };
 *     authorizationServer: string;
 *     oauthMetadata: ProbeResult;
 *     jwks: ProbeResult;
 * }} input
 * @returns {{ ok: boolean; errors: string[]; warnings: string[]; facts: Record<string, unknown> }}
 */
function buildComplianceProfile(input) {
    /** @type {string[]} */
    const errors = [];
    /** @type {string[]} */
    const warnings = [];
    const prm = asRecord(input.protectedResource.body);
    const rootPrm = asRecord(input.rootProtectedResource.body);
    const metadata = asRecord(input.oauthMetadata.body);
    const tokenAuthMethods = normalizeStringArray(metadata?.['token_endpoint_auth_methods_supported']);
    const signingAlgs = normalizeStringArray(metadata?.['id_token_signing_alg_values_supported']);
    const scopesSupported = normalizeStringArray(metadata?.['scopes_supported']);

    if (!input.protectedResource.ok) errors.push('path-specific Protected Resource Metadata is not reachable.');
    if (!input.rootProtectedResource.ok) warnings.push('root Protected Resource Metadata is not reachable.');
    if (prm?.['resource'] !== input.resource)
        errors.push('Protected Resource Metadata resource does not exactly match the smoke resource.');
    if (!normalizeStringArray(prm?.['authorization_servers']).includes(input.authorizationServer)) {
        errors.push('Protected Resource Metadata does not list the selected authorization server.');
    }
    if (!normalizeStringArray(prm?.['bearer_methods_supported']).includes('header')) {
        errors.push('Protected Resource Metadata must advertise header bearer method.');
    }
    if (!input.mcpChallenge.ok) errors.push('MCP endpoint did not return a valid OAuth 401 challenge.');

    if (!input.oauthMetadata.ok) errors.push('authorization server metadata is not reachable.');
    if (metadata?.['issuer'] !== input.authorizationServer)
        errors.push('authorization server issuer does not match selected issuer.');
    for (const field of ['authorization_endpoint', 'token_endpoint', 'jwks_uri']) {
        if (typeof metadata?.[field] !== 'string') errors.push(`authorization server metadata missing ${field}.`);
    }
    if (!normalizeStringArray(metadata?.['code_challenge_methods_supported']).includes('S256')) {
        errors.push('authorization server metadata must advertise PKCE S256.');
    }
    if (metadata?.['resource_parameter_supported'] !== true) {
        errors.push('authorization server metadata must advertise resource_parameter_supported=true.');
    }
    if (metadata?.['authorization_response_iss_parameter_supported'] !== true) {
        errors.push(
            'authorization server metadata should advertise authorization_response_iss_parameter_supported=true.',
        );
    }
    if (!tokenAuthMethods.includes('none'))
        errors.push('authorization server metadata must support none for public-client smoke.');
    if (!tokenAuthMethods.includes('private_key_jwt')) {
        warnings.push(
            'authorization server metadata does not advertise private_key_jwt; ChatGPT CIMD can use private_key_jwt.',
        );
    }
    if (metadata?.['client_id_metadata_document_supported'] !== true) {
        warnings.push(
            'authorization server metadata does not advertise CIMD; MCP 2026-07-28 clients prefer CIMD when available.',
        );
    }
    if (!scopesSupported.includes('offline_access')) {
        errors.push(
            'authorization server metadata must advertise offline_access when refresh-token connectivity is supported.',
        );
    }
    if (typeof metadata?.['registration_endpoint'] !== 'string') {
        warnings.push('authorization server metadata does not advertise DCR registration_endpoint fallback.');
    }
    if (!input.jwks.ok) errors.push('JWKS endpoint is not reachable.');
    const jwksBody = asRecord(input.jwks.body);
    const jwksKeys = Array.isArray(jwksBody?.['keys']) ? jwksBody['keys'] : [];
    const jwksAlgs = jwksKeys
        .map((key) => (key && typeof key === 'object' ? String(key['alg'] ?? '') : ''))
        .filter(Boolean);
    if (!jwksAlgs.includes('ES256'))
        warnings.push('JWKS does not expose ES256 signing key; ES256 primary migration is not active.');
    if (!signingAlgs.includes('ES256'))
        warnings.push('authorization server metadata does not advertise ES256 id_token signing.');
    for (const scope of FULL_REPO_SCOPE.split(/\s+/u)) {
        if (!scopesSupported.includes(scope))
            warnings.push(`authorization server metadata does not list expected scope ${scope}.`);
    }

    return {
        ok: errors.length === 0,
        errors,
        warnings,
        facts: {
            prmResource: prm?.['resource'] ?? null,
            rootPrmResource: rootPrm?.['resource'] ?? null,
            authorizationServers: prm?.['authorization_servers'] ?? [],
            issuer: metadata?.['issuer'] ?? null,
            clientIdMetadataDocumentSupported: metadata?.['client_id_metadata_document_supported'] === true,
            tokenEndpointAuthMethodsSupported: tokenAuthMethods,
            codeChallengeMethodsSupported: metadata?.['code_challenge_methods_supported'] ?? [],
            resourceParameterSupported: metadata?.['resource_parameter_supported'] === true,
            authorizationResponseIssParameterSupported:
                metadata?.['authorization_response_iss_parameter_supported'] === true,
            idTokenSigningAlgValuesSupported: signingAlgs,
            jwksAlgs,
        },
    };
}

/**
 * @param {Record<string, unknown> | null} metadata
 * @param {string} authorizationServer
 * @param {OAuthSmokeRuntimeOptions} runtime
 * @returns {Promise<ProbeResult>}
 */
async function registerPublicClient(metadata, authorizationServer, runtime) {
    const endpoint =
        typeof metadata?.['registration_endpoint'] === 'string'
            ? metadata['registration_endpoint']
            : `${authorizationServer}/oauth/register`;
    return probeJsonWithRetry(
        endpoint,
        {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({
                client_name: 'Copilot MCP OAuth smoke public client',
                redirect_uris: ['https://chatgpt.com/connector/oauth/codex-smoke'],
                token_endpoint_auth_method: 'none',
                grant_types: ['authorization_code', 'refresh_token'],
                response_types: ['code'],
            }),
        },
        runtime,
    );
}

/**
 * @param {{
 *     metadata: Record<string, unknown> | null;
 *     authorizationServer: string;
 *     resource: string;
 *     runtime: OAuthSmokeRuntimeOptions;
 * }} input
 * @returns {Promise<Record<string, unknown> & { ok: boolean; required: boolean }>}
 */
async function runPrivateKeyJwtSmoke(input) {
    const authMethods = normalizeStringArray(input.metadata?.['token_endpoint_auth_methods_supported']);
    const required = input.runtime.runPrivateKeyJwt && authMethods.includes('private_key_jwt');
    if (!required) {
        return {
            ok: true,
            required: false,
            skipped: true,
            reason: input.runtime.runPrivateKeyJwt ? 'private_key_jwt not advertised' : 'disabled',
        };
    }
    try {
        const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true });
        const publicJwk = /** @type {Record<string, unknown>} */ (await exportJWK(publicKey));
        const kid = `smoke-${base64Url(randomBytes(12))}`;
        publicJwk['kid'] = kid;
        publicJwk['alg'] = 'ES256';
        publicJwk['use'] = 'sig';

        const registration = await registerPrivateKeyJwtClient(
            input.metadata,
            input.authorizationServer,
            publicJwk,
            input.runtime,
        );
        const registrationBody = asRecord(registration.body);
        const clientId = String(registrationBody?.['client_id'] ?? '');
        const redirectUri =
            normalizeStringArray(registrationBody?.['redirect_uris'])[0] ??
            'https://chatgpt.com/connector/oauth/codex-smoke';
        const assertionFactory = async (/** @type {string} */ tokenEndpoint) => ({
            client_assertion_type: CLIENT_ASSERTION_TYPE_JWT_BEARER,
            client_assertion: await buildClientAssertion({
                privateKey,
                kid,
                clientId,
                tokenEndpoint,
            }),
        });
        const token = registration.ok
            ? await authorizeAndExchangeClient(
                  input.metadata,
                  {
                      clientId,
                      redirectUri,
                      resource: input.resource,
                      scope: FULL_REPO_SCOPE,
                      clientAssertion: assertionFactory,
                  },
                  input.runtime,
              )
            : failure('private_key_jwt registration failed');
        const tokenBody = asRecord(token.body);
        const refresh =
            typeof tokenBody?.['refresh_token'] === 'string'
                ? await refreshToken(
                      input.metadata,
                      input.resource,
                      clientId,
                      tokenBody['refresh_token'],
                      input.runtime,
                      assertionFactory,
                  )
                : failure('refresh_token missing');
        const tokenValidation = validateAccessTokenClaims(tokenBody?.['access_token'], {
            expectedIssuer: String(input.metadata?.['issuer'] ?? input.authorizationServer),
            expectedResource: input.resource,
            expectedScopes: FULL_REPO_SCOPE,
            expectedClientId: clientId,
        });
        const refreshBody = asRecord(refresh.body);
        const refreshValidation = validateAccessTokenClaims(refreshBody?.['access_token'], {
            expectedIssuer: String(input.metadata?.['issuer'] ?? input.authorizationServer),
            expectedResource: input.resource,
            expectedScopes: FULL_REPO_SCOPE,
            expectedClientId: clientId,
        });
        const refreshCredential =
            typeof refreshBody?.['refresh_token'] === 'string'
                ? refreshBody['refresh_token']
                : typeof tokenBody?.['refresh_token'] === 'string'
                  ? tokenBody['refresh_token']
                  : null;
        const cleanup = refreshCredential
            ? await revokeToken(
                  input.metadata,
                  input.resource,
                  clientId,
                  refreshCredential,
                  input.runtime,
                  assertionFactory,
              )
            : skippedProbe('private_key_jwt refresh credential unavailable.');
        const primaryOk = registration.ok && token.ok && refresh.ok && tokenValidation.ok && refreshValidation.ok;
        return {
            ok: primaryOk && cleanup.ok,
            primaryOk,
            required,
            registration: summarizeRegistration(registration),
            token: summarizeToken(token),
            tokenValidation,
            refreshToken: summarizeToken(refresh),
            refreshTokenValidation: refreshValidation,
            cleanup: summarizeTokenCleanup(cleanup),
        };
    } catch (error) {
        return {
            ok: false,
            required,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

/**
 * @param {Record<string, unknown> | null} metadata
 * @param {string} authorizationServer
 * @param {Record<string, unknown>} publicJwk
 * @param {OAuthSmokeRuntimeOptions} runtime
 * @returns {Promise<ProbeResult>}
 */
async function registerPrivateKeyJwtClient(metadata, authorizationServer, publicJwk, runtime) {
    const endpoint =
        typeof metadata?.['registration_endpoint'] === 'string'
            ? metadata['registration_endpoint']
            : `${authorizationServer}/oauth/register`;
    return probeJsonWithRetry(
        endpoint,
        {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({
                client_name: 'Copilot MCP OAuth smoke private_key_jwt client',
                redirect_uris: ['https://chatgpt.com/connector/oauth/codex-smoke'],
                token_endpoint_auth_method: 'private_key_jwt',
                grant_types: ['authorization_code', 'refresh_token'],
                response_types: ['code'],
                jwks: { keys: [publicJwk] },
            }),
        },
        runtime,
    );
}

/**
 * @param {{
 *     privateKey: CryptoKey | import('node:crypto').KeyObject;
 *     kid: string;
 *     clientId: string;
 *     tokenEndpoint: string;
 * }} input
 * @returns {Promise<string>}
 */
async function buildClientAssertion(input) {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({})
        .setProtectedHeader({ alg: 'ES256', kid: input.kid, typ: 'JWT' })
        .setIssuer(input.clientId)
        .setSubject(input.clientId)
        .setAudience(input.tokenEndpoint)
        .setIssuedAt(now)
        .setExpirationTime(now + 180)
        .setJti(`smoke-${base64Url(randomBytes(18))}`)
        .sign(input.privateKey);
}

/**
 * @param {Record<string, unknown> | null} metadata
 * @param {ProbeResult} registration
 * @param {string} resource
 * @param {string} scope
 * @param {OAuthSmokeRuntimeOptions} runtime
 * @returns {Promise<ProbeResult>}
 */
async function authorizeAndExchangeRegisteredClient(metadata, registration, resource, scope, runtime) {
    const registrationBody = asRecord(registration.body);
    const clientId = String(registrationBody?.['client_id'] ?? '');
    const redirectUri =
        normalizeStringArray(registrationBody?.['redirect_uris'])[0] ??
        'https://chatgpt.com/connector/oauth/codex-smoke';
    return authorizeAndExchangeClient(metadata, { clientId, redirectUri, resource, scope }, runtime);
}

/**
 * @param {Record<string, unknown> | null} metadata
 * @param {ProbeResult} registration
 * @param {string} resource
 * @param {string} scope
 * @param {OAuthSmokeRuntimeOptions} runtime
 * @returns {Promise<ProbeResult & { skipped?: boolean }>}
 */
async function authorizeAndExchangeRegisteredClientViaPar(metadata, registration, resource, scope, runtime) {
    const parEndpoint =
        typeof metadata?.['pushed_authorization_request_endpoint'] === 'string'
            ? metadata['pushed_authorization_request_endpoint']
            : '';
    if (!parEndpoint) return { ...failure('pushed_authorization_request_endpoint not advertised'), skipped: true };
    const registrationBody = asRecord(registration.body);
    const clientId = String(registrationBody?.['client_id'] ?? '');
    const redirectUri =
        normalizeStringArray(registrationBody?.['redirect_uris'])[0] ??
        'https://chatgpt.com/connector/oauth/codex-smoke';
    return authorizeAndExchangeClientViaPar(metadata, { clientId, redirectUri, resource, scope }, runtime, parEndpoint);
}

/**
 * @param {Record<string, unknown> | null} metadata
 * @param {AuthorizationClientRequest} client
 * @param {OAuthSmokeRuntimeOptions} runtime
 * @param {string} parEndpoint
 * @returns {Promise<ProbeResult>}
 */
async function authorizeAndExchangeClientViaPar(metadata, client, runtime, parEndpoint) {
    const verifier = base64Url(randomBytes(32));
    const challenge = base64Url(createHash('sha256').update(verifier).digest());
    const authorizationEndpoint = String(metadata?.['authorization_endpoint'] ?? `${client.resource}/oauth/authorize`);
    const tokenEndpoint = String(metadata?.['token_endpoint'] ?? `${client.resource}/oauth/token`);
    const state = base64Url(randomBytes(16));
    const parBody = new URLSearchParams({
        response_type: 'code',
        client_id: client.clientId,
        redirect_uri: client.redirectUri,
        scope: client.scope,
        resource: client.resource,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state,
    });
    const par = await probeJsonWithRetry(
        parEndpoint,
        {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
            body: parBody.toString(),
        },
        runtime,
    );
    const parBodyResult = asRecord(par.body);
    const requestUri = typeof parBodyResult?.['request_uri'] === 'string' ? parBodyResult['request_uri'] : '';
    if (!par.ok || !requestUri)
        return failure(`PAR failed: ${par.error ?? par.status ?? 'request_uri missing'}`, par.status);
    const authorizeUrl = new URL(authorizationEndpoint);
    authorizeUrl.searchParams.set('client_id', client.clientId);
    authorizeUrl.searchParams.set('request_uri', requestUri);
    const authorize = await probeRawWithRetry(authorizeUrl.toString(), { method: 'GET', redirect: 'manual' }, runtime);
    const location = authorize.headers?.['location'] ?? '';
    const redirectUrl = parseRedirectUrl(location, client.redirectUri);
    const code = redirectUrl?.searchParams.get('code') ?? null;
    const returnedState = redirectUrl?.searchParams.get('state') ?? null;
    const redirectError = redirectUrl?.searchParams.get('error') ?? null;
    if (!code) {
        return failure(
            buildAuthorizationFailureMessage({
                status: authorize.status ?? 0,
                location,
                redirectError,
                responseText:
                    typeof authorize.body === 'string' ? authorize.body : JSON.stringify(authorize.body ?? ''),
                clientId: client.clientId,
                redirectUri: client.redirectUri,
                scope: client.scope,
                resource: client.resource,
            }),
            authorize.status,
        );
    }
    if (returnedState !== state) return failure('authorization state mismatch', authorize.status);
    const tokenBody = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: client.clientId,
        redirect_uri: client.redirectUri,
        code_verifier: verifier,
        resource: client.resource,
    });
    if (client.clientAssertion) {
        const assertionFields = await client.clientAssertion(tokenEndpoint);
        for (const [key, value] of Object.entries(assertionFields)) tokenBody.set(key, value);
    }
    return probeJsonWithRetry(
        tokenEndpoint,
        {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
            body: tokenBody.toString(),
        },
        runtime,
    );
}

/**
 * @param {Record<string, unknown> | null} metadata
 * @param {string} resource
 * @param {string} clientId
 * @param {string} token
 * @param {OAuthSmokeRuntimeOptions} runtime
 * @param {(tokenEndpoint: string) => Promise<Record<string, string>>} [clientAssertion]
 * @returns {Promise<ProbeResult>}
 */
async function refreshToken(metadata, resource, clientId, token, runtime, clientAssertion) {
    const tokenEndpoint = String(metadata?.['token_endpoint'] ?? `${resource}/oauth/token`);
    const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: token,
        client_id: clientId,
        resource,
    });
    if (clientAssertion) {
        const assertionFields = await clientAssertion(tokenEndpoint);
        for (const [key, value] of Object.entries(assertionFields)) body.set(key, value);
    }
    return probeJsonWithRetry(
        tokenEndpoint,
        {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
            body: body.toString(),
        },
        runtime,
    );
}

/**
 * Revoke the newest refresh credential issued to a smoke client. RFC 7009 intentionally returns 200 for both revoked
 * and already-invalid credentials, so this probe treats HTTP success as cleanup success without trying to infer token
 * existence from a side channel.
 *
 * @param {Record<string, unknown> | null} metadata
 * @param {string} resource
 * @param {string} clientId
 * @param {string} token
 * @param {OAuthSmokeRuntimeOptions} runtime
 * @param {(endpoint: string) => Promise<Record<string, string>>} [clientAssertion]
 * @returns {Promise<ProbeResult>}
 */
async function revokeToken(metadata, resource, clientId, token, runtime, clientAssertion) {
    const endpoint = String(metadata?.['revocation_endpoint'] ?? `${resource}/oauth/revoke`);
    const body = new URLSearchParams({ token, token_type_hint: 'refresh_token', client_id: clientId });
    if (clientAssertion) {
        const assertionFields = await clientAssertion(endpoint);
        for (const [key, value] of Object.entries(assertionFields)) body.set(key, value);
    }
    return probeJsonWithRetry(
        endpoint,
        {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
            body: body.toString(),
        },
        runtime,
    );
}

/**
 * @param {Record<string, unknown> | null} metadata
 * @param {string} resource
 * @param {string} clientId
 * @param {string} token
 * @param {OAuthSmokeRuntimeOptions} runtime
 * @returns {Promise<ProbeResult>}
 */
async function introspectToken(metadata, resource, clientId, token, runtime) {
    const endpoint = String(metadata?.['introspection_endpoint'] ?? `${resource}/oauth/introspect`);
    return probeJsonWithRetry(
        endpoint,
        {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
            body: new URLSearchParams({
                token,
                client_id: clientId,
            }).toString(),
        },
        runtime,
    );
}

/**
 * @param {Record<string, unknown> | null} metadata
 * @param {AuthorizationClientRequest} client
 * @param {OAuthSmokeRuntimeOptions} runtime
 * @returns {Promise<ProbeResult>}
 */
async function authorizeAndExchangeClient(metadata, client, runtime) {
    const verifier = base64Url(randomBytes(32));
    const challenge = base64Url(createHash('sha256').update(verifier).digest());
    const authorizationEndpoint = String(metadata?.['authorization_endpoint'] ?? `${client.resource}/oauth/authorize`);
    const tokenEndpoint = String(metadata?.['token_endpoint'] ?? `${client.resource}/oauth/token`);
    const authorizeUrl = new URL(authorizationEndpoint);
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('client_id', client.clientId);
    authorizeUrl.searchParams.set('redirect_uri', client.redirectUri);
    authorizeUrl.searchParams.set('scope', client.scope);
    if (client.omitResourceInAuthorize !== true) authorizeUrl.searchParams.set('resource', client.resource);
    authorizeUrl.searchParams.set('code_challenge', challenge);
    authorizeUrl.searchParams.set('code_challenge_method', 'S256');
    const state = base64Url(randomBytes(16));
    authorizeUrl.searchParams.set('state', state);
    const authorize = await probeRawWithRetry(authorizeUrl.toString(), { method: 'GET', redirect: 'manual' }, runtime);
    const location = authorize.headers?.['location'] ?? '';
    const redirectUrl = parseRedirectUrl(location, client.redirectUri);
    const code = redirectUrl?.searchParams.get('code') ?? null;
    const returnedState = redirectUrl?.searchParams.get('state') ?? null;
    const redirectError = redirectUrl?.searchParams.get('error') ?? null;
    if (!code) {
        return failure(
            buildAuthorizationFailureMessage({
                status: authorize.status ?? 0,
                location,
                redirectError,
                responseText:
                    typeof authorize.body === 'string' ? authorize.body : JSON.stringify(authorize.body ?? ''),
                clientId: client.clientId,
                redirectUri: client.redirectUri,
                scope: client.scope,
                resource: client.omitResourceInAuthorize === true ? '<omitted>' : client.resource,
            }),
            authorize.status,
        );
    }
    if (returnedState !== state) return failure('authorization state mismatch', authorize.status);
    const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: client.clientId,
        redirect_uri: client.redirectUri,
        code_verifier: verifier,
    });
    if (client.omitResourceInToken !== true) body.set('resource', client.resource);
    if (client.clientAssertion) {
        const assertionFields = await client.clientAssertion(tokenEndpoint);
        for (const [key, value] of Object.entries(assertionFields)) body.set(key, value);
    }
    return probeJsonWithRetry(
        tokenEndpoint,
        {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
            body: body.toString(),
        },
        runtime,
    );
}

/**
 * @param {{
 *     advertised: boolean;
 *     metadata: Record<string, unknown> | null;
 *     authorizationServer: string;
 *     resource: string;
 *     runtime: OAuthSmokeRuntimeOptions;
 * }} input
 * @returns {Promise<{ report: Record<string, unknown> & { ok: boolean }; accessToken: string | null }>}
 */
async function runCimdSmoke(input) {
    if (!input.advertised) {
        return {
            report: {
                ok: true,
                advertised: false,
                canonicalForThisIssuer: 'dcr',
                skipped: true,
                reason: 'client_id_metadata_document_supported not advertised',
            },
            accessToken: null,
        };
    }
    const cimdClientMetadataUrl = `${input.authorizationServer}/.well-known/oauth-client/codex-smoke.json`;
    const cimdClientMetadata = await probeJsonWithRetry(cimdClientMetadataUrl, { method: 'GET' }, input.runtime);
    const cimdBody = asRecord(cimdClientMetadata.body);
    const cimdRedirectUri =
        normalizeStringArray(cimdBody?.['redirect_uris'])[0] ?? 'https://chatgpt.com/connector/oauth/codex-smoke';
    const clientMetadataValidation = validateCimdClientMetadata(cimdBody, cimdClientMetadataUrl);
    const token = await authorizeAndExchangeClient(
        input.metadata,
        {
            clientId: cimdClientMetadataUrl,
            redirectUri: cimdRedirectUri,
            resource: input.resource,
            scope: FULL_REPO_OIDC_SCOPE,
        },
        input.runtime,
    );
    const tokenBody = asRecord(token.body);
    const tokenValidation = validateAccessTokenClaims(tokenBody?.['access_token'], {
        expectedIssuer: String(input.metadata?.['issuer'] ?? input.authorizationServer),
        expectedResource: input.resource,
        expectedScopes: FULL_REPO_OIDC_SCOPE,
        expectedClientId: cimdClientMetadataUrl,
    });
    const refresh =
        typeof tokenBody?.['refresh_token'] === 'string'
            ? await refreshToken(
                  input.metadata,
                  input.resource,
                  cimdClientMetadataUrl,
                  tokenBody['refresh_token'],
                  input.runtime,
              )
            : failure('refresh_token missing');
    const refreshBody = asRecord(refresh.body);
    const refreshValidation = validateAccessTokenClaims(refreshBody?.['access_token'], {
        expectedIssuer: String(input.metadata?.['issuer'] ?? input.authorizationServer),
        expectedResource: input.resource,
        expectedScopes: FULL_REPO_OIDC_SCOPE,
        expectedClientId: cimdClientMetadataUrl,
    });
    const userinfo =
        typeof tokenBody?.['access_token'] === 'string' && typeof input.metadata?.['userinfo_endpoint'] === 'string'
            ? await probeJsonWithRetry(
                  input.metadata['userinfo_endpoint'],
                  {
                      method: 'GET',
                      headers: { authorization: `Bearer ${tokenBody['access_token']}`, accept: 'application/json' },
                  },
                  input.runtime,
              )
            : failure('userinfo unavailable');
    const refreshCredential =
        typeof refreshBody?.['refresh_token'] === 'string'
            ? refreshBody['refresh_token']
            : typeof tokenBody?.['refresh_token'] === 'string'
              ? tokenBody['refresh_token']
              : null;
    const cleanup = refreshCredential
        ? await revokeToken(input.metadata, input.resource, cimdClientMetadataUrl, refreshCredential, input.runtime)
        : skippedProbe('No refresh credential was issued.');
    const primaryOk =
        cimdClientMetadata.ok &&
        clientMetadataValidation.ok &&
        token.ok &&
        tokenValidation.ok &&
        refresh.ok &&
        refreshValidation.ok &&
        userinfo.ok;
    return {
        report: {
            ok: primaryOk && cleanup.ok,
            primaryOk,
            advertised: true,
            canonicalForThisIssuer: 'cimd',
            clientMetadata: summarizeClientMetadata(cimdClientMetadata),
            clientMetadataValidation,
            token: summarizeToken(token),
            tokenValidation,
            refreshToken: summarizeToken(refresh),
            refreshTokenValidation: refreshValidation,
            userinfo: summarizeUserinfo(userinfo),
            cleanup: summarizeTokenCleanup(cleanup),
        },
        accessToken: typeof tokenBody?.['access_token'] === 'string' ? tokenBody['access_token'] : null,
    };
}

/**
 * @param {Record<string, unknown> | null} body
 * @param {string} expectedClientId
 * @returns {{ ok: boolean; errors: string[]; warnings: string[] }}
 */
function validateCimdClientMetadata(body, expectedClientId) {
    /** @type {string[]} */
    const errors = [];
    /** @type {string[]} */
    const warnings = [];
    if (!body) {
        errors.push('client metadata document is not a JSON object.');
    } else {
        if (body['client_id'] !== expectedClientId)
            errors.push('client_id does not exactly match the metadata document URL.');
        if (typeof body['client_name'] !== 'string' || !body['client_name']) errors.push('client_name is missing.');
        if (normalizeStringArray(body['redirect_uris']).length === 0) errors.push('redirect_uris is missing or empty.');
        if (!normalizeStringArray(body['response_types']).includes('code'))
            warnings.push('response_types does not explicitly include code.');
        if (!normalizeStringArray(body['grant_types']).includes('authorization_code'))
            warnings.push('grant_types does not explicitly include authorization_code.');
        const tokenEndpointAuthMethod = String(body['token_endpoint_auth_method'] ?? 'none');
        if (!['none', 'private_key_jwt'].includes(tokenEndpointAuthMethod)) {
            errors.push(`token_endpoint_auth_method ${tokenEndpointAuthMethod} is not supported by this smoke.`);
        }
        if (
            tokenEndpointAuthMethod === 'private_key_jwt' &&
            typeof body['jwks_uri'] !== 'string' &&
            !asRecord(body['jwks'])
        ) {
            errors.push('private_key_jwt client metadata must provide jwks_uri or jwks.');
        }
    }
    return { ok: errors.length === 0, errors, warnings };
}

/**
 * @param {{
 *     metadata: Record<string, unknown> | null;
 *     registration: ProbeResult;
 *     resource: string;
 *     runtime: OAuthSmokeRuntimeOptions;
 * }} input
 * @returns {Promise<Record<string, unknown> & { ok: boolean }>}
 */
async function runNegativeResourceChecks(input) {
    if (!input.runtime.runNegativeResourceChecks) return { ok: true, skipped: true, reason: 'disabled' };
    if (!input.registration.ok) return { ok: false, skipped: true, reason: 'registration failed' };
    const registrationBody = asRecord(input.registration.body);
    const clientId = String(registrationBody?.['client_id'] ?? '');
    const redirectUri =
        normalizeStringArray(registrationBody?.['redirect_uris'])[0] ??
        'https://chatgpt.com/connector/oauth/codex-smoke';
    const missingAuthorizeResource = await authorizeAndExchangeClient(
        input.metadata,
        {
            clientId,
            redirectUri,
            resource: input.resource,
            scope: FULL_REPO_SCOPE,
            omitResourceInAuthorize: true,
        },
        input.runtime,
    );
    // If authorization already rejects missing resource, token omission is not needed; this is the preferred strict behavior.
    const missingTokenResource =
        missingAuthorizeResource.ok || /code=/u.test(String(missingAuthorizeResource.error ?? ''))
            ? await authorizeAndExchangeClient(
                  input.metadata,
                  {
                      clientId,
                      redirectUri,
                      resource: input.resource,
                      scope: FULL_REPO_SCOPE,
                      omitResourceInToken: true,
                  },
                  input.runtime,
              )
            : failure('skipped because authorize without resource was rejected as expected');
    return {
        ok: !missingAuthorizeResource.ok && !missingTokenResource.ok,
        missingAuthorizeResource: summarizeNegativeProbe(missingAuthorizeResource),
        missingTokenResource: summarizeNegativeProbe(missingTokenResource),
    };
}

/**
 * @param {ProbeResult} probe
 * @returns {Record<string, unknown>}
 */
function summarizeNegativeProbe(probe) {
    return {
        rejected: !probe.ok,
        status: probe.status ?? null,
        error: probe.error ?? null,
    };
}

/**
 * @param {string} a
 * @param {string} b
 * @param {OAuthSmokeRuntimeOptions} c
 * @returns {Promise<{
 *     modern2026: Awaited<ReturnType<typeof runModernMcpRuntimeChecks>>;
 *     legacy2025Compatibility:
 *         | { enabled: true; protocolVersion: string; runtimeHealth: ProbeResult; authenticatedToolsList: ProbeResult; authenticatedSse: ProbeResult }
 *         | { enabled: false; protocolVersion: string; reason: string };
 * }>}
 */
async function runMcpToolRuntimeChecks(a, b, c) {
    const modernPromise = runModernMcpRuntimeChecks({ mcpUrl: a, accessToken: b, timeoutMs: c.timeoutMs });
    const legacyPromise = c.runLegacyCompatibility ? runLegacyMcpToolRuntimeChecks(a, b, c) : Promise.resolve(null);
    const [modern2026, legacy2025] = await Promise.all([modernPromise, legacyPromise]);
    return {
        modern2026,
        legacy2025Compatibility: legacy2025
            ? { enabled: true, protocolVersion: c.legacyProtocolVersion, ...legacy2025 }
            : {
                  enabled: false,
                  protocolVersion: c.legacyProtocolVersion,
                  reason: 'Legacy 2025 compatibility smoke disabled.',
              },
    };
}

/**
 * Legacy compatibility engine only. Modern 2026 diagnostics must use the official v2 client above instead of this
 * initialize/session/SSE lifecycle.
 *
 * @param {string} a
 * @param {string} b
 * @param {OAuthSmokeRuntimeOptions} c
 */
async function runLegacyMcpToolRuntimeChecks(a, b, c) {
    const [runtimeHealth, authenticatedToolsList, authenticatedSse] = await Promise.all([
        callMcpTool(a, b, 'mcp_runtime_health', c),
        listMcpTools(a, b, c),
        probeMcpSseStatefully(a, b, c),
    ]);
    return { runtimeHealth, authenticatedToolsList, authenticatedSse };
}

/** @param {string} mcpUrl @param {string} accessToken @param {string} toolName @param {OAuthSmokeRuntimeOptions} runtime
  @returns {Promise<ProbeResult>} */
async function callMcpTool(mcpUrl, accessToken, toolName, runtime) {
    return postMcpJsonRpcStatefully(
        mcpUrl,
        accessToken,
        { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: toolName, arguments: {} } },
        runtime,
    );
}

/**
 * @param {string} mcpUrl
 * @param {string} accessToken
 * @param {OAuthSmokeRuntimeOptions} runtime
 * @returns {Promise<ProbeResult>}
 */
async function listMcpTools(mcpUrl, accessToken, runtime) {
    return postMcpJsonRpcStatefully(
        mcpUrl,
        accessToken,
        { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
        runtime,
    );
}

/**
 * @param {string} mcpUrl
 * @param {string} accessToken
 * @param {OAuthSmokeRuntimeOptions} runtime
 * @returns {Promise<ProbeResult>}
 */
async function probeMcpSseStatefully(mcpUrl, accessToken, runtime) {
    const initialize = await probeJsonWithRetry(
        mcpUrl,
        {
            method: 'POST',
            headers: buildMcpAuthorizationHeaders(accessToken, runtime),
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 'oauth-smoke-sse-initialize',
                method: 'initialize',
                params: {
                    protocolVersion: runtime.legacyProtocolVersion,
                    capabilities: {},
                    clientInfo: { name: OAUTH_SMOKE_IMPLEMENTATION_NAME, version: OAUTH_SMOKE_IMPLEMENTATION_VERSION },
                },
            }),
        },
        runtime,
    );
    const sessionId = normalizeMcpSessionId(initialize.headers?.['mcp-session-id']);
    if (!initialize.ok || hasJsonRpcError(initialize.body) || !sessionId) {
        const contentType = String(initialize.headers?.['content-type'] ?? '').toLowerCase();
        const statelessInitializeDetected = initialize.ok && !sessionId && contentType.includes('application/json');
        return {
            ...initialize,
            ok: false,
            error:
                initialize.error ??
                (statelessInitializeDetected
                    ? 'stateless_initialize_detected'
                    : !sessionId
                      ? 'missing Mcp-Session-Id after SSE initialize'
                      : 'SSE initialize failed'),
            body: {
                ...(initialize.body && typeof initialize.body === 'object' && !Array.isArray(initialize.body)
                    ? /** @type {Record<string, unknown>} */ (initialize.body)
                    : { value: initialize.body ?? null }),
                statelessInitializeDetected,
                expectedHeader: 'Mcp-Session-Id',
            },
        };
    }
    const sessionHeaders = { ...buildMcpAuthorizationHeaders(accessToken, runtime), 'mcp-session-id': sessionId };
    const initialized = await probeJsonWithRetry(
        mcpUrl,
        {
            method: 'POST',
            headers: sessionHeaders,
            body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
        },
        runtime,
    );
    if (!initialized.ok || hasJsonRpcError(initialized.body)) {
        await closeMcpStatefulSession(mcpUrl, accessToken, sessionId, runtime);
        return { ...initialized, ok: false, error: initialized.error ?? 'SSE notifications/initialized failed' };
    }
    const headers = {
        authorization: `Bearer ${accessToken}`,
        accept: 'text/event-stream',
        'mcp-session-id': sessionId,
        'mcp-protocol-version': runtime.legacyProtocolVersion,
        'x-copilot-mcp-sdk-sse-probe': '1',
    };
    try {
        const initial = await probeSseHeadersOnce(mcpUrl, { method: 'GET', headers }, runtime);
        const realLastEventIdObserved = typeof initial.lastEventId === 'string' && initial.lastEventId.length > 0;
        const lastEventId =
            typeof initial.lastEventId === 'string' && initial.lastEventId.length > 0
                ? initial.lastEventId
                : `oauth-smoke.${0}.${randomUUID()}`;
        const reconnectHeaders = {
            authorization: headers.authorization,
            accept: headers.accept,
            'mcp-session-id': headers['mcp-session-id'],
            'mcp-protocol-version': headers['mcp-protocol-version'],
            'last-event-id': lastEventId,
            'x-copilot-mcp-sdk-replay-probe': '1',
        };
        const reconnect = await probeSseHeadersOnce(mcpUrl, { method: 'GET', headers: reconnectHeaders }, runtime);
        const envelopeOk = initial.ok && reconnect.ok;
        const diagnosticEnvelopeOnly = isSseDiagnosticProbe(initial) || isSseDiagnosticProbe(reconnect);
        const realReplayCandidate = Boolean(realLastEventIdObserved && reconnect.ok);
        return {
            ok: envelopeOk && !diagnosticEnvelopeOnly,
            durationMs: Number(initial.durationMs ?? 0) + Number(reconnect.durationMs ?? 0),
            responseBytes: Number(initial.responseBytes ?? 0) + Number(reconnect.responseBytes ?? 0),
            body: {
                initial: summarizeSseProbe(initial),
                reconnect: summarizeSseProbe(reconnect),
                envelopeOk,
                diagnosticEnvelopeOnly,
                realLastEventIdObserved,
                realReplayCandidate,
                lastEventIdAccepted: reconnect.ok,
            },
            ...(!envelopeOk || diagnosticEnvelopeOnly
                ? {
                      error:
                          initial.error ??
                          reconnect.error ??
                          (diagnosticEnvelopeOnly
                              ? 'authenticated SSE envelope diagnostic passed; long-lived SDK stream not proven'
                              : 'authenticated SSE reconnect with Last-Event-ID failed'),
                  }
                : {}),
        };
    } finally {
        await closeMcpStatefulSession(mcpUrl, accessToken, sessionId, runtime);
    }
}

/**
 * @param {ProbeResult} probe
 * @returns {boolean}
 */
function isSseDiagnosticProbe(probe) {
    return probe.headers?.['x-copilot-mcp-sse-probe'] === 'ok';
}

/**
 * @param {string} mcpUrl
 * @param {RequestInit} init
 * @param {OAuthSmokeRuntimeOptions} runtime
 * @returns {Promise<ProbeResult>}
 */
async function probeSseHeadersOnce(mcpUrl, init, runtime) {
    const startedAtMs = Date.now();
    try {
        const response = await fetch(mcpUrl, { ...init, signal: AbortSignal.timeout(runtime.timeoutMs) });
        const headers = headersToRecord(response.headers);
        const contentType = headers['content-type'] ?? '';
        const wantsSdkProbe =
            requestInitHasHeader(init, 'x-copilot-mcp-sdk-sse-probe', '1') ||
            requestInitHasHeader(init, 'x-copilot-mcp-sdk-replay-probe', '1');
        const eventProbe = wantsSdkProbe
            ? await readFirstSseChunk(response, runtime)
            : { responseBytes: 0, eventReceived: null, lastEventId: undefined, error: undefined };
        await response.body?.cancel().catch(() => {});
        const ok =
            response.ok &&
            contentType.toLowerCase().includes('text/event-stream') &&
            (!wantsSdkProbe || eventProbe.eventReceived === true);
        return {
            ok,
            status: response.status,
            headers,
            durationMs: Date.now() - startedAtMs,
            responseBytes: eventProbe.responseBytes,
            eventReceived: eventProbe.eventReceived,
            ...(eventProbe.lastEventId ? { lastEventId: eventProbe.lastEventId } : {}),
            ...(ok
                ? {}
                : {
                      error: response.ok
                          ? (eventProbe.error ?? 'SSE SDK probe event was not received.')
                          : `HTTP ${response.status}`,
                  }),
        };
    } catch (error) {
        return {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
            durationMs: Date.now() - startedAtMs,
            transient: true,
        };
    }
}

/**
 * @param {Response} response
 * @param {OAuthSmokeRuntimeOptions} runtime
 * @returns {Promise<{ responseBytes: number; eventReceived: boolean; lastEventId?: string; error?: string }>}
 */
async function readFirstSseChunk(response, runtime) {
    const reader = response.body?.getReader();
    if (!reader) return { responseBytes: 0, eventReceived: false, error: 'SSE response body is unavailable.' };
    try {
        const result = await Promise.race([
            reader.read(),
            new Promise((resolve) =>
                setTimeout(() => resolve({ done: true, value: undefined, timeout: true }), runtime.timeoutMs),
            ),
        ]);
        const chunk = /** @type {{ done?: boolean; value?: Uint8Array; timeout?: boolean }} */ (result);
        if (chunk.timeout) return { responseBytes: 0, eventReceived: false, error: 'SSE SDK probe event timed out.' };
        const responseBytes = chunk.value?.byteLength ?? 0;
        const text = chunk.value ? new TextDecoder().decode(chunk.value) : '';
        const lastEventId = parseSseEventId(text);
        return { responseBytes, eventReceived: responseBytes > 0, ...(lastEventId ? { lastEventId } : {}) };
    } finally {
        await reader.cancel().catch(() => {});
    }
}

/**
 * @param {string} text
 * @returns {string | undefined}
 */
function parseSseEventId(text) {
    for (const line of text.split(/\r?\n/u)) {
        if (line.toLowerCase().startsWith('id:')) {
            const eventId = line.slice(3).trim();
            if (/^[^\s.]+\.\d+\.[0-9a-f-]{36}$/u.test(eventId)) return eventId;
        }
    }
    return undefined;
}

/**
 * @param {RequestInit} init
 * @param {string} name
 * @param {string} expected
 * @returns {boolean}
 */
function requestInitHasHeader(init, name, expected) {
    const needle = name.toLowerCase();
    const headers = init.headers;
    if (!headers || Array.isArray(headers)) return false;
    if (headers instanceof Headers) return headers.get(name) === expected;
    return String(/** @type {Record<string, unknown>} */ (headers)[needle] ?? '') === expected;
}

/**
 * @param {string} mcpUrl
 * @param {string} accessToken
 * @param {Record<string, unknown>} request
 * @param {OAuthSmokeRuntimeOptions} runtime
 * @returns {Promise<ProbeResult>}
 */
async function postMcpJsonRpcStatefully(mcpUrl, accessToken, request, runtime) {
    const initialize = await probeJsonWithRetry(
        mcpUrl,
        {
            method: 'POST',
            headers: buildMcpAuthorizationHeaders(accessToken, runtime),
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 'oauth-smoke-initialize',
                method: 'initialize',
                params: {
                    protocolVersion: runtime.legacyProtocolVersion,
                    capabilities: {},
                    clientInfo: { name: OAUTH_SMOKE_IMPLEMENTATION_NAME, version: OAUTH_SMOKE_IMPLEMENTATION_VERSION },
                },
            }),
        },
        runtime,
    );
    const sessionId = normalizeMcpSessionId(initialize.headers?.['mcp-session-id']);
    if (!initialize.ok || hasJsonRpcError(initialize.body) || !sessionId) {
        return {
            ...initialize,
            ok: false,
            error: initialize.error ?? (!sessionId ? 'missing Mcp-Session-Id after initialize' : 'initialize failed'),
        };
    }

    const sessionHeaders = { ...buildMcpAuthorizationHeaders(accessToken, runtime), 'mcp-session-id': sessionId };
    try {
        const initialized = await probeJsonWithRetry(
            mcpUrl,
            {
                method: 'POST',
                headers: sessionHeaders,
                body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
            },
            runtime,
        );
        if (!initialized.ok || hasJsonRpcError(initialized.body)) {
            return { ...initialized, ok: false, error: initialized.error ?? 'notifications/initialized failed' };
        }

        const response = await probeJsonWithRetry(
            mcpUrl,
            {
                method: 'POST',
                headers: sessionHeaders,
                body: JSON.stringify(request),
            },
            runtime,
        );
        return { ...response, ok: response.ok && !hasJsonRpcError(response.body) };
    } finally {
        await closeMcpStatefulSession(mcpUrl, accessToken, sessionId, runtime);
    }
}

/**
 * @param {string} mcpUrl
 * @param {string} accessToken
 * @param {string} sessionId
 * @param {OAuthSmokeRuntimeOptions} runtime
 * @returns {Promise<void>}
 */
async function closeMcpStatefulSession(mcpUrl, accessToken, sessionId, runtime) {
    const headers = { ...buildMcpAuthorizationHeaders(accessToken, runtime), 'mcp-session-id': sessionId };
    await probeRawWithRetry(mcpUrl, { method: 'DELETE', headers }, runtime);
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeMcpSessionId(value) {
    const normalized = String(value ?? '').trim();
    return /^[\x21-\x7E]{8,256}$/u.test(normalized) ? normalized : '';
}

/**
 * @param {string} accessToken
 * @param {OAuthSmokeRuntimeOptions} runtime
 * @returns {Record<string, string>}
 */
function buildMcpAuthorizationHeaders(accessToken, runtime) {
    return {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': runtime.legacyProtocolVersion,
    };
}

/**
 * @param {string} url
 * @param {RequestInit} init
 * @param {OAuthSmokeRuntimeOptions} runtime
 * @returns {Promise<ProbeResult>}
 */
async function probeJsonWithRetry(url, init, runtime) {
    const raw = await probeRawWithRetry(url, init, runtime);
    const body = typeof raw.body === 'string' ? parseMcpJsonResponseText(raw.body) : raw.body;
    return { ...raw, body };
}

/**
 * Parse regular JSON responses and Streamable HTTP POST responses delivered as SSE event frames. The MCP transport
 * permits either application/json or text/event-stream for POST responses, so smoke diagnostics must normalize both
 * shapes before looking for JSON-RPC result payloads.
 *
 * @param {string} text
 * @returns {unknown}
 */
export function parseMcpJsonResponseText(text) {
    const raw = String(text ?? '');
    if (!raw.trim()) return undefined;
    try {
        return JSON.parse(raw);
    } catch {
        // Continue below: many valid Streamable HTTP POST responses are SSE frames with JSON in data: lines.
    }
    const messages = [];
    for (const block of raw.split(/\r?\n\r?\n/u)) {
        const data = block
            .split(/\r?\n/u)
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trimStart())
            .join('\n')
            .trim();
        if (!data || data === '[DONE]') continue;
        try {
            messages.push(JSON.parse(data));
        } catch {
            // Ignore malformed event payloads and keep scanning subsequent frames.
        }
    }
    if (messages.length === 1) return messages[0];
    if (messages.length > 1) return messages;
    return text;
}

/**
 * @param {string} url
 * @param {RequestInit} init
 * @param {OAuthSmokeRuntimeOptions} runtime
 * @returns {Promise<ProbeResult>}
 */
async function probeRawWithRetry(url, init, runtime) {
    return retryOAuthSmokeOperation(async () => probeRawOnce(url, init, runtime), runtime, isTransientProbe);
}

/**
 * @param {string} url
 * @param {RequestInit} init
 * @param {OAuthSmokeRuntimeOptions} runtime
 * @returns {Promise<ProbeResult>}
 */
async function probeRawOnce(url, init, runtime) {
    const startedAtMs = Date.now();
    try {
        const response = await fetch(url, { ...init, signal: AbortSignal.timeout(runtime.timeoutMs) });
        const text = await readBoundedResponseText(response, {
            maxBytes: MAX_RESPONSE_TEXT_BYTES,
            label: 'OAuth smoke response',
        });
        const headers = headersToRecord(response.headers);
        return {
            ok: response.ok,
            status: response.status,
            body: text,
            headers,
            responseBytes: Buffer.byteLength(text),
            transient: isTransientOAuthSmokeHttpStatus(response.status) || isCloudflareTunnelErrorBody(text),
            durationMs: Date.now() - startedAtMs,
        };
    } catch (error) {
        return {
            ok: false,
            transient: true,
            error: error instanceof Error ? error.message : String(error),
            durationMs: Date.now() - startedAtMs,
        };
    }
}

/** @param {ProbeResult} probe */
function isTransientProbe(probe) {
    return Boolean(!probe.ok && probe.transient);
}

/**
 * @param {string} text
 * @returns {boolean}
 */
function isCloudflareTunnelErrorBody(text) {
    return /Cloudflare Tunnel error|Error\s+1033|cf-error-details/iu.test(text);
}

/**
 * @param {Headers} headers
 * @returns {Record<string, string>}
 */
function headersToRecord(headers) {
    /** @type {Record<string, string>} */
    const output = {};
    for (const [key, value] of headers.entries()) output[key.toLowerCase()] = value;
    return output;
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
 * @returns {string[]}
 */
function normalizeStringArray(value) {
    return Array.isArray(value) ? value.filter((item) => typeof item === 'string' && item.trim()) : [];
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function normalizeScopeList(value) {
    return typeof value === 'string' ? value.split(/\s+/u).filter(Boolean) : normalizeStringArray(value);
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function summarizeJwtClaims(value) {
    const token = typeof value === 'string' && value.length <= MAX_TOKEN_LENGTH ? value : '';
    const payload = token ? decodeJwtPayload(token) : null;
    const header = token ? decodeJwtHeader(token) : null;
    return {
        present: Boolean(token),
        jwtLike: Boolean(payload),
        alg: header?.['alg'] ?? null,
        kid: header?.['kid'] ?? null,
        issuer: payload?.['iss'] ?? null,
        subject: payload?.['sub'] ?? null,
        audience: payload?.['aud'] ?? null,
        resource: payload?.['resource'] ?? null,
        scope: payload?.['scope'] ?? null,
        clientId: payload?.['client_id'] ?? null,
        expiresAt: payload?.['exp'] ?? null,
        issuedAt: payload?.['iat'] ?? null,
    };
}

/**
 * @param {unknown} value
 * @param {{ expectedIssuer: string; expectedResource: string; expectedScopes: string; expectedClientId?: string }} expectations
 * @returns {{ ok: boolean; errors: string[]; warnings: string[]; claims: Record<string, unknown> }}
 */
function validateAccessTokenClaims(value, expectations) {
    const claims = summarizeJwtClaims(value);
    const payload = typeof value === 'string' ? decodeJwtPayload(value) : null;
    /** @type {string[]} */
    const errors = [];
    /** @type {string[]} */
    const warnings = [];
    if (!payload) {
        errors.push('access_token is missing or is not a JWT.');
        return { ok: false, errors, warnings, claims };
    }
    if (payload['iss'] !== expectations.expectedIssuer) errors.push('iss does not match authorization server issuer.');
    const audienceValues = normalizeAudienceClaim(payload['aud']);
    const tokenResource = typeof payload['resource'] === 'string' ? payload['resource'] : '';
    if (!audienceValues.includes(expectations.expectedResource) && tokenResource !== expectations.expectedResource) {
        errors.push('aud/resource does not match the expected MCP resource.');
    }
    const tokenScopes = new Set(normalizeScopeList(payload['scope']));
    for (const scope of expectations.expectedScopes.split(/\s+/u).filter(Boolean)) {
        if (!tokenScopes.has(scope)) errors.push(`missing scope ${scope}.`);
    }
    if (expectations.expectedClientId && payload['client_id'] !== expectations.expectedClientId) {
        warnings.push('client_id claim is absent or does not match the OAuth client id.');
    }
    const now = Math.floor(Date.now() / 1000);
    if (typeof payload['exp'] !== 'number' || payload['exp'] <= now) errors.push('exp is missing or expired.');
    if (typeof payload['iat'] !== 'number' || payload['iat'] > now + 120)
        errors.push('iat is missing or in the future.');
    return { ok: errors.length === 0, errors, warnings, claims };
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function normalizeAudienceClaim(value) {
    if (typeof value === 'string') return [value];
    if (Array.isArray(value)) return value.filter((item) => typeof item === 'string');
    return [];
}

/**
 * @param {string} token
 * @returns {Record<string, unknown> | null}
 */
function decodeJwtHeader(token) {
    const parts = token.split('.');
    if (parts.length !== 3 || !parts[0]) return null;
    try {
        const json = Buffer.from(parts[0].replace(/-/gu, '+').replace(/_/gu, '/'), 'base64').toString('utf8');
        const parsed = JSON.parse(json);
        return asRecord(parsed);
    } catch {
        return null;
    }
}

/**
 * @param {string} token
 * @returns {Record<string, unknown> | null}
 */
function decodeJwtPayload(token) {
    const parts = token.split('.');
    if (parts.length !== 3 || !parts[1]) return null;
    try {
        const json = Buffer.from(parts[1].replace(/-/gu, '+').replace(/_/gu, '/'), 'base64').toString('utf8');
        const parsed = JSON.parse(json);
        return asRecord(parsed);
    } catch {
        return null;
    }
}

/**
 * @param {{
 *     status: number;
 *     location: string;
 *     redirectError: string | null;
 *     responseText: string;
 *     clientId: string;
 *     redirectUri: string;
 *     scope: string;
 *     resource: string;
 * }} details
 * @returns {string}
 */
function buildAuthorizationFailureMessage(details) {
    const bodyExcerpt = details.responseText.replace(/\s+/gu, ' ').trim().slice(0, MAX_SUMMARY_TEXT_LENGTH);
    return [
        'authorization code missing',
        `status=${details.status}`,
        details.redirectError ? `redirect_error=${details.redirectError}` : null,
        details.location ? `location=${details.location.slice(0, MAX_SUMMARY_TEXT_LENGTH)}` : 'location=<none>',
        bodyExcerpt ? `body=${bodyExcerpt}` : null,
        `client_id=${details.clientId.slice(0, 180)}`,
        `redirect_uri=${details.redirectUri}`,
        `scope=${details.scope}`,
        `resource=${details.resource}`,
    ]
        .filter((item) => typeof item === 'string' && item)
        .join('; ');
}

/**
 * @param {string} location
 * @param {string} fallbackBaseUrl
 * @returns {URL | null}
 */
function parseRedirectUrl(location, fallbackBaseUrl) {
    if (!location) return null;
    try {
        return new URL(location, fallbackBaseUrl);
    } catch {
        return null;
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
 * @param {string} error
 * @param {number} [status]
 * @returns {ProbeResult}
 */
function failure(error, status) {
    return { ok: false, ...(status !== undefined ? { status } : {}), error };
}

/** @param {string} reason @returns {ProbeResult} */
function skippedProbe(reason) {
    return { ok: true, skipped: true, error: reason };
}

/**
 * @param {string} hostname
 * @returns {boolean}
 */
function isLoopbackHostname(hostname) {
    const normalized = hostname.toLowerCase().replace(/^\[/u, '').replace(/\]$/u, '').replace(/\.$/u, '');
    return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}
