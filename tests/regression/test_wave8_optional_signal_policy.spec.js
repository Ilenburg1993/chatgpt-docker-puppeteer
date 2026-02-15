import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

import { __mainTestHooks } from '../../src/main.js';
import { shutdown as shutdownDriverFactory } from '../../src/driver/factory.js';

function captureCounts(events) {
    return Object.fromEntries(events.map(event => [event, process.listenerCount(event)]));
}

function assertCountsEqual(actual, expected, messagePrefix) {
    for (const [event, expectedCount] of Object.entries(expected)) {
        assert.equal(actual[event], expectedCount, `${messagePrefix}: listener count mismatch for ${event}`);
    }
}

async function waitForOutput(getOutput, matcher, timeoutMs = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const output = getOutput();
        if (matcher.test(output)) {
            return output;
        }
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error(`Timeout waiting for output: ${String(matcher)}`);
}

async function waitForExitWithTimeout(child, timeoutMs, timeoutMessage) {
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

test.after(async () => {
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
        __mainTestHooks.setupSignalHandlers({});
        const afterSetup = captureCounts(events);

        assert.equal(afterSetup.SIGTERM, before.SIGTERM + 1, 'SIGTERM listener should be registered');
        assert.equal(afterSetup.SIGINT, before.SIGINT + 1, 'SIGINT listener should be registered');
        assert.equal(afterSetup.SIGUSR2, before.SIGUSR2 + 1, 'SIGUSR2 listener should be registered');
        assert.equal(afterSetup.SIGHUP, before.SIGHUP + 1, 'SIGHUP listener should be registered');

        if (process.platform === 'win32') {
            assert.equal(afterSetup.SIGBREAK, before.SIGBREAK + 1, 'SIGBREAK should be registered on win32');
            assert.equal(afterSetup.SIGQUIT, before.SIGQUIT, 'SIGQUIT should not be registered on win32');
        } else {
            assert.equal(afterSetup.SIGQUIT, before.SIGQUIT + 1, 'SIGQUIT should be registered on non-win32');
            assert.equal(afterSetup.SIGBREAK, before.SIGBREAK, 'SIGBREAK should not be registered on non-win32');
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

    __mainTestHooks.setupSignalHandlers({});
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
            process.env.LOG_LEVEL = 'ERROR';
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

            __mainTestHooks.setupSignalHandlers({});
            console.log('W8_SIGQUIT_READY');
        `;

        const child = spawn(process.execPath, ['--input-type=module', '-e', childScript], {
            cwd: process.cwd(),
            stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env },
        });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', chunk => {
            stdout += chunk.toString();
        });

        child.stderr.on('data', chunk => {
            stderr += chunk.toString();
        });

        await waitForOutput(() => stdout, /W8_SIGQUIT_READY/, 15000);

        child.kill('SIGQUIT');

        const [code, signal] = await waitForExitWithTimeout(
            child,
            20000,
            'Timeout waiting child exit (SIGQUIT)'
        );

        assert.equal(signal, null, `subprocess should exit by code, stderr=${stderr}`);
        assert.equal(code, 0, `expected graceful exit code 0, stdout=${stdout}, stderr=${stderr}`);

        const exitMarkers = stdout.match(/W8_SIGQUIT_EXIT:/g) || [];
        assert.equal(exitMarkers.length, 1, `SIGQUIT shutdown should trigger single exit, stdout=${stdout}`);
        assert.match(stdout, /W8_SIGQUIT_EXIT:0:1/, `expected SIGQUIT success marker, stdout=${stdout}`);
    }
);
