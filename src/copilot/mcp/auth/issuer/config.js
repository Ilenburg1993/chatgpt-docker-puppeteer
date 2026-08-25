// @ts-check
/**
 * Immutable process configuration for the built-in development OAuth issuer.
 *
 * All ambient environment parsing for the issuer is centralized here. The issuer runtime consumes this normalized
 * projection so one process/listener generation cannot drift between metadata, token, persistence, DPoP, rate-limit,
 * proxy-trust and CORS decisions.
 *
 * @module copilot/mcp/auth/issuer/config
 */

export const DEV_OAUTH_PROCESS_CONFIG_SCHEMA_VERSION = 1;
export const DEV_OAUTH_PROCESS_CONFIG_KIND = 'copilot-mcp-dev-oauth-process-config';

export const DEV_OAUTH_CONFIG_DEFAULTS = Object.freeze({
    accessTokenTtlSeconds: 60 * 60,
    refreshTokenTtlSeconds: 7 * 24 * 60 * 60,
    clientTtlSeconds: 30 * 24 * 60 * 60,
    keyFile: 'src/copilot/.ai/mcp/oauth-dev-private-key.pem',
    es256KeyFile: 'src/copilot/.ai/mcp/oauth-dev-es256-private-key.pem',
    signingAlgorithm: /** @type {const} */ ('ES256'),
    refreshTokenFile: 'src/copilot/.ai/mcp/oauth-refresh-tokens.json',
    clientFile: 'src/copilot/.ai/mcp/oauth-clients.json',
    requestBudgetWindowMs: 60 * 1000,
});

export const DEV_OAUTH_REQUEST_BUDGET_DEFAULTS = Object.freeze({
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
});

/**
 * @typedef {'always' | 'never' | 'loopback'} DevOAuthCloudflareHeaderTrust
 *
 * @typedef {Readonly<{
 *     schemaVersion: 1;
 *     kind: 'copilot-mcp-dev-oauth-process-config';
 *     enabled: boolean;
 *     allowHttpLocalhost: boolean;
 *     cimdEnabled: boolean;
 *     diagnosticsEnabled: boolean;
 *     resourceParameterRequired: boolean;
 *     dpop: Readonly<{ enabled: boolean; nonceRequired: boolean; typRequired: boolean }>;
 *     introspectionClientAuthenticationRequired: boolean;
 *     signing: Readonly<{
 *         algorithm: 'ES256' | 'RS256';
 *         includeLegacyRs256: boolean;
 *         keyRotationRequested: boolean;
 *         keyFiles: Readonly<{ ES256: string; RS256: string }>;
 *     }>;
 *     lifetimes: Readonly<{
 *         accessTokenTtlSeconds: number;
 *         refreshTokenTtlSeconds: number;
 *         clientTtlSeconds: number;
 *     }>;
 *     persistence: Readonly<{
 *         refreshTokenFile: string;
 *         clientFile: string;
 *         persistenceEnabled: true;
 *     }>;
 *     rateLimit: Readonly<{
 *         windowMs: number;
 *         limits: Readonly<Record<string, number>>;
 *     }>;
 *     proxyTrust: Readonly<{
 *         cloudflareHeaders: DevOAuthCloudflareHeaderTrust;
 *         xForwardedFor: boolean;
 *     }>;
 *     trustedClients: Readonly<{
 *         chatGptCimdFallback: boolean;
 *         chatGptCimdFastPath: boolean;
 *         claudeCimdFallback: boolean;
 *     }>;
 *     corsOrigin: string | null;
 *     storageConfigKey: string;
 *     persistenceConfigKey: string;
 * }>} DevOAuthProcessConfig
 */

/**
 * Capture one immutable issuer configuration generation.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {DevOAuthProcessConfig}
 */
