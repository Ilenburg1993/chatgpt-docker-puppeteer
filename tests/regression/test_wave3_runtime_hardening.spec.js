// @ts-check
import { shutdown as shutdownDriverFactory } from '#driver/factory';
import { __mainTestHooks } from '#main';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();

async function read(/** @type {any} */ relPath) {
    return fs.readFile(path.join(ROOT, relPath), 'utf8');
}

test('wave3: driver factory warm creation awaits concrete driver instance', async () => {
    const content = await read('src/driver/factory.js');

    assert.match(
        content,
        /const\s+driver\s*=\s*await\s+this\.createDriver\(/,
        '_createWarmDriver must await createDriver before storing in pool',
    );
});

test('wave3: adaptive state schema accepts string record keys', async () => {
    const content = await read('src/logic/adaptive.js');

    assert.match(
        content,
        /targets:\s*z\.record\(z\.string\(\),\s*TargetProfileSchema\)/,
        'adaptive schema must accept string keys for targets like tool:rag_search',
    );
});

test('wave3: concurrent signals reuse the same shutdown promise and exit once', async (t) => {
    const originalExit = process.exit;
    const exitCodes = /** @type {any[]} */ ([]);

    /** @type {any} */ (process).exit = (code = 0) => {
        exitCodes.push(Number(code));
    };

    __mainTestHooks.cleanupSignalHandlers();
    __mainTestHooks.resetShutdownState();

    afterAll(async () => {
        __mainTestHooks.cleanupSignalHandlers();
        __mainTestHooks.resetShutdownState();
        process.exit = originalExit;
        await shutdownDriverFactory();
    });

    __mainTestHooks.setupSignalHandlers(/** @type {any} */ ({}));

    const handlers = __mainTestHooks.getSignalHandlers();
    assert.equal(typeof handlers.sigterm, 'function');
    assert.equal(typeof handlers.sigint, 'function');

    const p1 = /** @type {any} */ (handlers).sigterm();
    const p2 = /** @type {any} */ (handlers).sigint();

    assert.strictEqual(p1, p2, 'SIGINT/SIGTERM concorrentes devem compartilhar a mesma Promise de shutdown');

    await Promise.all([p1, p2]);

    assert.equal(exitCodes.length, 1, 'shutdown concorrente deve solicitar exit exatamente uma vez');
    assert.equal(exitCodes[0], 0, 'shutdown bem-sucedido deve solicitar exit code 0');
});
