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
    isShuttingDown,
    registerShutdownHandler,
    runShutdown,
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
    });

    it('handler com timeout de 5s não bloqueia shutdown', async () => {
        registerShutdownHandler('slow', () => new Promise((resolve) => setTimeout(resolve, 10_000)), 10);

        const start = Date.now();
        await runShutdown('test');
        const elapsed = Date.now() - start;

        // Deve completar em ~5s (timeout do handler), não 10s
        assert.ok(elapsed < 7_000, `Shutdown levou ${elapsed}ms, deveria ser < 7000ms`);
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
    });
});
