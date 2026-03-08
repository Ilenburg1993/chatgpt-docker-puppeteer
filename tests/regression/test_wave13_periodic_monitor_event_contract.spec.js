// @ts-check
import assert from 'node:assert/strict';
import test from 'node:test';

import PeriodicHealthMonitor, { MONITOR_EVENTS } from '#infra/browser_pool/PeriodicHealthMonitor';

function createPoolManagerStub() {
    return {
        browser: {
            isConnected: () => true,
            targets: async () => [],
        },
        getActivePages: () => [],
    };
}

test('wave13: monitor event enum declares MONITOR_STARTED and MONITOR_STOPPED', () => {
    assert.equal(MONITOR_EVENTS.MONITOR_STARTED, 'health:monitor_started');
    assert.equal(MONITOR_EVENTS.MONITOR_STOPPED, 'health:monitor_stopped');
});

test('wave13: monitor emits start/stop events with declared contract', async () => {
    const poolManager = createPoolManagerStub();
    const monitor = new PeriodicHealthMonitor(poolManager);

    let started = false;
    let stopped = false;

    monitor.once(MONITOR_EVENTS.MONITOR_STARTED, (payload) => {
        started = Boolean(payload && payload.timestamp);
    });
    monitor.once(MONITOR_EVENTS.MONITOR_STOPPED, (payload) => {
        stopped = Boolean(payload && payload.timestamp);
    });

    monitor.start(50);
    await new Promise((resolve) => setTimeout(resolve, 10));
    monitor.stop();

    assert.equal(started, true, 'monitor should emit MONITOR_STARTED');
    assert.equal(stopped, true, 'monitor should emit MONITOR_STOPPED');
});
