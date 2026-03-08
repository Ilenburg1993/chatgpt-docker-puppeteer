// @ts-check
import { shutdown as shutdownDriverFactory } from '#driver/factory';
import { DriverNERVAdapter } from '#driver/nerv_adapter/driver_nerv_adapter';
import assert from 'node:assert/strict';
import test, { after } from 'node:test';

class MockNerv {
    constructor() {
        this.unsubscribeCalls = 0;
    }

    onReceive() {
        return () => {
            this.unsubscribeCalls++;
        };
    }
}

after(async () => {
    await shutdownDriverFactory();
});

test('DriverNERVAdapter.shutdown is idempotent under concurrent calls', async () => {
    const nerv = new MockNerv();
    const adapter = new DriverNERVAdapter(nerv, null, {});

    let cleanupCalls = 0;
    adapter._finallyCleanup = async () => {
        cleanupCalls++;
        await new Promise((resolve) => setTimeout(resolve, 30));
    };

    adapter.activeDrivers.set('task-1', {
        page: null,
        driver: null,
        listeners: null,
    });

    const [r1, r2, r3] = await Promise.all([
        adapter.shutdown({ timeout: 200 }),
        adapter.shutdown({ timeout: 200 }),
        adapter.shutdown({ timeout: 200 }),
    ]);

    assert.equal(cleanupCalls, 1, 'cleanup must run only once');
    assert.deepEqual(r1, r2, 'concurrent shutdown callers must receive same result');
    assert.deepEqual(r2, r3, 'concurrent shutdown callers must receive same result');
    assert.equal(nerv.unsubscribeCalls, 1, 'NERV listener must be unsubscribed once');

    const r4 = await adapter.shutdown({ timeout: 200 });
    assert.deepEqual(r4, r1, 'subsequent shutdown calls must reuse cached result');
    assert.equal(cleanupCalls, 1, 'cached shutdown must not trigger extra cleanup');
});

test('DriverNERVAdapter.shutdown marks failed cleanup on timeout', async () => {
    const nerv = new MockNerv();
    const adapter = new DriverNERVAdapter(nerv, null, {});

    adapter._finallyCleanup = async () => {
        await new Promise(() => {});
    };

    adapter.activeDrivers.set('task-timeout', {
        page: null,
        driver: null,
        listeners: null,
    });

    const result = await adapter.shutdown({ timeout: 20 });

    assert.equal(result.total, 1);
    assert.equal(result.success, 0);
    assert.equal(result.failed, 1);
    assert.equal(nerv.unsubscribeCalls, 1, 'NERV listener must be unsubscribed on timeout path');
});
