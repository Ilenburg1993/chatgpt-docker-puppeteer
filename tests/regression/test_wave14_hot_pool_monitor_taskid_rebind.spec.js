// @ts-check
import assert from 'node:assert/strict';
import EventEmitter from 'node:events';

import { PageLifecycleMonitor } from '#infra/browser_pool/PageLifecycleMonitor';
import BrowserPoolManager from '#infra/browser_pool/pool_manager';

test('wave14: updatePageTaskId rebinds lifecycle monitor taskId on hot-reuse', () => {
    const manager = new BrowserPoolManager({ poolSize: 1 });
    const page = {};

    const poolEntry = {
        id: 'browser-0',
        pages: new Map(),
        stats: { activeTasks: 1 },
    };

    const tempTaskId = 'temp-123';
    const realTaskId = 'task-real-123';

    poolEntry.pages.set(tempTaskId, page);
    manager.pool = /** @type {any[]} */ ([poolEntry]);

    page._poolEntry = poolEntry;
    page._tempTaskId = tempTaskId;
    page._poolMetadata = { poolEntryId: poolEntry.id, taskId: tempTaskId };

    let reboundTo = null;
    const monitor = {
        cleanup: () => {},
        rebindTaskId: (/** @type {any} */ nextTaskId) => {
            reboundTo = nextTaskId;
        },
    };
    manager.lifecycleMonitors.set(tempTaskId, monitor);

    manager.updatePageTaskId(page, realTaskId);

    assert.equal(poolEntry.pages.has(tempTaskId), false, 'temp taskId should be removed from pages map');
    assert.equal(poolEntry.pages.get(realTaskId), page, 'real taskId should point to the same page');
    assert.equal(reboundTo, realTaskId, 'monitor should be rebound to real taskId');
    assert.equal(manager.lifecycleMonitors.has(tempTaskId), false, 'old monitor key should be removed');
    assert.equal(manager.lifecycleMonitors.get(realTaskId), monitor, 'monitor should be stored under real taskId');
});

test('wave14: removePageFromPool supports fallback by page reference when taskId is stale', () => {
    const manager = new BrowserPoolManager({ poolSize: 1 });
    const page = {};

    const poolEntry = {
        id: 'browser-0',
        pages: new Map([['task-live', page]]),
        stats: { activeTasks: 1 },
    };

    manager.pool = /** @type {any[]} */ ([poolEntry]);

    let cleaned = false;
    manager.lifecycleMonitors.set('task-live', {
        cleanup: () => {
            cleaned = true;
        },
    });

    manager.removePageFromPool('task-stale', page);

    assert.equal(poolEntry.pages.size, 0, 'page should be removed even if taskId lookup is stale');
    assert.equal(poolEntry.stats.activeTasks, 0, 'activeTasks should be decremented');
    assert.equal(cleaned, true, 'monitor cleanup should run for resolved taskId');
});

test('wave14: lifecycle monitor uses rebound taskId on close/disconnect cleanup', () => {
    const page = new EventEmitter();
    const removals = /** @type {any[]} */ ([]);
    const poolManager = {
        stats: {},
        removePageFromPool: (/** @type {any[]} */ ...args) => {
            removals.push(args);
        },
    };

    const monitor = new PageLifecycleMonitor(page, poolManager, 'temp-task', null);
    monitor.rebindTaskId('task-final');
    monitor.handlePageClose();

    assert.equal(removals.length, 1, 'close path should remove page from pool');
    assert.equal(removals[0][0], 'task-final', 'close path must use rebound taskId');
});
