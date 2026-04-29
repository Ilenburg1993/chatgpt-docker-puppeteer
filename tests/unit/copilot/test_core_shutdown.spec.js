// @ts-check
/**
 * tests/unit/copilot/test_core_shutdown.spec.js
 *
 * Testes unitários — core/shutdown.js: registerShutdownHandler + runShutdown.
 */

import assert from 'node:assert/strict';
import { afterAll, beforeEach, describe, it } from 'vitest';

import {
    _resetForTesting,
    getLastShutdownReport,
    isShuttingDown,
    listShutdownHandlers,
    registerShutdownHandler,
    runShutdown,
    setShutdownEventEmitter,
} from '../../../src/copilot/core/shutdown.js';

describe('core/shutdown.js', () => {
    beforeEach(() => {
        _resetForTesting();
    });

    afterAll(() => {
        _resetForTesting();
    });

    it('isShuttingDown retorna false antes do shutdown', () => {
        assert.equal(isShuttingDown(), false);
    });

    it('runShutdown executa handlers em ordem de prioridade', async () => {
        /** @type {string[]} */
        const order = [];

        registerShutdownHandler(
            'low',
            async () => {
                order.push('low');
            },
            30,
        );
        registerShutdownHandler(
            'high',
            async () => {
                order.push('high');
            },
            10,
        );
        registerShutdownHandler(
            'mid',
            async () => {
                order.push('mid');
            },
            20,
        );

        await runShutdown('test');

        assert.deepEqual(order, ['high', 'mid', 'low']);
        assert.equal(isShuttingDown(), true);
        assert.deepEqual(
            getLastShutdownReport()?.handlers.map((handler) => handler.name),
            ['high', 'mid', 'low'],
        );
    });

    it('runShutdown é idempotente (não executa duas vezes)', async () => {
        let calls = 0;
        registerShutdownHandler(
            'counter',
            async () => {
                calls++;
            },
            10,
        );

        await runShutdown('first');
        await runShutdown('second');

        assert.equal(calls, 1);
    });

    it('runShutdown compartilha a promise em chamadas concorrentes', async () => {
        let calls = 0;
        /** @type {() => void} */
        let release = () => {};
        const blocker = new Promise((resolve) => {
            release = () => resolve(undefined);
        });
        registerShutdownHandler(
            'single-flight',
            async () => {
                calls++;
                await blocker;
            },
            10,
        );

        const first = runShutdown('first');
        const second = runShutdown('second');
        assert.equal(first, second);

        let secondResolved = false;
        second.then(() => {
            secondResolved = true;
        });
        await new Promise((resolve) => setImmediate(resolve));

        assert.equal(calls, 1);
        assert.equal(secondResolved, false);

        release();
        await Promise.all([first, second]);
        assert.equal(secondResolved, true);
    });

    it('registerShutdownHandler substitui handler existente com mesmo nome', async () => {
        /** @type {string[]} */
        const calls = [];

        registerShutdownHandler(
            'same',
            async () => {
                calls.push('old');
            },
            30,
        );
        registerShutdownHandler(
            'same',
            async () => {
                calls.push('new');
            },
            10,
        );

        await runShutdown('test');

        assert.deepEqual(calls, ['new']);
        assert.deepEqual(listShutdownHandlers(), [{ name: 'same', priority: 10, timeoutMs: 5000 }]);
    });

    it('handler que falha não impede execução dos próximos', async () => {
        /** @type {string[]} */
        const order = [];

        registerShutdownHandler(
            'fail',
            async () => {
                throw new Error('crash');
            },
            10,
        );
        registerShutdownHandler(
            'ok',
            async () => {
                order.push('ok');
            },
            20,
        );

        await runShutdown('test');

        assert.deepEqual(order, ['ok']);
        assert.equal(getLastShutdownReport()?.failedCount, 1);
        assert.equal(getLastShutdownReport()?.handlers[0]?.status, 'failed');
    });

    it('handler com timeout de 5s não bloqueia shutdown', async () => {
        registerShutdownHandler('slow', () => new Promise((resolve) => setTimeout(resolve, 10_000)), 10);

        const start = Date.now();
        await runShutdown('test');
        const elapsed = Date.now() - start;

        // Deve completar em ~5s (timeout do handler), não 10s
        assert.ok(elapsed < 7_000, `Shutdown levou ${elapsed}ms, deveria ser < 7000ms`);
        assert.equal(getLastShutdownReport()?.timeoutCount, 1);
        assert.equal(getLastShutdownReport()?.handlers[0]?.status, 'timeout');
    });

    it('permite timeout customizado por handler para drenagem controlada', async () => {
        let completed = false;
        registerShutdownHandler(
            'drain',
            async () => {
                await new Promise((resolve) => setTimeout(resolve, 30));
                completed = true;
            },
            10,
            { timeoutMs: 100 },
        );

        await runShutdown('test');

        assert.equal(completed, true);
        const report = getLastShutdownReport();
        assert.equal(report?.reason, 'test');
        assert.equal(report?.handlerCount, 1);
        assert.equal(report?.okCount, 1);
        assert.equal(report?.failedCount, 0);
        assert.equal(report?.timeoutCount, 0);
        assert.equal(report?.handlers[0]?.name, 'drain');
    });

    it('emite eventos estruturados de lifecycle sem bloquear shutdown', async () => {
        /** @type {string[]} */
        const events = [];
        setShutdownEventEmitter((event) => {
            events.push(event.type);
            if (event.type === 'runtime.shutdown.handler_failed') {
                throw new Error('observer down');
            }
        });
        registerShutdownHandler(
            'fail',
            async () => {
                throw new Error('boom');
            },
            10,
        );
        registerShutdownHandler('ok', async () => {}, 20);

        await runShutdown('events');

        assert.deepEqual(events, [
            'runtime.shutdown.started',
            'runtime.shutdown.handler_failed',
            'runtime.shutdown.completed',
        ]);
        assert.equal(getLastShutdownReport()?.failedCount, 1);
    });
});
