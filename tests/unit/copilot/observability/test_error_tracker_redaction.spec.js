// @ts-check

import assert from 'node:assert/strict';
import { describe, it, vi } from 'vitest';

vi.mock('#copilot/observability/logger', () => ({
    log: vi.fn(),
}));

describe('observability/error-tracker redaction', () => {
    it('redige mensagens, stack e metadata em snapshots consultáveis', async () => {
        const { createErrorTracker } = await import('../../../../src/copilot/observability/error-tracker.js');
        const tracker = createErrorTracker();
        const githubToken = 'ghs_abcdefghijklmnopqrstuvwxyz1234567890';
        const byokToken = 'sk-testsecret1234567890';

        const error = new Error(`provider failed with gitHubToken=${githubToken}`);
        error.stack = `Error: provider failed\nAuthorization: Bearer ${byokToken}`;

        tracker.trackError(error, {
            source: `sdk:${githubToken}`,
            sessionId: githubToken,
            toolName: `tool-${byokToken}`,
            metadata: {
                gitHubToken: githubToken,
                headers: { Authorization: `Bearer ${byokToken}` },
                tokens: 42,
            },
        });

        const errors = tracker.getErrors(1);
        const stats = tracker.getStats();
        const serialized = JSON.stringify({ errors, stats });

        assert.equal(serialized.includes(githubToken), false);
        assert.equal(serialized.includes(byokToken), false);
        assert.match(serialized, /\[redacted\]/);
        assert.equal(errors[0]?.metadata?.['tokens'], 42);
        assert.equal(stats.last?.metadata?.['tokens'], 42);
    });
});
