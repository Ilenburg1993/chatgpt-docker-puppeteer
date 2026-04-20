// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { __mainTestHooks } from '#main';

test.afterEach(() => {
    __mainTestHooks.cleanupSignalHandlers();
    __mainTestHooks.resetShutdownState();
});

test('wave12: setupSignalHandlers tolerates unsupported SIGUSR2 and SIGHUP', () => {
    const originalOn = process.on;

    process.on = function patchedOn(/** @type {string} */ eventName, /** @type {(...args: any[]) => void} */ handler) {
        if (eventName === 'SIGUSR2' || eventName === 'SIGHUP') {
            throw new Error(`unsupported signal: ${eventName}`);
        }

        return originalOn.call(this, eventName, handler);
    };

    try {
        assert.doesNotThrow(() => {
            __mainTestHooks.setupSignalHandlers(/** @type {any} */ ({}));
        }, 'setupSignalHandlers should not throw when optional signals are unsupported');

        const handlers = __mainTestHooks.getSignalHandlers();
        assert.equal(handlers.sigusr2, null, 'SIGUSR2 handler should be null when registration fails');
        assert.equal(handlers.sighup, null, 'SIGHUP handler should be null when registration fails');
    } finally {
        __mainTestHooks.cleanupSignalHandlers();
        __mainTestHooks.resetShutdownState();
        process.on = originalOn;
    }
});
