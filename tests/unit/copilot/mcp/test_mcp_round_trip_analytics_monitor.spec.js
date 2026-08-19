// @ts-check

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'vitest';
import {
    readMcpRoundTripAnalyticsMonitorState,
    resetMcpRoundTripAnalyticsMonitorForTests,
    scheduleMcpRoundTripAnalyticsMonitor,
} from '#copilot/mcp/control-plane';

afterEach(() => resetMcpRoundTripAnalyticsMonitorForTests());

describe('MCP round-trip analytics monitor', () => {
    it('runs one non-overlapping incremental sync and reschedules after success', async () => {
        /** @type {Array<() => void>} */
        const callbacks = [];
        const setTimeoutFn = /** @type {typeof setTimeout} */ ((fn) => {
            callbacks.push(/** @type {() => void} */ (fn));
            return /** @type {NodeJS.Timeout} */ ({ unref() {} });
        });
        let calls = 0;
        assert.equal(
            scheduleMcpRoundTripAnalyticsMonitor({
                enabled: true,
                initialDelayMs: 0,
                intervalMs: 60_000,
                setTimeoutFn,
                syncFn: async () => {
                    calls += 1;
                    return {
                        ok: true,
                        processedBytes: 19_000_000,
                        indexedEvents: 1200,
                        lagBytes: 0,
                        complete: true,
                        reset: false,
                    };
                },
            }),
            true,
        );
        assert.equal(scheduleMcpRoundTripAnalyticsMonitor({ enabled: true, setTimeoutFn }), false);
        assert.equal(callbacks.length, 1);
        callbacks.shift()?.();
        await new Promise((resolve) => setImmediate(resolve));
        const state = readMcpRoundTripAnalyticsMonitorState();
        assert.equal(calls, 1);
        assert.equal(state.runs, 1);
        assert.equal(state.failures, 0);
        assert.equal(state.running, false);
        assert.equal(state.scheduled, true);
        assert.equal(state.firstRunProcessedBytes, 19_000_000);
        assert.equal(state.firstRunIndexedEvents, 1200);
        assert.equal(state.totalProcessedBytes, 19_000_000);
        assert.equal(state.totalIndexedEvents, 1200);
        assert.equal(state.lastProcessedBytes, 19_000_000);
        assert.equal(state.lastIndexedEvents, 1200);
        assert.equal(state.lastLagBytes, 0);
        assert.equal(state.lastComplete, true);
        assert.equal(callbacks.length, 1);
    });

    it('records a failed sync without throwing and still schedules the next cycle', async () => {
        /** @type {Array<() => void>} */
        const callbacks = [];
        const setTimeoutFn = /** @type {typeof setTimeout} */ ((fn) => {
            callbacks.push(/** @type {() => void} */ (fn));
            return /** @type {NodeJS.Timeout} */ ({ unref() {} });
        });
        scheduleMcpRoundTripAnalyticsMonitor({
            enabled: true,
            initialDelayMs: 0,
            intervalMs: 60_000,
            setTimeoutFn,
            syncFn: async () => {
                throw new Error('simulated analytics failure');
            },
        });
        callbacks.shift()?.();
        await new Promise((resolve) => setImmediate(resolve));
        const state = readMcpRoundTripAnalyticsMonitorState();
        assert.equal(state.runs, 1);
        assert.equal(state.failures, 1);
        assert.match(state.lastError ?? '', /simulated analytics failure/u);
        assert.equal(state.running, false);
        assert.equal(state.scheduled, true);
        assert.equal(callbacks.length, 1);
    });
});
