// @ts-check
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { __mainTestHooks, shutdown } from '#main';
import { shutdown as shutdownDriverFactory } from '#driver/factory';

const ROOT = process.cwd();

async function read(/** @type {any} */ relPath) {
    return fs.readFile(path.join(ROOT, relPath), 'utf8');
}

after(async () => {
    __mainTestHooks.cleanupSignalHandlers();
    __mainTestHooks.resetShutdownState();
    await shutdownDriverFactory().catch(() => {});
});

test('wave11: integrated mode delegates to serverBootstrap with delegated authority', async () => {
    const content = await read('src/main.js');

    assert.match(
        content,
        /const\s+\{\s*serverBootstrap\s*\}\s*=\s*await\s+import\('\.\/server\/main\.js'\)/,
        'main.js must import serverBootstrap for integrated mode'
    );
    assert.match(
        content,
        /serverBootstrap\(\{\s*authority:\s*Authority\.SERVER_AUTHORITIES\.DELEGATED,\s*nerv\s*,?\s*\}\)/m,
        'integrated mode must delegate with delegated authority and injected NERV'
    );
});

test('wave11: integrated mode no longer starts server engine directly in main.js', async () => {
    const content = await read('src/main.js');

    assert.doesNotMatch(
        content,
        /serverEngine\.start\(/,
        'integrated mode must not call serverEngine.start directly from main.js'
    );
});

test('wave11: authority resolution in main.js is centralized via core/authority module', async () => {
    const content = await read('src/main.js');

    assert.match(
        content,
        /import\s+\*\s+as\s+Authority\s+from\s+'\.\/core\/authority\.js'/,
        'main.js must import core authority module'
    );
    assert.match(
        content,
        /Authority\.resolveAuthority\(/,
        'main.js resolveAuthority must delegate validation to core authority module'
    );
});

test('wave11: shutdown delegates HTTP teardown to server lifecycle when managed', async () => {
    let serverAdapterShutdownCalls = 0;
    let lifecycleShutdownCalls = 0;
    let httpCloseCalls = 0;

    const context = {
        serverAdapter: {
            async shutdown() {
                serverAdapterShutdownCalls++;
            },
        },
        serverLifecycle: {
            async gracefulShutdown() {
                lifecycleShutdownCalls++;
            },
        },
        serverLifecycleManaged: true,
        httpAuthority: true,
        httpServer: {
            close(/** @type {any} */ cb) {
                httpCloseCalls++;
                cb();
            },
        },
    };

    const result = await shutdown(/** @type {any} */ (context), /** @type {any} */ ({ exitOnComplete: false }));

    assert.equal(result.ok, true, 'shutdown should finish successfully with managed lifecycle');
    assert.equal(serverAdapterShutdownCalls, 1, 'server adapter must shutdown once');
    assert.equal(lifecycleShutdownCalls, 1, 'server lifecycle must shutdown once');
    assert.equal(httpCloseCalls, 0, 'direct http close must be skipped when lifecycle is managed');
});
