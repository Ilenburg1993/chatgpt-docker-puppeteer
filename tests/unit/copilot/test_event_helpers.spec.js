// @ts-check
/**
 * tests/unit/copilot/test_event_helpers.spec.js
 *
 * Testes unitários para src/copilot/lib/event-helpers.js
 *
 * Cobre:
 *
 * - waitForEvent: resolve no evento, timeout, AbortSignal, cleanup de listeners
 * - raceEvents: primeiro evento vence, timeout, AbortSignal, cleanup
 */

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, it } from 'vitest';

import { raceEvents, waitForEvent } from '#copilot/sdk/event-helpers';

// ═══════════════════════════════════════════════════════════════════════════════
// waitForEvent
// ═══════════════════════════════════════════════════════════════════════════════

describe('waitForEvent', () => {
    it('resolve com data do evento', async () => {
        const ee = new EventEmitter();
        const p = waitForEvent(ee, 'done', { timeoutMs: 1000 });
        ee.emit('done', 42);
        const result = await p;
        assert.equal(result, 42);
    });

    it('remove listener após resolve', async () => {
        const ee = new EventEmitter();
        const p = waitForEvent(ee, 'done', { timeoutMs: 1000 });
        ee.emit('done', 'ok');
        await p;
        assert.equal(ee.listenerCount('done'), 0);
    });

    it('rejeita após timeout', async () => {
        const ee = new EventEmitter();
        await assert.rejects(
            () => waitForEvent(ee, 'never', { timeoutMs: 50 }),
            (/** @type {Error} */ err) => {
                assert.match(err.message, /timeout/i);
                return true;
            },
        );
        // Listener deve ter sido removido
        assert.equal(ee.listenerCount('never'), 0);
    });

    it('usa timeoutError customizado', async () => {
        const ee = new EventEmitter();
        await assert.rejects(
            () => waitForEvent(ee, 'x', { timeoutMs: 50, timeoutError: 'Falhou custom' }),
            (/** @type {Error} */ err) => {
                assert.match(err.message, /Falhou custom/);
                return true;
            },
        );
    });

    it('rejeita imediatamente com signal já abortado', async () => {
        const ee = new EventEmitter();
        const ac = new AbortController();
        ac.abort();
        await assert.rejects(
            () => waitForEvent(ee, 'done', { signal: ac.signal }),
            (/** @type {DOMException} */ err) => {
                assert.equal(err.name, 'AbortError');
                return true;
            },
        );
    });

    it('rejeita quando signal aborta durante espera', async () => {
        const ee = new EventEmitter();
        const ac = new AbortController();
        const p = waitForEvent(ee, 'done', { timeoutMs: 5000, signal: ac.signal });
        setTimeout(() => ac.abort(), 20);
        await assert.rejects(p, (/** @type {DOMException} */ err) => {
            assert.equal(err.name, 'AbortError');
            return true;
        });
        assert.equal(ee.listenerCount('done'), 0);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// raceEvents
// ═══════════════════════════════════════════════════════════════════════════════

describe('raceEvents', () => {
    it('resolve com o primeiro evento que dispara', async () => {
        const ee = new EventEmitter();
        const p = raceEvents(ee, ['ready', 'error'], { timeoutMs: 1000 });
        ee.emit('ready', { ok: true });
        const result = await p;
        assert.equal(result.event, 'ready');
        assert.deepEqual(result.data, { ok: true });
    });

    it('remove todos os listeners após resolve', async () => {
        const ee = new EventEmitter();
        const p = raceEvents(ee, ['a', 'b', 'c'], { timeoutMs: 1000 });
        ee.emit('b', 'win');
        await p;
        assert.equal(ee.listenerCount('a'), 0);
        assert.equal(ee.listenerCount('b'), 0);
        assert.equal(ee.listenerCount('c'), 0);
    });

    it('segundo evento a disparar é ignorado', async () => {
        const ee = new EventEmitter();
        const p = raceEvents(ee, ['x', 'y'], { timeoutMs: 1000 });
        ee.emit('x', 'first');
        ee.emit('y', 'second'); // não deve causar nada
        const result = await p;
        assert.equal(result.event, 'x');
    });

    it('rejeita após timeout', async () => {
        const ee = new EventEmitter();
        await assert.rejects(
            () => raceEvents(ee, ['a', 'b'], { timeoutMs: 50 }),
            (/** @type {Error} */ err) => {
                assert.match(err.message, /timeout/i);
                return true;
            },
        );
        assert.equal(ee.listenerCount('a'), 0);
        assert.equal(ee.listenerCount('b'), 0);
    });

    it('rejeita com signal abortado', async () => {
        const ee = new EventEmitter();
        const ac = new AbortController();
        ac.abort();
        await assert.rejects(
            () => raceEvents(ee, ['a'], { signal: ac.signal }),
            (/** @type {DOMException} */ err) => {
                assert.equal(err.name, 'AbortError');
                return true;
            },
        );
    });

    it('rejeita quando signal aborta durante espera', async () => {
        const ee = new EventEmitter();
        const ac = new AbortController();
        const p = raceEvents(ee, ['a', 'b'], { timeoutMs: 5000, signal: ac.signal });
        setTimeout(() => ac.abort(), 20);
        await assert.rejects(p, (/** @type {DOMException} */ err) => {
            assert.equal(err.name, 'AbortError');
            return true;
        });
    });
});
