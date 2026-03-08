// @ts-check
import assert from 'node:assert/strict';
import test from 'node:test';

import { ResilientLockManager } from '../../src/infra/locks/resilient_lock.js';
import { registerUpstreams, shutdownUpstreams } from '../../src/integration/mcp/upstream-manager.mjs';

const registryStub = {
    has() {
        return false;
    },
    register() {},
};

function captureCounts(/** @type {any} */ events) {
    return Object.fromEntries(events.map((/** @type {any} */ event) => [event, process.listenerCount(event)]));
}

function assertCountsEqual(/** @type {any} */ actual, /** @type {any} */ expected, /** @type {any} */ messagePrefix) {
    for (const [event, expectedCount] of Object.entries(expected)) {
        assert.equal(actual[event], expectedCount, `${messagePrefix}: listener count mismatch for ${event}`);
    }
}

test('wave6: upstream manager does not keep global listeners when upstreams are disabled', async () => {
    const events = ['exit', 'SIGINT', 'SIGTERM'];

    await shutdownUpstreams();
    const before = captureCounts(events);

    try {
        await registerUpstreams(registryStub, { env: {} });
        const afterRegister = captureCounts(events);
        assertCountsEqual(afterRegister, before, 'registerUpstreams disabled');
    } finally {
        await shutdownUpstreams();
        const afterShutdown = captureCounts(events);
        assertCountsEqual(afterShutdown, before, 'shutdownUpstreams disabled');
    }
});

test('wave6: upstream manager installs and removes listeners deterministically when enabled', async () => {
    const events = ['exit', 'SIGINT', 'SIGTERM'];

    await shutdownUpstreams();
    const before = captureCounts(events);

    const env = {
        MCP_UPSTREAM_ENABLED: 'true',
        MCP_UPSTREAM_URL: 'http://127.0.0.1:1',
        MCP_UPSTREAM_ALIAS: 'wave6_dummy',
        MCP_UPSTREAM_RESTART_ENABLED: 'false',
    };

    try {
        await registerUpstreams(registryStub, { env });
        const afterRegister = captureCounts(events);

        assert.equal(afterRegister.exit, before.exit + 1, 'exit listener should be installed once');
        assert.equal(afterRegister.SIGINT, before.SIGINT + 1, 'SIGINT listener should be installed once');
        assert.equal(afterRegister.SIGTERM, before.SIGTERM + 1, 'SIGTERM listener should be installed once');
    } finally {
        await shutdownUpstreams();
        const afterShutdown = captureCounts(events);
        assertCountsEqual(afterShutdown, before, 'shutdownUpstreams enabled');
    }
});

test('wave6: resilient lock unregisters global listeners after releasing final lock', async () => {
    const manager = new ResilientLockManager();
    const events = ['beforeExit', 'SIGINT', 'SIGTERM', 'uncaughtException', 'unhandledRejection'];
    const before = captureCounts(events);

    const acquired = await manager.acquire(
        'wave6-lock-1',
        async () => true,
        async () => {},
    );

    assert.equal(acquired, true, 'lock should be acquired');

    const afterAcquire = captureCounts(events);
    for (const event of events) {
        assert.equal(afterAcquire[event], before[event] + 1, `${event} should be installed once after acquire`);
    }

    const released = await manager.release('wave6-lock-1');
    assert.equal(released, true, 'lock should be released');

    const afterRelease = captureCounts(events);
    assertCountsEqual(afterRelease, before, 'resilient lock release');
});

test('wave6: resilient lock cleanupGlobalListeners is idempotent', async () => {
    const manager = new ResilientLockManager();
    const events = ['beforeExit', 'SIGINT', 'SIGTERM', 'uncaughtException', 'unhandledRejection'];
    const before = captureCounts(events);

    await manager.acquire(
        'wave6-lock-2',
        async () => true,
        async () => {},
    );

    manager.cleanupGlobalListeners();
    manager.cleanupGlobalListeners();

    const afterCleanup = captureCounts(events);
    assertCountsEqual(afterCleanup, before, 'resilient lock cleanupGlobalListeners');
});
