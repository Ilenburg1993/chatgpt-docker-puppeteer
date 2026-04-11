// @ts-check
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { EventBus, createEventBus } from '../../../src/copilot/core/event-bus.js';

/**
 * Helper: cria evento mínimo.
 *
 * @param {string} type
 * @param {Record<string, unknown>} [extra]
 * @returns {import('../../../src/copilot/types/events.js').BaseEvent}
 */
function evt(type, extra = {}) {
    return { type, timestamp: Date.now(), ...extra };
}

// ═════════════════════════════════════════════════════════════════════════════
// createEventBus
// ═════════════════════════════════════════════════════════════════════════════

describe('core/event-bus.js › createEventBus', () => {
    it('retorna instância de EventBus', () => {
        const bus = createEventBus();
        assert.ok(bus instanceof EventBus);
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// on / emit
// ═════════════════════════════════════════════════════════════════════════════

describe('core/event-bus.js › on + emit', () => {
    it('handler recebe evento emitido', () => {
        const bus = createEventBus();
        /** @type {unknown[]} */
        const received = [];
        bus.on('test:foo', (e) => received.push(e));
        const e = evt('test:foo');
        bus.emit(e);
        assert.equal(received.length, 1);
        assert.strictEqual(received[0], e);
    });

    it('handler não recebe evento de tipo diferente', () => {
        const bus = createEventBus();
        /** @type {unknown[]} */
        const received = [];
        bus.on('test:foo', (e) => received.push(e));
        bus.emit(evt('test:bar'));
        assert.equal(received.length, 0);
    });

    it('múltiplos handlers para mesmo tipo', () => {
        const bus = createEventBus();
        let count = 0;
        bus.on('x:y', () => count++);
        bus.on('x:y', () => count++);
        bus.emit(evt('x:y'));
        assert.equal(count, 2);
    });

    it('rejeita eventType vazio', () => {
        const bus = createEventBus();
        assert.throws(() => bus.on('', () => {}), /non-empty string/);
    });

    it('rejeita handler não-função', () => {
        const bus = createEventBus();
        // @ts-expect-error — teste intencional
        assert.throws(() => bus.on('x:y', 'nope'), /function/);
    });

    it('rejeita emit sem type', () => {
        const bus = createEventBus();
        // @ts-expect-error — teste intencional
        assert.throws(() => bus.emit({}), /type/);
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// unsubscribe
// ═════════════════════════════════════════════════════════════════════════════

describe('core/event-bus.js › unsubscribe', () => {
    it('on retorna função de unsubscribe', () => {
        const bus = createEventBus();
        let count = 0;
        const unsub = bus.on('a:b', () => count++);
        bus.emit(evt('a:b'));
        assert.equal(count, 1);
        unsub();
        bus.emit(evt('a:b'));
        assert.equal(count, 1);
    });

    it('unsubscribe é idempotente', () => {
        const bus = createEventBus();
        const unsub = bus.on('a:b', () => {});
        unsub();
        unsub(); // não deve lançar
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// once
// ═════════════════════════════════════════════════════════════════════════════

describe('core/event-bus.js › once', () => {
    it('handler é chamado apenas uma vez', () => {
        const bus = createEventBus();
        let count = 0;
        bus.once('x:y', () => count++);
        bus.emit(evt('x:y'));
        bus.emit(evt('x:y'));
        assert.equal(count, 1);
    });

    it('once retorna unsubscribe funcional', () => {
        const bus = createEventBus();
        let count = 0;
        const unsub = bus.once('x:y', () => count++);
        unsub();
        bus.emit(evt('x:y'));
        assert.equal(count, 0);
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// wildcards
// ═════════════════════════════════════════════════════════════════════════════

describe('core/event-bus.js › wildcards', () => {
    it('namespace wildcard session:* captura session:start', () => {
        const bus = createEventBus();
        /** @type {string[]} */
        const types = [];
        bus.on('session:*', (e) => types.push(e.type));
        bus.emit(evt('session:start'));
        bus.emit(evt('session:end'));
        bus.emit(evt('tool:invoke'));
        assert.deepStrictEqual(types, ['session:start', 'session:end']);
    });

    it('catch-all * captura todos os eventos', () => {
        const bus = createEventBus();
        let count = 0;
        bus.on('*', () => count++);
        bus.emit(evt('a:x'));
        bus.emit(evt('b:y'));
        bus.emit(evt('c:z'));
        assert.equal(count, 3);
    });

    it('handler exato + wildcard + catch-all recebem o mesmo evento', () => {
        const bus = createEventBus();
        /** @type {string[]} */
        const log = [];
        bus.on('tool:invoke', () => log.push('exact'));
        bus.on('tool:*', () => log.push('wildcard'));
        bus.on('*', () => log.push('catchall'));
        bus.emit(evt('tool:invoke'));
        assert.deepStrictEqual(log, ['exact', 'wildcard', 'catchall']);
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// middleware
// ═════════════════════════════════════════════════════════════════════════════

describe('core/event-bus.js › middleware', () => {
    it('middleware é chamado antes dos handlers', () => {
        const bus = createEventBus();
        /** @type {string[]} */
        const order = [];
        bus.use((_event, next) => { order.push('mw'); next(); });
        bus.on('a:b', () => order.push('handler'));
        bus.emit(evt('a:b'));
        assert.deepStrictEqual(order, ['mw', 'handler']);
    });

    it('middleware pode bloquear entrega não chamando next()', () => {
        const bus = createEventBus();
        let delivered = false;
        bus.use((_event, _next) => { /* não chama next */ });
        bus.on('a:b', () => { delivered = true; });
        bus.emit(evt('a:b'));
        assert.equal(delivered, false);
    });

    it('middleware chain é executada em ordem', () => {
        const bus = createEventBus();
        /** @type {number[]} */
        const order = [];
        bus.use((_e, next) => { order.push(1); next(); });
        bus.use((_e, next) => { order.push(2); next(); });
        bus.use((_e, next) => { order.push(3); next(); });
        bus.on('x:y', () => order.push(4));
        bus.emit(evt('x:y'));
        assert.deepStrictEqual(order, [1, 2, 3, 4]);
    });

    it('rejeita middleware não-função', () => {
        const bus = createEventBus();
        // @ts-expect-error — teste intencional
        assert.throws(() => bus.use('nope'), /function/);
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// counters / stats
// ═════════════════════════════════════════════════════════════════════════════

describe('core/event-bus.js › count + stats', () => {
    it('count retorna 0 para evento nunca emitido', () => {
        const bus = createEventBus();
        assert.equal(bus.count('nope:x'), 0);
    });

    it('count incrementa com cada emit', () => {
        const bus = createEventBus();
        bus.emit(evt('a:b'));
        bus.emit(evt('a:b'));
        bus.emit(evt('a:b'));
        assert.equal(bus.count('a:b'), 3);
    });

    it('stats retorna snapshot de contadores', () => {
        const bus = createEventBus();
        bus.emit(evt('a:x'));
        bus.emit(evt('b:y'));
        bus.emit(evt('a:x'));
        const s = bus.stats();
        assert.equal(s['a:x'], 2);
        assert.equal(s['b:y'], 1);
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// listenerCount
// ═════════════════════════════════════════════════════════════════════════════

describe('core/event-bus.js › listenerCount', () => {
    it('inicia em 0', () => {
        const bus = createEventBus();
        assert.equal(bus.listenerCount, 0);
    });

    it('incrementa com on', () => {
        const bus = createEventBus();
        bus.on('a:b', () => {});
        bus.on('a:b', () => {});
        bus.on('c:d', () => {});
        assert.equal(bus.listenerCount, 3);
    });

    it('decrementa com unsubscribe', () => {
        const bus = createEventBus();
        const u1 = bus.on('a:b', () => {});
        bus.on('a:b', () => {});
        u1();
        assert.equal(bus.listenerCount, 1);
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// dispose
// ═════════════════════════════════════════════════════════════════════════════

describe('core/event-bus.js › dispose', () => {
    it('limpa listeners, middleware e contadores', () => {
        const bus = createEventBus();
        bus.on('a:b', () => {});
        bus.use((_e, next) => next());
        bus.emit(evt('a:b'));
        bus.dispose();
        assert.equal(bus.listenerCount, 0);
        assert.equal(bus.count('a:b'), 0);
        assert.deepStrictEqual(bus.stats(), {});
    });

    it('emit após dispose é silencioso (não lança)', () => {
        const bus = createEventBus();
        bus.dispose();
        bus.emit(evt('a:b')); // não deve lançar
    });

    it('on após dispose lança', () => {
        const bus = createEventBus();
        bus.dispose();
        assert.throws(() => bus.on('a:b', () => {}), /disposed/);
    });

    it('use após dispose lança', () => {
        const bus = createEventBus();
        bus.dispose();
        assert.throws(() => bus.use((_e, n) => n()), /disposed/);
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// error isolation
// ═════════════════════════════════════════════════════════════════════════════

describe('core/event-bus.js › error isolation', () => {
    it('erro em handler não impede entrega a outros handlers', () => {
        const bus = createEventBus();
        let reached = false;
        bus.on('a:b', () => { throw new Error('boom'); });
        bus.on('a:b', () => { reached = true; });
        bus.emit(evt('a:b'));
        assert.ok(reached);
    });
});
