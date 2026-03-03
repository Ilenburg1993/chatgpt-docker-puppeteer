// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';

import {
    __lifecycleTestHooks,
    cleanupSignalListeners,
    listenToSignals,
    setAllowProcessExit,
} from '#server/engine/lifecycle';

function captureCounts(events) {
    return Object.fromEntries(events.map(event => [event, process.listenerCount(event)]));
}

function assertCountsEqual(actual, expected, messagePrefix) {
    for (const [event, expectedCount] of Object.entries(expected)) {
        assert.equal(actual[event], expectedCount, `${messagePrefix}: listener count mismatch for ${event}`);
    }
}

test.afterEach(() => {
    cleanupSignalListeners();
    setAllowProcessExit(true);
    __lifecycleTestHooks.resetState();
});

test('wave10: lifecycle signal matrix is registered once with platform policy', () => {
    const events = [
        'SIGINT',
        'SIGTERM',
        'SIGUSR2',
        'SIGQUIT',
        'SIGBREAK',
        'SIGPIPE',
        'SIGCHLD',
        'uncaughtException',
        'unhandledRejection',
    ];

    cleanupSignalListeners();
    __lifecycleTestHooks.resetState();

    const before = captureCounts(events);

    listenToSignals();
    listenToSignals();

    const handlers = __lifecycleTestHooks.getSignalHandlers();
    const afterSetup = captureCounts(events);

    assert.equal(afterSetup.SIGINT, before.SIGINT + 1, 'SIGINT should be registered exactly once');
    assert.equal(afterSetup.SIGTERM, before.SIGTERM + 1, 'SIGTERM should be registered exactly once');

    if (typeof handlers.sigusr2 === 'function') {
        assert.equal(afterSetup.SIGUSR2, before.SIGUSR2 + 1, 'SIGUSR2 should be registered once when supported');
    } else {
        assert.equal(afterSetup.SIGUSR2, before.SIGUSR2, 'SIGUSR2 count should remain stable when unsupported');
    }

    if (process.platform === 'win32') {
        assert.equal(afterSetup.SIGBREAK, before.SIGBREAK + 1, 'SIGBREAK should be registered on win32');
        assert.equal(afterSetup.SIGQUIT, before.SIGQUIT, 'SIGQUIT should not be registered on win32');
    } else {
        assert.equal(afterSetup.SIGQUIT, before.SIGQUIT + 1, 'SIGQUIT should be registered on non-win32');
        assert.equal(afterSetup.SIGBREAK, before.SIGBREAK, 'SIGBREAK should not be registered on non-win32');
    }

    if (process.platform === 'win32') {
        assert.equal(afterSetup.SIGPIPE, before.SIGPIPE, 'SIGPIPE should stay unchanged on win32');
        assert.equal(afterSetup.SIGCHLD, before.SIGCHLD, 'SIGCHLD should stay unchanged on win32');
    } else {
        if (typeof handlers.sigpipe === 'function') {
            assert.equal(afterSetup.SIGPIPE, before.SIGPIPE + 1, 'SIGPIPE should be registered on POSIX');
        } else {
            assert.equal(afterSetup.SIGPIPE, before.SIGPIPE, 'SIGPIPE should stay unchanged when unsupported');
        }

        if (typeof handlers.sigchld === 'function') {
            assert.equal(afterSetup.SIGCHLD, before.SIGCHLD + 1, 'SIGCHLD should be registered on POSIX');
        } else {
            assert.equal(afterSetup.SIGCHLD, before.SIGCHLD, 'SIGCHLD should stay unchanged when unsupported');
        }
    }

    assert.equal(
        afterSetup.uncaughtException,
        before.uncaughtException + 1,
        'uncaughtException should be registered once'
    );
    assert.equal(
        afterSetup.unhandledRejection,
        before.unhandledRejection + 1,
        'unhandledRejection should be registered once'
    );
});

test('wave10: lifecycle cleanup is deterministic and idempotent for full signal matrix', () => {
    const events = [
        'SIGINT',
        'SIGTERM',
        'SIGUSR2',
        'SIGQUIT',
        'SIGBREAK',
        'SIGPIPE',
        'SIGCHLD',
        'uncaughtException',
        'unhandledRejection',
    ];

    cleanupSignalListeners();
    __lifecycleTestHooks.resetState();
    const before = captureCounts(events);

    listenToSignals();
    cleanupSignalListeners();
    cleanupSignalListeners();
    __lifecycleTestHooks.resetState();

    const after = captureCounts(events);
    assertCountsEqual(after, before, 'wave10 lifecycle cleanup');
});

test('wave10: optional subprocess handlers do not arm shutdown state', () => {
    cleanupSignalListeners();
    __lifecycleTestHooks.resetState();
    setAllowProcessExit(false);

    listenToSignals();
    const handlers = __lifecycleTestHooks.getSignalHandlers();

    if (typeof handlers.sigpipe === 'function') {
        handlers.sigpipe();
    }
    if (typeof handlers.sigchld === 'function') {
        handlers.sigchld();
    }

    assert.equal(
        __lifecycleTestHooks.isShuttingDown(),
        false,
        'SIGPIPE/SIGCHLD should not move lifecycle to shuttingDown state'
    );
    assert.equal(__lifecycleTestHooks.isSignalsListening(), true, 'signal listening should remain active');
});
