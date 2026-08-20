// @ts-check
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { after, test } from 'node:test';

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

test('wave8: optional signal policy registers only platform-specific listener and cleanup reverts counts', () => {
    const events = ['SIGQUIT', 'SIGBREAK', 'SIGTERM', 'SIGINT', 'SIGUSR2', 'SIGHUP'];

    __mainTestHooks.cleanupSignalHandlers();
    __mainTestHooks.resetShutdownState();

    const before = captureCounts(events);

    try {
        __mainTestHooks.setupSignalHandlers(/** @type {any} */ ({}));
        const afterSetup = captureCounts(events);

        assert.equal(afterSetup['SIGTERM'], before['SIGTERM'] + 1, 'SIGTERM listener should be registered');
        assert.equal(afterSetup['SIGINT'], before['SIGINT'] + 1, 'SIGINT listener should be registered');
        assert.equal(afterSetup['SIGUSR2'], before['SIGUSR2'] + 1, 'SIGUSR2 listener should be registered');
        assert.equal(afterSetup['SIGHUP'], before['SIGHUP'] + 1, 'SIGHUP listener should be registered');

        if (process.platform === 'win32') {
            assert.equal(afterSetup['SIGBREAK'], before['SIGBREAK'] + 1, 'SIGBREAK should be registered on win32');
            assert.equal(afterSetup['SIGQUIT'], before['SIGQUIT'], 'SIGQUIT should not be registered on win32');
        } else {
            assert.equal(afterSetup['SIGQUIT'], before['SIGQUIT'] + 1, 'SIGQUIT should be registered on non-win32');
            assert.equal(afterSetup['SIGBREAK'], before['SIGBREAK'], 'SIGBREAK should not be registered on non-win32');
        }
    } finally {
        __mainTestHooks.cleanupSignalHandlers();
        __mainTestHooks.resetShutdownState();
    }

    const afterCleanup = captureCounts(events);
    assertCountsEqual(afterCleanup, before, 'cleanupSignalHandlers optional policy');
});

test('wave8: cleanupSignalHandlers remains idempotent with optional signals', () => {
    const events = ['SIGQUIT', 'SIGBREAK', 'SIGTERM', 'SIGINT', 'SIGUSR2', 'SIGHUP'];

    __mainTestHooks.cleanupSignalHandlers();
    __mainTestHooks.resetShutdownState();

    const before = captureCounts(events);

    __mainTestHooks.setupSignalHandlers(/** @type {any} */ ({}));
    __mainTestHooks.cleanupSignalHandlers();
    __mainTestHooks.cleanupSignalHandlers();
    __mainTestHooks.resetShutdownState();

    const after = captureCounts(events);
    assertCountsEqual(after, before, 'cleanupSignalHandlers idempotence');
});

test(
    'wave8: SIGQUIT follows canonical shutdown path in subprocess (POSIX)',
    { skip: process.platform === 'win32' },
    async () => {
        const childScript = `
            process.env['LOG_LEVEL'] = 'ERROR';
            const { __mainTestHooks } = await import('#main');
            const { shutdown: shutdownDriverFactory } = await import('#driver/factory');

            const keepAlive = setInterval(() => {}, 1000);
            let exitCalls = 0;

            __mainTestHooks.cleanupSignalHandlers();
            __mainTestHooks.resetShutdownState();

            process.exit = code => {
                exitCalls += 1;
                console.log('W8_SIGQUIT_EXIT:' + String(code) + ':' + String(exitCalls));

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
            console.log('W8_SIGQUIT_READY');
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

        await waitForOutput(() => stdout, /W8_SIGQUIT_READY/, 15000);

        child.kill('SIGQUIT');

        const [code, signal] = await waitForExitWithTimeout(child, 20000, 'Timeout waiting child exit (SIGQUIT)');

        assert.equal(signal, null, `subprocess should exit by code, stderr=${stderr}`);
        assert.equal(code, 0, `expected graceful exit code 0, stdout=${stdout}, stderr=${stderr}`);

        const exitMarkers = stdout.match(/W8_SIGQUIT_EXIT:/g) || [];
        assert.equal(exitMarkers.length, 1, `SIGQUIT shutdown should trigger single exit, stdout=${stdout}`);
        assert.match(stdout, /W8_SIGQUIT_EXIT:0:1/, `expected SIGQUIT success marker, stdout=${stdout}`);
    },
);
