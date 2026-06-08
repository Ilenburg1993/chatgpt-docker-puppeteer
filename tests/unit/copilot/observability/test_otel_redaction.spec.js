// @ts-check

import assert from 'node:assert/strict';
import { afterEach, describe, it, vi } from 'vitest';

const otelMocks = vi.hoisted(() => {
    const span = {
        setAttribute: vi.fn(),
        setStatus: vi.fn(),
        recordException: vi.fn(),
        end: vi.fn(),
    };
    return {
        span,
        tracer: { startSpan: vi.fn(() => span) },
    };
});

vi.mock('@opentelemetry/sdk-trace-node', () => ({
    NodeTracerProvider: class {
        register() {}
    },
}));

vi.mock('@opentelemetry/api', () => ({
    context: {
        active: () => ({}),
        with: async (/** @type {unknown} */ _ctx, /** @type {() => Promise<unknown>} */ fn) => fn(),
    },
    trace: {
        getTracer: () => otelMocks.tracer,
        setSpan: () => ({}),
    },
}));

describe('observability/otel redaction', () => {
    afterEach(() => {
        vi.clearAllMocks();
        vi.resetModules();
    });

    it('redige atributos extras e erro registrado no span', async () => {
        const { startSpan } = await import('../../../../src/copilot/observability/otel.js');
        const githubToken = 'ghs_abcdefghijklmnopqrstuvwxyz1234567890';
        const byokToken = 'sk-testsecret1234567890';

        await assert.rejects(
            startSpan(
                'sdk.secret.span',
                {
                    extra: {
                        gitHubToken: githubToken,
                        headers: { Authorization: `Bearer ${byokToken}` },
                        tokens: 42,
                    },
                },
                async () => {
                    throw new Error(`provider failed with gitHubToken=${githubToken}`);
                },
            ),
            /provider failed/u,
        );

        const callsText = JSON.stringify([
            otelMocks.span.setAttribute.mock.calls,
            otelMocks.span.setStatus.mock.calls,
            otelMocks.span.recordException.mock.calls.map((call) => String(call[0]?.message ?? call[0])),
        ]);

        assert.equal(callsText.includes(githubToken), false);
        assert.equal(callsText.includes(byokToken), false);
        assert.ok(otelMocks.span.setAttribute.mock.calls.some((call) => call[0] === 'tokens' && call[1] === 42));
        assert.match(callsText, /\[redacted\]/);
    });
});
