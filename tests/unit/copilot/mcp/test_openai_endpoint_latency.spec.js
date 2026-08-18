// @ts-check

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import {
    buildOpenAiEndpointLatencySnapshot,
    compareOpenAiEndpointLatencyToBaseline,
    summarizeNumbers,
    summarizeOpenAiEndpointLatencyHistory,
} from '#copilot/mcp/control-plane';

function sample(id, hostname, ttfbMs, totalMs, tlsMs = 20) {
    return {
        id,
        hostname,
        method: 'HEAD',
        ok: true,
        observedAt: '2026-08-18T21:00:00.000Z',
        statusCode: 200,
        protocol: 'HTTP/1.1',
        alpn: 'http/1.1',
        remoteFamily: 'IPv4',
        edgeColo: 'GRU',
        timings: {
            dnsMs: 5,
            tcpMs: 10,
            tlsMs,
            ttfbMs,
            serverWaitMs: Math.max(0, ttfbMs - 35),
            bodyMs: 1,
            totalMs,
        },
        error: null,
    };
}

describe('OpenAI endpoint latency observer', () => {
    it('summarizes bounded percentile samples deterministically', () => {
        assert.deepEqual(summarizeNumbers([10, 30, 20, null, undefined]), {
            count: 3,
            averageMs: 20,
            p50Ms: 20,
            p95Ms: 30,
            minMs: 10,
            maxMs: 30,
        });
    });

    it('builds one compact summary per fixed endpoint without storing response bodies or IPs', () => {
        const snapshot = buildOpenAiEndpointLatencySnapshot(
            [
                sample('chatgpt-web', 'chatgpt.com', 100, 110),
                sample('chatgpt-web', 'chatgpt.com', 140, 150),
                sample('chatgpt-websocket-host', 'ws.chatgpt.com', 180, 190),
                sample('openai-api', 'api.openai.com', 220, 230),
            ],
            2,
            3000,
        );

        assert.equal(snapshot.schemaVersion, 1);
        assert.equal(snapshot.authority, 'observed-from-devcontainer-to-fixed-openai-endpoints');
        assert.equal(snapshot.targets.length, 3);
        const chatgpt = snapshot.targets.find((target) => target.id === 'chatgpt-web');
        assert.equal(chatgpt?.timings.ttfb.p50Ms, 100);
        assert.equal(chatgpt?.timings.ttfb.p95Ms, 140);
        assert.deepEqual(chatgpt?.edgeColos, { GRU: 2 });
        assert.equal(JSON.stringify(snapshot).includes('remoteAddress'), false);
    });

    it('builds a 24h baseline and marks a material TTFB regression only when ratio and absolute delta are both high', () => {
        const now = Date.parse('2026-08-18T22:00:00.000Z');
        const baselineEntries = [
            buildOpenAiEndpointLatencySnapshot(
                [
                    sample('chatgpt-web', 'chatgpt.com', 100, 110),
                    sample('chatgpt-websocket-host', 'ws.chatgpt.com', 120, 130),
                    sample('openai-api', 'api.openai.com', 130, 140),
                ],
                1,
                3000,
            ),
            buildOpenAiEndpointLatencySnapshot(
                [
                    sample('chatgpt-web', 'chatgpt.com', 110, 120),
                    sample('chatgpt-websocket-host', 'ws.chatgpt.com', 125, 135),
                    sample('openai-api', 'api.openai.com', 135, 145),
                ],
                1,
                3000,
            ),
        ].map((entry, index) => ({
            ...entry,
            observedAt: new Date(now - (index + 1) * 60_000).toISOString(),
        }));

        const baseline = summarizeOpenAiEndpointLatencyHistory(baselineEntries, now);
        const current = buildOpenAiEndpointLatencySnapshot(
            [
                sample('chatgpt-web', 'chatgpt.com', 310, 320),
                sample('chatgpt-websocket-host', 'ws.chatgpt.com', 130, 140),
                sample('openai-api', 'api.openai.com', 140, 150),
            ],
            1,
            3000,
        );
        const comparison = compareOpenAiEndpointLatencyToBaseline(current, baseline);
        assert.equal(comparison.find((row) => row.id === 'chatgpt-web')?.regression, true);
        assert.equal(comparison.find((row) => row.id === 'chatgpt-websocket-host')?.regression, false);
        assert.equal(comparison.find((row) => row.id === 'openai-api')?.regression, false);
    });
});
