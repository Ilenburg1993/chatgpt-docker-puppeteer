// @ts-check
/**
 * tests/unit/copilot/test_core_circuit_breaker.spec.js
 *
 * Testes unitários — sdk/session/circuit-breaker.js: estados, transições, threshold.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { CircuitBreaker, CircuitOpenError } from '../../../../src/copilot/sdk/session/circuit-breaker.js';

describe('sdk/session/circuit-breaker.js › CircuitBreaker', () => {
    it('começa no estado closed', () => {
        const cb = new CircuitBreaker('test');
        assert.equal(cb.getState(), 'closed');
    });

    it('executa fn normalmente quando closed', async () => {
        const cb = new CircuitBreaker('test');
        const result = await cb.execute(() => Promise.resolve(42));
        assert.equal(result, 42);
        assert.equal(cb.getState(), 'closed');
    });

    it('propaga erro da fn quando closed', async () => {
        const cb = new CircuitBreaker('test', { failThreshold: 5 });
        await assert.rejects(() => cb.execute(() => Promise.reject(new Error('boom'))), { message: 'boom' });
        assert.equal(cb.getState(), 'closed');
    });

    it('transita para open após failThreshold falhas consecutivas', async () => {
        const cb = new CircuitBreaker('test', { failThreshold: 3 });
        for (let i = 0; i < 3; i++) {
            await cb.execute(() => Promise.reject(new Error('fail'))).catch(() => {});
        }
        assert.equal(cb.getState(), 'open');
    });

    it('lança CircuitOpenError quando open', async () => {
        const cb = new CircuitBreaker('test', { failThreshold: 1 });
        await cb.execute(() => Promise.reject(new Error('fail'))).catch(() => {});
        assert.equal(cb.getState(), 'open');
        await assert.rejects(
            () => cb.execute(() => Promise.resolve(1)),
            (err) => err instanceof CircuitOpenError,
        );
    });

    it('transita para half-open após resetTimeout', async () => {
        const cb = new CircuitBreaker('test', { failThreshold: 1, resetTimeoutMs: 10 });
        await cb.execute(() => Promise.reject(new Error('fail'))).catch(() => {});
        assert.equal(cb.getState(), 'open');

        // Wait for reset timeout
        await new Promise((r) => setTimeout(r, 15));

        const result = await cb.execute(() => Promise.resolve('recovered'));
        assert.equal(result, 'recovered');
        assert.equal(cb.getState(), 'closed');
    });

    it('reabre circuito se falha em half-open', async () => {
        const cb = new CircuitBreaker('test', { failThreshold: 1, resetTimeoutMs: 10, halfOpenMax: 1 });
        await cb.execute(() => Promise.reject(new Error('fail'))).catch(() => {});
        assert.equal(cb.getState(), 'open');

        await new Promise((r) => setTimeout(r, 15));

        // Half-open: primeira tentativa falha
        await cb.execute(() => Promise.reject(new Error('still failing'))).catch(() => {});
        assert.equal(cb.getState(), 'open');
    });

    it('reseta contadores após sucesso', async () => {
        const cb = new CircuitBreaker('test', { failThreshold: 3 });
        // 2 falhas (não atinge threshold)
        await cb.execute(() => Promise.reject(new Error('f1'))).catch(() => {});
        await cb.execute(() => Promise.reject(new Error('f2'))).catch(() => {});
        // 1 sucesso reseta contadores
        await cb.execute(() => Promise.resolve('ok'));
        // 2 more falhas (não atinge threshold porque resetou)
        await cb.execute(() => Promise.reject(new Error('f3'))).catch(() => {});
        await cb.execute(() => Promise.reject(new Error('f4'))).catch(() => {});
        assert.equal(cb.getState(), 'closed');
    });

    it('reset() volta ao estado initial', async () => {
        const cb = new CircuitBreaker('test', { failThreshold: 1 });
        await cb.execute(() => Promise.reject(new Error('fail'))).catch(() => {});
        assert.equal(cb.getState(), 'open');
        cb.reset();
        assert.equal(cb.getState(), 'closed');
        const result = await cb.execute(() => Promise.resolve(99));
        assert.equal(result, 99);
    });

    it('halfOpenMax limita tentativas em half-open', async () => {
        const cb = new CircuitBreaker('test', { failThreshold: 1, resetTimeoutMs: 10, halfOpenMax: 2 });
        await cb.execute(() => Promise.reject(new Error('fail'))).catch(() => {});

        await new Promise((r) => setTimeout(r, 15));

        // half-open: attempt 1 ok
        await cb.execute(() => Promise.resolve('ok1'));
        assert.equal(cb.getState(), 'closed');
    });

    it('CircuitOpenError tem código CIRCUIT_OPEN', () => {
        const err = new CircuitOpenError('my-breaker');
        assert.equal(err.code, 'CIRCUIT_OPEN');
        assert.ok(err.message.includes('my-breaker'));
    });

    it('guard() e recordFailure()/recordSuccess() permitem controle manual do circuito', async () => {
        const cb = new CircuitBreaker('test', { failThreshold: 2, resetTimeoutMs: 10 });

        cb.guard();
        cb.recordFailure();
        assert.equal(cb.getState(), 'closed');

        cb.guard();
        cb.recordFailure();
        assert.equal(cb.getState(), 'open');

        await assert.rejects(
            () => Promise.resolve().then(() => cb.guard()),
            (err) => err instanceof CircuitOpenError,
        );

        await new Promise((r) => setTimeout(r, 15));
        cb.guard();
        assert.equal(cb.getState(), 'half-open');
        cb.recordSuccess();
        assert.equal(cb.getState(), 'closed');
    });
});
