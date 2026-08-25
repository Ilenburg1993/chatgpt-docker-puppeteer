// @ts-check
/** Generation-owned anonymous MCP HTTP rate limiter. */

import { parseBearerToken } from '#copilot/mcp/public/auth';
import { logMcp } from '#copilot/mcp/public/observability';
import { buildAnonymousRateLimitKey, readHeader } from './request-identity.js';

/** @typedef {import('node:http').IncomingMessage | import('node:http2').Http2ServerRequest} McpHttpRequest */

/**
 * @param {ReturnType<typeof import('./config.js').readMcpAnonymousRateLimitPolicy>} policy
 * @param {ReturnType<typeof import('./config.js').readMcpHttpRequestPolicy>['proxy']} proxyPolicy
 */
export function createMcpAnonymousRateLimiter(policy, proxyPolicy) {
    /** @type {Map<string, { windowStartMs: number; count: number }>} */
    const buckets = new Map();

    /** @param {McpHttpRequest} req */
    function consume(req) {
        if (!policy.enabled) return { allowed: /** @type {const} */ (true), retryAfterSeconds: 0 };
        if (parseBearerToken(readHeader(req, 'authorization'))) {
            return { allowed: /** @type {const} */ (true), retryAfterSeconds: 0 };
        }
        const nowMs = Date.now();
        const key = buildAnonymousRateLimitKey(req, proxyPolicy);
        const existing = buckets.get(key);
        if (!existing || nowMs - existing.windowStartMs >= policy.windowMs) {
            if (existing) buckets.delete(key);
            buckets.set(key, { windowStartMs: nowMs, count: 1 });
            sweepAnonymousRateLimitBuckets(buckets, nowMs, policy);
            return { allowed: /** @type {const} */ (true), retryAfterSeconds: 0 };
        }
        if (existing.count >= policy.requestsPerWindow) {
            const retryAfterSeconds = Math.max(
                1,
                Math.ceil((policy.windowMs - (nowMs - existing.windowStartMs)) / 1000),
            );
            logMcp('WARN', 'Anonymous MCP request rate limit exceeded.', {
                retryAfterSeconds,
                windowMs: policy.windowMs,
                requestsPerWindow: policy.requestsPerWindow,
            });
            return { allowed: /** @type {const} */ (false), retryAfterSeconds };
        }
        existing.count += 1;
        return { allowed: /** @type {const} */ (true), retryAfterSeconds: 0 };
    }

    return Object.freeze({
        consume,
        reset: () => buckets.clear(),
        snapshot: () => Object.freeze({ activeBuckets: buckets.size, maxBuckets: policy.maxBuckets }),
    });
}

/**
 * Pure bounded-cache eviction primitive, exported privately for white-box tests.
 * @param {Map<string, { windowStartMs: number; count: number }>} buckets
 * @param {number} nowMs
 * @param {{ windowMs: number; maxBuckets: number }} policy
 */
export function sweepAnonymousRateLimitBuckets(buckets, nowMs, policy) {
    if (buckets.size <= policy.maxBuckets) return;
    for (const [key, bucket] of buckets) {
        if (nowMs - bucket.windowStartMs >= policy.windowMs) buckets.delete(key);
    }
    while (buckets.size > policy.maxBuckets) {
        const oldestKey = buckets.keys().next().value;
        if (typeof oldestKey !== 'string') break;
        buckets.delete(oldestKey);
    }
}
