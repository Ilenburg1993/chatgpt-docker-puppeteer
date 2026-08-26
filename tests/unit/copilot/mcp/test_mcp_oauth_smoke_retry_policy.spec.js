// @ts-check

import {
    isTransientOAuthSmokeHttpStatus,
    retryOAuthSmokeOperation,
} from '#copilot/testing/mcp/diagnostics/oauth-smoke';
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

describe('MCP OAuth smoke retry policy', () => {
    it('retries a 429 transient failure and preserves the successful attempt count', async () => {
        let calls = 0;
        const result = await retryOAuthSmokeOperation(
            async () => {
                calls += 1;
                return calls === 1
                    ? { ok: false, status: 429, transient: isTransientOAuthSmokeHttpStatus(429) }
                    : { ok: true, status: 200, transient: false };
            },
            { retryAttempts: 3, retryBaseDelayMs: 0, retryMaxDelayMs: 0 },
            (probe) => probe.ok === false && probe.transient === true,
        );
        assert.equal(calls, 2);
        assert.equal(result.ok, true);
        assert.equal(result.status, 200);
        assert.equal(result.attempts, 2);
    });

    it('does not retry a non-transient 4xx failure', async () => {
        let calls = 0;
        const result = await retryOAuthSmokeOperation(
            async () => {
                calls += 1;
                return { ok: false, status: 400, transient: isTransientOAuthSmokeHttpStatus(400) };
            },
            { retryAttempts: 3, retryBaseDelayMs: 0, retryMaxDelayMs: 0 },
            (probe) => probe.ok === false && probe.transient === true,
        );
        assert.equal(calls, 1);
        assert.equal(result.status, 400);
        assert.equal(result.attempts, 1);
    });
});
