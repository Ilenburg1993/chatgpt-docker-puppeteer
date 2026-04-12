// @ts-check
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { test, after } from 'node:test';

import { shutdown as shutdownDriverFactory } from '../../src/driver/factory.js';
import { __mainTestHooks } from '../../src/main.js';

function captureCounts(/** @type {any} */ events) {
    return Object.fromEntries(events.map((/** @type {any} */ event) => [event, process.listenerCount(event)]));
}

function assertCountsEqual(/** @type {any} */ actual, /** @type {any} */ expected, /** @type {any} */ messagePrefix) {
    for (const [event, expectedCount] of Object.entries(expected)) {
        assert.equal(actual[event], expectedCount, `${messagePrefix}: listener count mismatch for ${event}`);
    }
}

async function waitForOutput(/** @type {any} */ getOutput, /** @type {any} */ matcher, timeoutMs = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const output = getOutput();
        if (matcher.test(output)) {
            return output;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`Timeout waiting for output: ${String(matcher)}`);
}

async function waitForExitWithTimeout(
    /** @type {any} */ child,
    /** @type {any} */ timeoutMs,
    /** @type {any} */ timeoutMessage,
) {
    let timeoutId = null;
    try {
        return await Promise.race([
            once(child, 'exit'),
            new Promise((_, reject) => {
                timeoutId = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
            }),
        ]);
    } finally {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }
    }
}

after(async () => {
    __mainTestHooks.cleanupSignalHandlers();
    __mainTestHooks.resetShutdownState();
    await shutdownDriverFactory().catch(() => {});
});

test('wave9: SIGPIPE/SIGCHLD optional policy is explicit, non-shutdown, and cleanup-safe', () => {
    const events = ['SIGPIPE', 'SIGCHLD', 'SIGTERM', 'SIGINT', 'SIGUSR2'];

    __mainTestHooks.cleanupSignalHandlers();
    __mainTestHooks.resetShutdownState();

    const before = captureCounts(events);

    try {
        __mainTestHooks.setupSignalHandlers(/** @type {any} */ ({}));
        const handlers = __mainTestHooks.getSignalHandlers();
        const afterSetup = captureCounts(events);

        if (process.platform === 'win32') {
            assert.equal(handlers.sigpipe, null, 'sigpipe handler should not be installed on win32');
            assert.equal(handlers.sigchld, null, 'sigchld handler should not be installed on win32');
            assert.equal(afterSetup.SIGPIPE, before.SIGPIPE, 'SIGPIPE should not change on win32');
            assert.equal(afterSetup.SIGCHLD, before.SIGCHLD, 'SIGCHLD should not change on win32');
        } else {
            if (typeof handlers.sigpipe === 'function') {
                assert.equal(afterSetup.SIGPIPE, before.SIGPIPE + 1, 'SIGPIPE should be installed on POSIX');
                /** @type {any} */ (handlers).sigpipe();
            } else {
                assert.equal(afterSetup.SIGPIPE, before.SIGPIPE, 'SIGPIPE count should stay stable when unsupported');
            }

            if (typeof handlers.sigchld === 'function') {
                assert.equal(afterSetup.SIGCHLD, before.SIGCHLD + 1, 'SIGCHLD should be installed on POSIX');
                /** @type {any} */ (handlers).sigchld();
            } else {
                assert.equal(afterSetup.SIGCHLD, before.SIGCHLD, 'SIGCHLD count should stay stable when unsupported');
            }

            assert.equal(
                __mainTestHooks.getShutdownPromise(),
                null,
                'optional subprocess signals must not trigger shutdown promise',
            );
        }
    } finally {
        __mainTestHooks.cleanupSignalHandlers();
        __mainTestHooks.resetShutdownState();
    }

    const afterCleanup = captureCounts(events);
    assertCountsEqual(afterCleanup, before, 'wave9 cleanup');
});

test(
    'wave9: real SIGPIPE does not force shutdown before canonical SIGTERM path (POSIX)',
    { skip: process.platform === 'win32' },
    async () => {
        const childScript = `
            process.env.LOG_LEVEL = 'ERROR';
            const { __mainTestHooks } = await import('#main');
            const { shutdown: shutdownDriverFactory } = await import('#driver/factory');

            const keepAlive = setInterval(() => {}, 1000);
            let exitCalls = 0;

            __mainTestHooks.cleanupSignalHandlers();
            __mainTestHooks.resetShutdownState();

            process.exit = code => {
                exitCalls += 1;
                console.log('W9_EXIT:' + String(code) + ':' + String(exitCalls));

                Promise.resolve()
                    .then(() => shutdownDriverFactory())
                    .catch(() => {})
                    .finally(() => {
                        __mainTestHooks.cleanupSignalHandlers();
                        __mainTestHooks.resetShutdownState();
                        clearInterval(keepAlive);
                        process.exitCode = Number(code);
                    });
            };

            __mainTestHooks.setupSignalHandlers(/** @type {any} */ ({}));
            console.log('W9_READY');

            setTimeout(() => console.log('W9_STILL_ALIVE'), 300);
            setTimeout(() => {
                if (!__mainTestHooks.getShutdownPromise()) {
                    console.log('W9_NO_SHUTDOWN_AFTER_SIGPIPE');
                }
            }, 500);
            setTimeout(() => process.kill(process.pid, 'SIGTERM'), 700);
        `;

        const child = spawn(process.execPath, ['--input-type=module', '-e', childScript], {
            cwd: process.cwd(),
            stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env },
        });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (chunk) => {
            stdout += chunk.toString();
        });

        child.stderr.on('data', (chunk) => {
            stderr += chunk.toString();
        });

        await waitForOutput(() => stdout, /W9_READY/, 15000);

        child.kill('SIGPIPE');

        await waitForOutput(() => stdout, /W9_STILL_ALIVE/, 10000);
        await waitForOutput(() => stdout, /W9_NO_SHUTDOWN_AFTER_SIGPIPE/, 10000);
        assert.match(
            stdout,
            /W9_NO_SHUTDOWN_AFTER_SIGPIPE/,
            `SIGPIPE should not create shutdown promise, stdout=${stdout}, stderr=${stderr}`,
        );

        const [code, signal] = await waitForExitWithTimeout(child, 20000, 'Timeout waiting child exit (wave9 SIGPIPE)');

        assert.equal(signal, null, `subprocess should exit by code, stderr=${stderr}`);
        assert.equal(code, 0, `expected graceful exit code 0, stdout=${stdout}, stderr=${stderr}`);

        const exitMarkers = stdout.match(/W9_EXIT:/g) || [];
        assert.equal(exitMarkers.length, 1, `SIGTERM should trigger single canonical exit, stdout=${stdout}`);
        assert.match(stdout, /W9_EXIT:0:1/, `expected success exit marker, stdout=${stdout}`);
    },
);
