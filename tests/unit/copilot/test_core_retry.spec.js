// @ts-check
/**
 * tests/unit/copilot/test_core_retry.spec.js
 *
 * Testes unitários — core/retry.js: withRetry com backoff exponencial + jitter.
 */

import assert from 'node:assert/strict';

import { withRetry } from '../../../src/copilot/core/retry.js';

describe('core/retry.js › withRetry', () => {
    it('retorna resultado na primeira tentativa se fn sucede', async () => {
        const result = await withRetry(() => Promise.resolve(42));
        assert.equal(result, 42);
    });

    it('faz retry até maxAttempts em caso de falha', async () => {
        let calls = 0;
        await assert.rejects(
            () =>
                withRetry(
                    () => {
                        calls++;
                        return Promise.reject(new Error('fail'));
                    },
                    { maxAttempts: 3, baseDelayMs: 1, jitter: false },
                ),
            { message: 'fail' },
        );
        assert.equal(calls, 3);
    });

    it('retorna resultado se fn sucede após falhas', async () => {
        let calls = 0;
        const result = await withRetry(
            () => {
                calls++;
                if (calls < 3) return Promise.reject(new Error('fail'));
                return Promise.resolve('ok');
            },
            { maxAttempts: 5, baseDelayMs: 1, jitter: false },
        );
        assert.equal(result, 'ok');
        assert.equal(calls, 3);
    });

    it('chama onRetry antes de cada retry', async () => {
        /** @type {number[]} */
        const attempts = [];
        await assert.rejects(
            () =>
                withRetry(() => Promise.reject(new Error('boom')), {
                    maxAttempts: 3,
                    baseDelayMs: 1,
                    jitter: false,
                    onRetry: (_err, attempt) => attempts.push(attempt),
                }),
            { message: 'boom' },
        );
        assert.deepEqual(attempts, [1, 2]);
    });

    it('respeita shouldRetry para abortar retry em erros não retentáveis', async () => {
        let calls = 0;
        await assert.rejects(
            () =>
                withRetry(
                    () => {
                        calls++;
                        return Promise.reject(new Error('permanent'));
                    },
                    {
                        maxAttempts: 5,
                        baseDelayMs: 1,
                        jitter: false,
                        shouldRetry: () => false,
                    },
                ),
            { message: 'permanent' },
        );
        assert.equal(calls, 1);
    });

    it('aborta se signal já estiver aborted', async () => {
        const controller = new AbortController();
        controller.abort(new Error('already aborted'));

        await assert.rejects(() => withRetry(() => Promise.resolve(1), { signal: controller.signal }), {
            message: 'already aborted',
        });
    });

    it('aborta durante delay entre retries', async () => {
        const controller = new AbortController();
        let calls = 0;

        const promise = withRetry(
            () => {
                calls++;
                if (calls === 1) {
                    // Abortar durante o delay
                    setTimeout(() => controller.abort(new Error('cancelled')), 5);
                }
                return Promise.reject(new Error('fail'));
            },
            { maxAttempts: 5, baseDelayMs: 100, jitter: false, signal: controller.signal },
        );

        await assert.rejects(promise, { message: 'cancelled' });
        assert.equal(calls, 1);
    });
});
