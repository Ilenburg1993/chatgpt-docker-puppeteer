import test from 'node:test';
import assert from 'node:assert/strict';

import { DriverNERVAdapter } from '#driver/nerv_adapter/driver_nerv_adapter';

function createAdapterLike(browserPool, hooks = {}) {
    return {
        browserPool,
        _detachDriverTelemetry: hooks.detachDriverTelemetry || (() => {}),
        _cleanupDriver: hooks.cleanupDriver || (() => {}),
        _timeout:
            hooks.timeout ||
            ((ms, operation) =>
                new Promise((_, reject) => {
                    setTimeout(() => {
                        reject(new Error(`Timeout after ${ms}ms (${operation})`));
                    }, ms);
                })),
    };
}

test('wave13: hot pool cleanup does not detach context and does not release page back to BrowserPool', async () => {
    const previous = process.env.DRIVER_HOT_POOL_ENABLED;
    process.env.DRIVER_HOT_POOL_ENABLED = 'true';

    let detachCalls = 0;
    let releaseCalls = 0;
    let cleanupCalls = 0;

    const adapterLike = createAdapterLike(
        {
            release: async () => {
                releaseCalls++;
            },
        },
        {
            cleanupDriver: () => {
                cleanupCalls++;
            },
        }
    );

    const driver = {
        _isHot: true,
        detachContext: () => {
            detachCalls++;
        },
        destroy: async () => {},
    };

    try {
        await DriverNERVAdapter.prototype._finallyCleanup.call(adapterLike, 'task-hot', { fake: true }, driver, []);
    } finally {
        if (previous === undefined) {
            delete process.env.DRIVER_HOT_POOL_ENABLED;
        } else {
            process.env.DRIVER_HOT_POOL_ENABLED = previous;
        }
    }

    assert.equal(detachCalls, 0, 'hot path should not call detachContext');
    assert.equal(releaseCalls, 0, 'hot path should not call browserPool.release(page)');
    assert.equal(cleanupCalls, 1, 'task cleanup should still execute');
});

test('wave13: cold pool cleanup keeps detach + BrowserPool page release', async () => {
    const previous = process.env.DRIVER_HOT_POOL_ENABLED;
    process.env.DRIVER_HOT_POOL_ENABLED = 'false';

    let detachCalls = 0;
    let releaseCalls = 0;
    let cleanupCalls = 0;

    const adapterLike = createAdapterLike(
        {
            release: async () => {
                releaseCalls++;
            },
        },
        {
            cleanupDriver: () => {
                cleanupCalls++;
            },
        }
    );

    const driver = {
        _isHot: true,
        detachContext: () => {
            detachCalls++;
        },
        destroy: async () => {},
    };

    try {
        await DriverNERVAdapter.prototype._finallyCleanup.call(adapterLike, 'task-cold', { fake: true }, driver, []);
    } finally {
        if (previous === undefined) {
            delete process.env.DRIVER_HOT_POOL_ENABLED;
        } else {
            process.env.DRIVER_HOT_POOL_ENABLED = previous;
        }
    }

    assert.equal(detachCalls, 1, 'cold path should detach context');
    assert.equal(releaseCalls, 1, 'cold path should release page to BrowserPool');
    assert.equal(cleanupCalls, 1, 'task cleanup should still execute');
});
