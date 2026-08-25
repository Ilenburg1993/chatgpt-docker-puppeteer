// @ts-check

import {
    buildAnonymousRateLimitKey,
    createMcpAnonymousRateLimiter,
    firstForwardedProto,
    sweepAnonymousRateLimitBuckets,
} from '#copilot/testing/mcp/adapters/http';
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

const LOOPBACK_PROXY_POLICY = Object.freeze({
    trustProxyHeaders: /** @type {const} */ ('loopback'),
    trustXForwardedFor: false,
});

/** @param {string} remoteAddress @param {Record<string, string>} [headers] */
function request(remoteAddress, headers = {}) {
    return /** @type {any} */ ({ headers, socket: { remoteAddress } });
}

describe('MCP HTTP proxy trust', () => {
    it('ignores spoofed forwarding headers from an untrusted peer', () => {
        const direct = request('203.0.113.10');
        const spoofed = request('203.0.113.10', {
            'cf-connecting-ip': '198.51.100.7',
            'x-forwarded-for': '198.51.100.8',
            'x-forwarded-proto': 'https',
        });

        assert.equal(
            buildAnonymousRateLimitKey(spoofed, LOOPBACK_PROXY_POLICY),
            buildAnonymousRateLimitKey(direct, LOOPBACK_PROXY_POLICY),
        );
        assert.equal(firstForwardedProto(spoofed, LOOPBACK_PROXY_POLICY), undefined);
    });

    it('trusts Cloudflare identity from the loopback tunnel peer', () => {
        const first = request('127.0.0.1', { 'cf-connecting-ip': '198.51.100.7' });
        const second = request('127.0.0.1', { 'cf-connecting-ip': '198.51.100.8' });
        assert.notEqual(
            buildAnonymousRateLimitKey(first, LOOPBACK_PROXY_POLICY),
            buildAnonymousRateLimitKey(second, LOOPBACK_PROXY_POLICY),
        );
    });

    it('requires an explicit policy before trusting X-Forwarded-For', () => {
        const peer = request('127.0.0.1');
        const forwarded = request('127.0.0.1', { 'x-forwarded-for': '198.51.100.8' });
        assert.equal(
            buildAnonymousRateLimitKey(peer, LOOPBACK_PROXY_POLICY),
            buildAnonymousRateLimitKey(forwarded, LOOPBACK_PROXY_POLICY),
        );
        const forwardedPolicy = Object.freeze({ ...LOOPBACK_PROXY_POLICY, trustXForwardedFor: true });
        assert.notEqual(
            buildAnonymousRateLimitKey(peer, forwardedPolicy),
            buildAnonymousRateLimitKey(forwarded, forwardedPolicy),
        );
    });

    it('enforces maxBuckets even when every bucket is still inside the window', () => {
        const buckets = new Map([
            ['oldest', { windowStartMs: 1, count: 1 }],
            ['middle', { windowStartMs: 2, count: 1 }],
            ['newest', { windowStartMs: 3, count: 1 }],
        ]);
        sweepAnonymousRateLimitBuckets(buckets, 10, { windowMs: 100, maxBuckets: 2 });
        assert.deepEqual([...buckets.keys()], ['middle', 'newest']);
    });

    it('prefers removing expired buckets before evicting active identities', () => {
        const buckets = new Map([
            ['expired', { windowStartMs: 1, count: 1 }],
            ['active-a', { windowStartMs: 8, count: 1 }],
            ['active-b', { windowStartMs: 9, count: 1 }],
        ]);
        sweepAnonymousRateLimitBuckets(buckets, 10, { windowMs: 5, maxBuckets: 2 });
        assert.deepEqual([...buckets.keys()], ['active-a', 'active-b']);
    });
});

describe('MCP HTTP anonymous rate limiter ownership', () => {
    it('keeps buckets isolated per listener generation', () => {
        const policy = Object.freeze({ enabled: true, windowMs: 10_000, requestsPerWindow: 1, maxBuckets: 16 });
        const first = createMcpAnonymousRateLimiter(policy, LOOPBACK_PROXY_POLICY);
        const second = createMcpAnonymousRateLimiter(policy, LOOPBACK_PROXY_POLICY);
        const req = request('203.0.113.10');

        assert.equal(first.consume(req).allowed, true);
        assert.equal(first.consume(req).allowed, false);
        assert.equal(first.snapshot().activeBuckets, 1);
        assert.equal(second.snapshot().activeBuckets, 0);
        assert.equal(second.consume(req).allowed, true);
        assert.equal(second.snapshot().activeBuckets, 1);

        first.reset();
        assert.equal(first.snapshot().activeBuckets, 0);
        assert.equal(second.snapshot().activeBuckets, 1);
    });
});
