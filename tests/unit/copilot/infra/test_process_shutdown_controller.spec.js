// @ts-check
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import {
    PROCESS_SHUTDOWN_PHASE,
    createProcessShutdownController,
} from '../../../../src/copilot/infra/composition/process/index.js';

const make = (options = {}) => createProcessShutdownController({ processId: 'test-process', ...options });

describe('ProcessInfra shutdown controller', () => {
    it('is instance-owned and executes semantic phases deterministically', async () => {
        const a = make();
        const b = createProcessShutdownController({ processId: 'other' });
        /** @type {string[]} */
        const order = [];
        a.register(
            'final',
            async () => {
                order.push('final');
            },
            PROCESS_SHUTDOWN_PHASE.FINAL,
        );
        a.register(
            'critical',
            async () => {
                order.push('critical');
            },
            PROCESS_SHUTDOWN_PHASE.RUNTIME_CRITICAL,
        );
        b.register('other', async () => {}, PROCESS_SHUTDOWN_PHASE.HOST_EARLY);
        assert.equal(a.handlers().length, 2);
        assert.equal(b.handlers().length, 1);
        await a.run('test');
        assert.deepEqual(order, ['critical', 'final']);
        assert.equal(a.lastReport()?.okCount, 2);
        assert.equal(b.isShuttingDown(), false);
    });

    it('registration returns an unregister token and registration after disposal fails', () => {
        const shutdown = make();
        const unregister = shutdown.register('x', async () => {});
        assert.equal(shutdown.handlers().length, 1);
        unregister();
        assert.equal(shutdown.handlers().length, 0);
        shutdown.dispose();
        assert.throws(() => shutdown.register('late', async () => {}), /disposed/u);
    });

    it('shares one in-flight shutdown run and does not execute twice', async () => {
        const shutdown = make();
        let calls = 0;
        let release = () => {};
        const blocker = new Promise((resolve) => {
            release = () => resolve(undefined);
        });
        shutdown.register('single', async () => {
            calls += 1;
            await blocker;
        });
        const first = shutdown.run('first');
        const second = shutdown.run('second');
        assert.equal(first, second);
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(calls, 1);
        release();
        await first;
        await shutdown.run('third');
        assert.equal(calls, 1);
    });

    it('failure is contained and observability failure cannot break shutdown', async () => {
        const shutdown = make();
        /** @type {string[]} */
        const events = [];
        shutdown.configureObservability({
            emit: (event) => {
                events.push(event.type);
                if (event.type.includes('handler_failed')) throw new Error('observer');
            },
        });
        shutdown.register(
            'fail',
            async () => {
                throw new Error('boom');
            },
            PROCESS_SHUTDOWN_PHASE.RUNTIME_CRITICAL,
        );
        shutdown.register('ok', async () => {}, PROCESS_SHUTDOWN_PHASE.FINAL);
        await shutdown.run('failure');
        assert.equal(shutdown.lastReport()?.failedCount, 1);
        assert.equal(shutdown.lastReport()?.okCount, 1);
        assert.deepEqual(events, [
            'runtime.shutdown.started',
            'runtime.shutdown.handler_failed',
            'runtime.shutdown.completed',
        ]);
    });

    it('aborts a cooperative handler on timeout and reports timed-out-and-aborted', async () => {
        const shutdown = make({ abortGraceMs: 100 });
        shutdown.register(
            'cooperative',
            ({ signal }) =>
                new Promise((resolve) => signal.addEventListener('abort', () => resolve(undefined), { once: true })),
            PROCESS_SHUTDOWN_PHASE.DEFAULT,
            { timeoutMs: 10 },
        );
        await shutdown.run('timeout');
        assert.equal(shutdown.lastReport()?.handlers[0]?.status, 'timed-out-and-aborted');
        assert.equal(shutdown.lastReport()?.timedOutAbortedCount, 1);
    });

    it('distinguishes work that is still running after timeout + abort grace', async () => {
        const shutdown = make({ abortGraceMs: 5 });
        shutdown.register('stubborn', async () => new Promise(() => {}), PROCESS_SHUTDOWN_PHASE.DEFAULT, {
            timeoutMs: 5,
        });
        await shutdown.run('timeout');
        assert.equal(shutdown.lastReport()?.handlers[0]?.status, 'timed-out-still-running');
        assert.equal(shutdown.lastReport()?.timedOutStillRunningCount, 1);
    });
});
