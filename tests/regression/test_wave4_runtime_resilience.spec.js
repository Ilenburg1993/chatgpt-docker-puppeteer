// @ts-check
import * as lifecycle from '#server/engine/lifecycle';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { test } from 'node:test';

async function waitForOutput(/** @type {any} */ getOutput, /** @type {any} */ matcher, timeoutMs = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const output = getOutput();
        if (matcher.test(output)) {
            return output;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`Timeout waiting for output: ${matcher}`);
}

/**
 * @param {import('node:child_process').ChildProcess} child
 * @param {number} [timeoutMs]
 * @returns {Promise<[number | null, NodeJS.Signals | null]>}
 */
function waitForExit(child, timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timeout waiting child exit')), timeoutMs);
        timeout.unref();
        child.once('exit', (code, signal) => {
            clearTimeout(timeout);
            resolve([code, signal]);
        });
    });
}

test('wave4: lifecycle.listenToSignals is idempotent and cleanup removes listeners', () => {
    lifecycle.cleanupSignalListeners();

    const beforeSigint = process.listenerCount('SIGINT');
    const beforeSigterm = process.listenerCount('SIGTERM');

    lifecycle.listenToSignals();
    lifecycle.listenToSignals();

    const afterSigint = process.listenerCount('SIGINT');
    const afterSigterm = process.listenerCount('SIGTERM');

    assert.equal(afterSigint, beforeSigint + 1, 'SIGINT listener should be registered once');
    assert.equal(afterSigterm, beforeSigterm + 1, 'SIGTERM listener should be registered once');

    lifecycle.cleanupSignalListeners();

    assert.equal(process.listenerCount('SIGINT'), beforeSigint);
    assert.equal(process.listenerCount('SIGTERM'), beforeSigterm);
});

test('wave4: real SIGTERM+SIGINT in subprocess trigger single coordinated shutdown', async () => {
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
            console.log('W4_EXIT:' + String(code) + ':' + String(exitCalls));

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
        console.log('W4_READY');
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

    await waitForOutput(() => stdout, /W4_READY/, 15000);

    child.kill('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 10));
    try {
        child.kill('SIGINT');
    } catch {
        // Process may have already exited.
    }

    const exitResult = await waitForExit(child);

    const [code, signal] = exitResult;
    assert.equal(signal, null, `subprocess should exit by code, stderr=${stderr}`);
    assert.equal(code, 0, `expected graceful exit code 0, stdout=${stdout}, stderr=${stderr}`);

    const exitMarkers = stdout.match(/W4_EXIT:/g) || [];
    assert.equal(exitMarkers.length, 1, `process.exit should be requested exactly once, stdout=${stdout}`);
    assert.match(stdout, /W4_EXIT:0:1/, `expected single success exit marker, stdout=${stdout}`);
});