export function readDevOAuthProcessConfig(env = process.env) {
    const keyFiles = Object.freeze({
        ES256: readNonEmpty(env['COPILOT_MCP_DEV_OAUTH_ES256_KEY_FILE'], DEV_OAUTH_CONFIG_DEFAULTS.es256KeyFile),
        RS256: readNonEmpty(env['COPILOT_MCP_DEV_OAUTH_KEY_FILE'], DEV_OAUTH_CONFIG_DEFAULTS.keyFile),
    });
    const persistence = Object.freeze({
        refreshTokenFile: readNonEmpty(
            env['COPILOT_MCP_DEV_OAUTH_REFRESH_TOKEN_FILE'],
            DEV_OAUTH_CONFIG_DEFAULTS.refreshTokenFile,
        ),
        clientFile: readNonEmpty(env['COPILOT_MCP_DEV_OAUTH_CLIENT_FILE'], DEV_OAUTH_CONFIG_DEFAULTS.clientFile),
        persistenceEnabled: /** @type {const} */ (true),
    });
    const limits = Object.freeze(
        Object.fromEntries(
            Object.entries(DEV_OAUTH_REQUEST_BUDGET_DEFAULTS).map(([name, fallback]) => [
                name,
                readPositiveInteger(
                    env[`COPILOT_MCP_DEV_OAUTH_RATE_LIMIT_${name.toUpperCase()}_PER_WINDOW`],
                    fallback,
                    1,
                ),
            ]),
        ),
    );
    const persistenceConfigKey = `${persistence.refreshTokenFile}\n${persistence.clientFile}`;
    const cloudflareHeaders = normalizeCloudflareHeaderTrust(env['COPILOT_MCP_DEV_OAUTH_TRUST_CLOUDFLARE_HEADERS']);

    return Object.freeze({
        schemaVersion: DEV_OAUTH_PROCESS_CONFIG_SCHEMA_VERSION,
        kind: DEV_OAUTH_PROCESS_CONFIG_KIND,
        enabled: readBoolean(env['COPILOT_MCP_DEV_OAUTH_ENABLED'], true),
        allowHttpLocalhost: readBoolean(env['COPILOT_MCP_DEV_OAUTH_ALLOW_HTTP_LOCALHOST'], true),
        cimdEnabled: readBoolean(env['COPILOT_MCP_DEV_OAUTH_CIMD_ENABLED'], true),
        diagnosticsEnabled: readBoolean(env['COPILOT_MCP_DEV_OAUTH_DIAGNOSTICS_ENABLED'], false),
        resourceParameterRequired: readBoolean(env['COPILOT_MCP_DEV_OAUTH_REQUIRE_RESOURCE_PARAMETER'], true),
        dpop: Object.freeze({
            enabled: readBoolean(env['COPILOT_MCP_DEV_OAUTH_DPOP_ENABLED'], true),
            nonceRequired: readBoolean(env['COPILOT_MCP_DEV_OAUTH_REQUIRE_DPOP_NONCE'], true),
            typRequired: readBoolean(env['COPILOT_MCP_DEV_OAUTH_REQUIRE_DPOP_TYP'], false),
        }),
        introspectionClientAuthenticationRequired: readBoolean(
            env['COPILOT_MCP_DEV_OAUTH_INTROSPECTION_AUTH_REQUIRED'],
            true,
        ),
        signing: Object.freeze({
            algorithm: normalizeSigningAlgorithm(env['COPILOT_MCP_DEV_OAUTH_SIGNING_ALG']),
            includeLegacyRs256: readBoolean(env['COPILOT_MCP_DEV_OAUTH_JWKS_INCLUDE_LEGACY_RS256'], true),
            keyRotationRequested: readBoolean(env['COPILOT_MCP_DEV_OAUTH_ROTATE_KEY'], false),
            keyFiles,
        }),
        lifetimes: Object.freeze({
            accessTokenTtlSeconds: readPositiveInteger(
                env['COPILOT_MCP_DEV_OAUTH_ACCESS_TOKEN_TTL_SECONDS'],
                DEV_OAUTH_CONFIG_DEFAULTS.accessTokenTtlSeconds,
                60,
            ),
            refreshTokenTtlSeconds: readPositiveInteger(
                env['COPILOT_MCP_DEV_OAUTH_REFRESH_TOKEN_TTL_SECONDS'],
                DEV_OAUTH_CONFIG_DEFAULTS.refreshTokenTtlSeconds,
                60 * 60,
            ),
            clientTtlSeconds: readPositiveInteger(
                env['COPILOT_MCP_DEV_OAUTH_CLIENT_TTL_SECONDS'],
                DEV_OAUTH_CONFIG_DEFAULTS.clientTtlSeconds,
                60 * 60,
            ),
        }),
        persistence,
        rateLimit: Object.freeze({
            windowMs:
                readPositiveInteger(
                    env['COPILOT_MCP_DEV_OAUTH_RATE_LIMIT_WINDOW_SECONDS'],
                    Math.floor(DEV_OAUTH_CONFIG_DEFAULTS.requestBudgetWindowMs / 1000),
                    1,
                ) * 1000,
            limits,
        }),
        proxyTrust: Object.freeze({
            cloudflareHeaders,
            xForwardedFor: readBoolean(env['COPILOT_MCP_DEV_OAUTH_TRUST_X_FORWARDED_FOR'], false),
        }),
        trustedClients: Object.freeze({
            chatGptCimdFallback: readBoolean(env['COPILOT_MCP_DEV_OAUTH_TRUST_CHATGPT_CIMD_FALLBACK'], true),
            chatGptCimdFastPath: readBoolean(env['COPILOT_MCP_DEV_OAUTH_CHATGPT_CIMD_FAST_PATH'], true),
            claudeCimdFallback: readBoolean(env['COPILOT_MCP_DEV_OAUTH_TRUST_CLAUDE_CIMD_FALLBACK'], true),
        }),
        corsOrigin: normalizeCorsOrigin(env['COPILOT_MCP_DEV_OAUTH_CORS_ORIGIN']),
        storageConfigKey: `${keyFiles.ES256}\n${keyFiles.RS256}\n${persistenceConfigKey}`,
        persistenceConfigKey,
    });
}

