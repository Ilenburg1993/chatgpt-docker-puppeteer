// @ts-check
/**
 * Positive authorization decision cache for MCP OAuth hot paths.
 *
 * Only successful OAuth/JWKS decisions are retained. Failures are never cached. DPoP-bound requests are bypassed to
 * preserve replay checks.
 *
 * @module copilot/mcp/auth/resource-server/decision-cache
 */

import { createHash } from 'node:crypto';

const DEFAULT_TTL_MS = 300 * 1000;
const MAX_TTL_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 4096;
const EXPIRY_SKEW_MS = 5 * 1000;

/** @typedef {Readonly<{ disabled: boolean; ttlMs: number }>} McpAuthDecisionCachePolicy */

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {McpAuthDecisionCachePolicy}
 */
export function readMcpAuthDecisionCachePolicy(env = process.env) {
    return Object.freeze({
        disabled: env['COPILOT_MCP_AUTH_DECISION_CACHE_DISABLED'] === 'true',
        ttlMs: readPositiveMs(env['COPILOT_MCP_AUTH_DECISION_CACHE_TTL_MS'], DEFAULT_TTL_MS, MAX_TTL_MS),
    });
}

/** @type {Map<
    string,
    { decision: import('./service.js').McpAuthorizationDecision; expiresAt: number; cachedAt: number }
>} */
const cache = new Map();
const stats = {
    hits: 0,
    misses: 0,
    sets: 0,
    bypasses: 0,
    evictions: 0,
    clears: 0,
};

/**
 * @param {string} value
 * @returns {string}
 */
function sha256Hex(value) {
    return createHash('sha256').update(value).digest('hex');
}

/**
 * @param {unknown} value
 * @param {number} fallback
 * @param {number} max
 * @returns {number}
 */
function readPositiveMs(value, fallback, max) {
    const parsed = Number(value ?? fallback);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.min(max, Math.floor(parsed));
}

/**
 * @param {Record<string, string | string[] | undefined> | undefined} headers
 * @param {string} name
 * @returns {string}
 */
function firstHeader(headers, name) {
    if (!headers) return '';
    const wanted = name.toLowerCase();
    for (const [key, value] of Object.entries(headers)) {
        if (key.toLowerCase() !== wanted) continue;
        if (Array.isArray(value)) return String(value[0] ?? '');
        return String(value ?? '');
    }
    return '';
}

/**
 * @param {import('./service.js').McpAuthConfig} config
 * @returns {string}
 */
function configFingerprint(config) {
    return sha256Hex(
        JSON.stringify({
            implementationVersion: config.implementationVersion,
            enforcement: config.enforcement,
            expectedIssuer: config.expectedIssuer,
            expectedAudience: config.expectedAudience,
            acceptedAudiences: config.acceptedAudiences,
            jwksUri: config.jwksUri,
            jwtAlgorithms: config.jwtAlgorithms,
            requireResourceClaim: config.requireResourceClaim,
        }),
    );
}

/**
 * @param {string} credential
 * @param {import('./service.js').McpAuthScope[]} requiredScopes
 * @param {import('./service.js').McpAuthConfig} config
 * @returns {string}
 */
function cacheKey(credential, requiredScopes, config) {
    return sha256Hex(
        JSON.stringify({
            credential: sha256Hex(credential),
            scopes: [...requiredScopes].sort().join(' '),
            config: configFingerprint(config),
        }),
    );
}

/**
 * @param {import('./service.js').McpAuthContext | undefined} context
 * @returns {boolean}
 */
function shouldBypassContext(context) {
    return firstHeader(context?.headers, 'dpop') !== '';
}

/**
 * @param {string} credential
 * @param {import('./service.js').McpAuthScope[]} requiredScopes
 * @param {import('./service.js').McpAuthConfig} config
 * @param {import('./service.js').McpAuthContext | undefined} context
 * @returns {import('./service.js').McpAuthorizationDecision | null}
 */
export function readCachedMcpAuthorizationDecision(
    credential,
    requiredScopes,
    config,
    context,
    policy = readMcpAuthDecisionCachePolicy(),
) {
    if (policy.disabled || shouldBypassContext(context)) {
        stats.bypasses += 1;
        return null;
    }
    const key = cacheKey(credential, requiredScopes, config);
    const entry = cache.get(key);
    const now = Date.now();
    if (!entry) {
        stats.misses += 1;
        return null;
    }
    if (entry.expiresAt <= now) {
        cache.delete(key);
        stats.evictions += 1;
        stats.misses += 1;
        return null;
    }
    cache.delete(key);
    cache.set(key, entry);
    stats.hits += 1;
    return { ...entry.decision, requiredScopes: [...entry.decision.requiredScopes] };
}

/**
 * @param {string} credential
 * @param {import('./service.js').McpAuthScope[]} requiredScopes
 * @param {import('./service.js').McpAuthConfig} config
 * @param {import('./service.js').McpAuthContext | undefined} context
 * @param {import('jose').JWTPayload} payload
 * @param {import('./service.js').McpAuthorizationDecision} decision
 * @returns {void}
 */
export function rememberMcpAuthorizationDecision(
    credential,
    requiredScopes,
    config,
    context,
    payload,
    decision,
    policy = readMcpAuthDecisionCachePolicy(),
) {
    if (policy.disabled) return;
    if (!decision.allowed || decision.method !== 'oauth-jwks') return;
    if (shouldBypassContext(context)) {
        stats.bypasses += 1;
        return;
    }
    const cnf = payload['cnf'];
    if (cnf && typeof cnf === 'object') {
        stats.bypasses += 1;
        return;
    }
    const ttlMs = policy.ttlMs;
    const expMs = Number(payload.exp) > 0 ? Number(payload.exp) * 1000 : Date.now() + ttlMs;
    const expiresAt = Math.min(Date.now() + ttlMs, expMs - EXPIRY_SKEW_MS);
    if (expiresAt <= Date.now()) return;
    cache.set(cacheKey(credential, requiredScopes, config), {
        decision: { ...decision, requiredScopes: [...decision.requiredScopes] },
        expiresAt,
        cachedAt: Date.now(),
    });
    stats.sets += 1;
    while (cache.size > MAX_ENTRIES) {
        const oldestKey = cache.keys().next().value;
        if (typeof oldestKey !== 'string') break;
        cache.delete(oldestKey);
        stats.evictions += 1;
    }
}

/**
 * @returns {Record<string, unknown>}
 */
export function getMcpAuthDecisionCacheStats(policy = readMcpAuthDecisionCachePolicy()) {
    return {
        ...stats,
        size: cache.size,
        maxEntries: MAX_ENTRIES,
        defaultTtlMs: DEFAULT_TTL_MS,
        maxTtlMs: MAX_TTL_MS,
        disabled: policy.disabled,
        configuredTtlMs: policy.ttlMs,
    };
}

/**
 * @returns {void}
 */
export function resetMcpAuthDecisionCache() {
    cache.clear();
    stats.hits = 0;
    stats.misses = 0;
    stats.sets = 0;
    stats.bypasses = 0;
    stats.evictions = 0;
    stats.clears += 1;
}
