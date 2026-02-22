import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { DriverNERVAdapter } from '#driver/nerv_adapter/driver_nerv_adapter';

test('wave14: _withTimeout resolves and clears timer on success path', async () => {
    const adapterLike = Object.create(DriverNERVAdapter.prototype);
    const originalClearTimeout = global.clearTimeout;
    let clearCalls = 0;

    global.clearTimeout = (...args) => {
        clearCalls++;
        return originalClearTimeout(...args);
    };

    try {
        const result = await DriverNERVAdapter.prototype._withTimeout.call(
            adapterLike,
            Promise.resolve('ok'),
            100,
            'unit-success'
        );
        assert.equal(result, 'ok');
    } finally {
        global.clearTimeout = originalClearTimeout;
    }

    assert.ok(clearCalls >= 1, 'success path should clear the timeout timer');
});

test('wave14: _withTimeout returns TimeoutError metadata on timeout', async () => {
    const adapterLike = Object.create(DriverNERVAdapter.prototype);

    await assert.rejects(
        () => DriverNERVAdapter.prototype._withTimeout.call(adapterLike, new Promise(() => {}), 20, 'unit-timeout'),
        err => {
            assert.equal(err?.name, 'TimeoutError');
            assert.equal(err?.operation, 'unit-timeout');
            return true;
        }
    );
});

test('wave14: driver adapter source no longer uses _timeout Promise.race helper', async () => {
    const filePath = path.join(process.cwd(), 'src/driver/nerv_adapter/driver_nerv_adapter.js');
    const content = await fs.readFile(filePath, 'utf8');

    assert.doesNotMatch(content, /\b_timeout\s*\(/, 'legacy _timeout helper should be removed');
    assert.match(content, /\b_withTimeout\s*\(/, '_withTimeout helper should exist');
});
