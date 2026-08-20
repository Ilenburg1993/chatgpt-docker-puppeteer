// @ts-check

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { mcpHttpSharedTestHarness } from '../../../../src/copilot/mcp/adapters/http-shared.js';

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
            mcpHttpSharedTestHarness.buildAnonymousRateLimitKey(spoofed),
            mcpHttpSharedTestHarness.buildAnonymousRateLimitKey(direct),
        );
        assert.equal(mcpHttpSharedTestHarness.firstForwardedProto(spoofed), undefined);
    });

    it('trusts Cloudflare identity from the loopback tunnel peer', () => {
        const first = request('127.0.0.1', { 'cf-connecting-ip': '198.51.100.7' });
        const second = request('127.0.0.1', { 'cf-connecting-ip': '198.51.100.8' });
        assert.notEqual(
            mcpHttpSharedTestHarness.buildAnonymousRateLimitKey(first),
            mcpHttpSharedTestHarness.buildAnonymousRateLimitKey(second),
        );
    });

    it('requires a separate opt-in before trusting X-Forwarded-For', () => {
        const oldValue = process.env['COPILOT_MCP_HTTP_TRUST_X_FORWARDED_FOR'];
        try {
            delete process.env['COPILOT_MCP_HTTP_TRUST_X_FORWARDED_FOR'];
            const peer = request('127.0.0.1');
            const forwarded = request('127.0.0.1', { 'x-forwarded-for': '198.51.100.8' });
            assert.equal(
                mcpHttpSharedTestHarness.buildAnonymousRateLimitKey(peer),
                mcpHttpSharedTestHarness.buildAnonymousRateLimitKey(forwarded),
            );

            process.env['COPILOT_MCP_HTTP_TRUST_X_FORWARDED_FOR'] = 'true';
            assert.notEqual(
                mcpHttpSharedTestHarness.buildAnonymousRateLimitKey(peer),
                mcpHttpSharedTestHarness.buildAnonymousRateLimitKey(forwarded),
            );
        } finally {
            if (oldValue === undefined) delete process.env['COPILOT_MCP_HTTP_TRUST_X_FORWARDED_FOR'];
            else process.env['COPILOT_MCP_HTTP_TRUST_X_FORWARDED_FOR'] = oldValue;
        }
    });

    it('enforces maxBuckets even when every bucket is still inside the window', () => {
        const harness = mcpHttpSharedTestHarness;
        harness.resetAnonymousRateLimitBuckets();
        try {
            harness.seedAnonymousRateLimitBucket('oldest', 1);
            harness.seedAnonymousRateLimitBucket('middle', 2);
            harness.seedAnonymousRateLimitBucket('newest', 3);

            harness.sweepAnonymousRateLimitBuckets(10, { windowMs: 100, maxBuckets: 2 });

            assert.deepEqual(harness.snapshotAnonymousRateLimitBuckets(), {
                keys: ['middle', 'newest'],
                size: 2,
            });
        } finally {
            harness.resetAnonymousRateLimitBuckets();
        }
    });

    it('prefers removing expired buckets before evicting active identities', () => {
        const harness = mcpHttpSharedTestHarness;
        harness.resetAnonymousRateLimitBuckets();
        try {
            harness.seedAnonymousRateLimitBucket('expired', 1);
            harness.seedAnonymousRateLimitBucket('active-a', 8);
            harness.seedAnonymousRateLimitBucket('active-b', 9);

            harness.sweepAnonymousRateLimitBuckets(10, { windowMs: 5, maxBuckets: 2 });

            assert.deepEqual(harness.snapshotAnonymousRateLimitBuckets(), {
                keys: ['active-a', 'active-b'],
                size: 2,
            });
        } finally {
            harness.resetAnonymousRateLimitBuckets();
        }
    });
});
