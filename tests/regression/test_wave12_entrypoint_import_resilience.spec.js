// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();

async function read(relPath) {
    return fs.readFile(path.join(ROOT, relPath), 'utf8');
}

test('wave12: main entrypoint lazy-loads driver adapter to reduce import blast radius', async () => {
    const content = await read('src/main.js');

    assert.doesNotMatch(
        content,
        /import\s+\{\s*DriverNERVAdapter\s*\}\s+from\s+'\.\/driver\/nerv_adapter\/driver_nerv_adapter\.js'/,
        'main.js should not statically import DriverNERVAdapter'
    );

    assert.match(
        content,
        /await\s+import\('\.\/driver\/nerv_adapter\/driver_nerv_adapter\.js'\)/,
        'main.js should lazy-load DriverNERVAdapter during boot'
    );
});

test('wave12: server lifecycle keeps dashboard modules lazy-loaded to avoid import-time side effects', async () => {
    const content = await read('src/server/engine/lifecycle.js');

    assert.doesNotMatch(
        content,
        /import\s+taskSyncBridge\s+from\s+'#server\/dashboard-api\/task_sync_bridge'/,
        'lifecycle.js should not statically import task_sync_bridge'
    );

    assert.doesNotMatch(
        content,
        /import\s+telemetryAggregator\s+from\s+'#server\/dashboard-api\/telemetry_aggregator'/,
        'lifecycle.js should not statically import telemetry_aggregator'
    );

    assert.match(
        content,
        /await\s+Promise\.all\(\s*\[\s*import\('#server\/dashboard-api\/task_sync_bridge'\),\s*import\('#server\/dashboard-api\/telemetry_aggregator'\),\s*\]\s*\)/,
        'lifecycle.js should lazy-load dashboard modules inside shutdown flow'
    );
});

test('wave12: importing entrypoints without boot side effects remains valid', async () => {
    const mainModule = await import('../../src/main.js');
    const serverMainModule = await import('../../src/server/main.js');

    assert.equal(typeof mainModule.boot, 'function', 'main entrypoint should export boot function');
    assert.equal(
        typeof serverMainModule.serverBootstrap,
        'function',
        'server entrypoint should export serverBootstrap'
    );
});
