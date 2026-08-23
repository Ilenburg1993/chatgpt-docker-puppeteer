// @ts-check
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { createProcessScheduler } from '../../../../src/copilot/infra/composition/process/index.js';

describe('ProcessInfra scheduler', () => {
    it('is instance-owned and duplicate ids affect only their owner', () => {
        const a = createProcessScheduler({ processId: 'a' });
        const b = createProcessScheduler({ processId: 'b' });
        a.timeout('same', () => {}, 100_000);
        b.timeout('same', () => {}, 100_000);
        assert.equal(a.activeCount(), 1);
        assert.equal(b.activeCount(), 1);
        a.cancel('same');
        assert.equal(a.activeCount(), 0);
        assert.equal(b.activeCount(), 1);
        b.dispose();
    });

    it('completed timeout removes itself automatically', async () => {
        const scheduler = createProcessScheduler({ processId: 'auto-remove' });
        await new Promise((resolve) => scheduler.timeout('once', resolve, 5));
        assert.equal(scheduler.activeCount(), 0);
        scheduler.dispose();
    });

    it('cancel settles an in-flight sleep instead of leaving a pending Promise', async () => {
        const scheduler = createProcessScheduler({ processId: 'sleep-cancel' });
        const sleep = scheduler.sleep(100_000, { id: 'wait', ref: true });
        const timer = scheduler.list().find((entry) => entry.type === 'sleep');
        assert.ok(timer);
        assert.equal(scheduler.cancel(timer.id), true);
        await sleep;
        assert.equal(scheduler.activeCount(), 0);
        scheduler.dispose();
    });

    it('dispose settles all sleeps, clears timers, and rejects late registration', async () => {
        const scheduler = createProcessScheduler({ processId: 'dispose' });
        const a = scheduler.sleep(100_000, { id: 'a', ref: true });
        const b = scheduler.sleep(100_000, { id: 'b', ref: true });
        scheduler.interval('tick', () => {}, 100_000);
        scheduler.dispose();
        await Promise.all([a, b]);
        assert.equal(scheduler.activeCount(), 0);
        assert.throws(() => scheduler.timeout('late', () => {}, 1), /disposed/u);
    });
});
