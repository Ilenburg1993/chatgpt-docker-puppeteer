// @ts-check

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'vitest';
import {
    readOpenAiEndpointLatencyMonitorState,
    resetOpenAiEndpointLatencyMonitorForTests,
    scheduleOpenAiEndpointLatencyMonitor,
} from '#copilot/mcp/control-plane';

afterEach(() => resetOpenAiEndpointLatencyMonitorForTests());

function snapshot(ttfbMs = 100) {
    return {
        schemaVersion: 1,
        observedAt: '2026-08-18T21:00:00.000Z',
        authority: 'observed-from-devcontainer-to-fixed-openai-endpoints',
        sampleCount: 1,
        timeoutMs: 2500,
        targets: [
            {
                id: 'chatgpt-web', hostname: 'chatgpt.com', samples: 1, successful: 1, successRate: 1,
                statuses: [403], edgeColos: { GRU: 1 },
                timings: {
                    dns: { count: 1, averageMs: 3, p50Ms: 3, p95Ms: 3, minMs: 3, maxMs: 3 },
                    tcp: { count: 1, averageMs: 20, p50Ms: 20, p95Ms: 20, minMs: 20, maxMs: 20 },
                    tls: { count: 1, averageMs: 25, p50Ms: 25, p95Ms: 25, minMs: 25, maxMs: 25 },
                    ttfb: { count: 1, averageMs: ttfbMs, p50Ms: ttfbMs, p95Ms: ttfbMs, minMs: ttfbMs, maxMs: ttfbMs },
                    serverWait: { count: 1, averageMs: 50, p50Ms: 50, p95Ms: 50, minMs: 50, maxMs: 50 },
                    total: { count: 1, averageMs: ttfbMs + 1, p50Ms: ttfbMs + 1, p95Ms: ttfbMs + 1, minMs: ttfbMs + 1, maxMs: ttfbMs + 1 },
                },
            },
        ],
    };
}

describe('OpenAI endpoint latency monitor', () => {
    it('schedules once, runs non-blocking and reschedules after a successful cycle', async () => {
        /** @type {Array<() => void>} */
        const callbacks = [];
        const setTimeoutFn = /** @type {typeof setTimeout} */ ((fn) => {
            callbacks.push(/** @type {() => void} */ (fn));
            return /** @type {NodeJS.Timeout} */ ({ unref() {} });
        });
        let measured = 0;
        let persisted = 0;
        assert.equal(scheduleOpenAiEndpointLatencyMonitor({
            enabled: true,
            initialDelayMs: 0,
            intervalMs: 60_000,
            setTimeoutFn,
            measureFn: async () => {
                measured += 1;
                return { snapshot: /** @type {any} */ (snapshot()), samples: [] };
            },
            persistFn: async () => {
                persisted += 1;
                return { persisted: true, path: 'test.jsonl', retainedSnapshots: 1 };
            },
        }), true);
        assert.equal(scheduleOpenAiEndpointLatencyMonitor({ enabled: true, setTimeoutFn }), false);
        assert.equal(callbacks.length, 1);
        callbacks.shift()?.();
        await new Promise((resolve) => setImmediate(resolve));
        const state = readOpenAiEndpointLatencyMonitorState();
        assert.equal(measured, 1);
        assert.equal(persisted, 1);
        assert.equal(state.runs, 1);
        assert.equal(state.failures, 0);
        assert.equal(state.running, false);
        assert.equal(state.scheduled, true);
        assert.equal(callbacks.length, 1);
        assert.equal(state.lastSnapshot?.targets?.[0]?.ttfbP50Ms, 100);
    });

    it('records failure without throwing and still schedules the next cycle', async () => {
        /** @type {Array<() => void>} */
        const callbacks = [];
        const setTimeoutFn = /** @type {typeof setTimeout} */ ((fn) => {
            callbacks.push(/** @type {() => void} */ (fn));
            return /** @type {NodeJS.Timeout} */ ({ unref() {} });
        });
        scheduleOpenAiEndpointLatencyMonitor({
            enabled: true,
            initialDelayMs: 0,
            intervalMs: 60_000,
            setTimeoutFn,
            measureFn: async () => { throw new Error('simulated endpoint failure'); },
        });
        callbacks.shift()?.();
        await new Promise((resolve) => setImmediate(resolve));
        const state = readOpenAiEndpointLatencyMonitorState();
        assert.equal(state.runs, 1);
        assert.equal(state.failures, 1);
        assert.match(state.lastError ?? '', /simulated endpoint failure/u);
        assert.equal(state.scheduled, true);
        assert.equal(callbacks.length, 1);
    });
});