/**
 * Accept an already normalized generation or an explicit synthetic environment for compatibility tests.
 *
 * @param {DevOAuthProcessConfig | NodeJS.ProcessEnv | undefined} [input]
 * @returns {DevOAuthProcessConfig}
 */
export function resolveDevOAuthProcessConfig(input = undefined) {
    if (isDevOAuthProcessConfig(input)) return input;
    return readDevOAuthProcessConfig(input);
}

/** @param {unknown} value @returns {value is DevOAuthProcessConfig} */
export function isDevOAuthProcessConfig(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const record = /** @type {Record<string, unknown>} */ (value);
    return (
        record['schemaVersion'] === DEV_OAUTH_PROCESS_CONFIG_SCHEMA_VERSION &&
        record['kind'] === DEV_OAUTH_PROCESS_CONFIG_KIND
    );
}

/** @param {unknown} value @param {boolean} fallback */
function readBoolean(value, fallback) {
    const raw = String(value ?? '')
        .trim()
        .toLowerCase();
    if (!raw) return fallback;
    if (raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on') return true;
    if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'off') return false;
    return fallback;
}

/** @param {unknown} value @param {number} fallback @param {number} minimum */
function readPositiveInteger(value, fallback, minimum) {
    const parsed = Number(value ?? fallback);
    return Number.isFinite(parsed) && parsed >= minimum ? Math.floor(parsed) : fallback;
}

/** @param {unknown} value @param {string} fallback */
function readNonEmpty(value, fallback) {
    return String(value ?? fallback).trim() || fallback;
}

/** @param {unknown} value @returns {'ES256' | 'RS256'} */
function normalizeSigningAlgorithm(value) {
    return String(value ?? DEV_OAUTH_CONFIG_DEFAULTS.signingAlgorithm)
        .trim()
        .toUpperCase() === 'RS256'
        ? 'RS256'
        : 'ES256';
}

/** @param {unknown} value @returns {DevOAuthCloudflareHeaderTrust} */
function normalizeCloudflareHeaderTrust(value) {
    const raw = String(value ?? 'loopback')
        .trim()
        .toLowerCase();
    if (raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on' || raw === 'always') return 'always';
    if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'off' || raw === 'never') return 'never';
    return 'loopback';
}

/** @param {unknown} value @returns {string | null} */
function normalizeCorsOrigin(value) {
    const raw = String(value ?? '*').trim();
    if (!raw || raw.toLowerCase() === 'off' || raw.toLowerCase() === 'false') return null;
    if (raw.length > 256 || hasControlCharacters(raw)) return '*';
    return raw;
}

/** @param {string} value */
function hasControlCharacters(value) {
    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        if (code <= 31 || code === 127) return true;
    }
    return false;
}
