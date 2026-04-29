// @ts-check
/**
 * tests/unit/copilot/test_core_timer_registry.spec.js
 *
 * Testes unitários — core/timer-registry.js: registro, cancelamento e shutdown de timers.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'vitest';

import {
    _resetForTesting,
    activeCount,
    cancel,
    cancelAll,
    listActiveTimers,
    registerTimer,
} from '../../../src/copilot/core/timer-registry.js';

import { _resetForTesting as resetShutdown } from '../../../src/copilot/core/shutdown.js';

beforeEach(() => {
    _resetForTesting();
    resetShutdown();
});

afterEach(() => {
    _resetForTesting();
    resetShutdown();
});

describe('core/timer-registry.js › registerTimer', () => {
    it('registra um timeout e incrementa activeCount', () => {
        const handle = setTimeout(() => {}, 100_000);
        registerTimer('test-timeout', 'timeout', handle);
        assert.equal(activeCount(), 1);
    });

    it('registra um interval e incrementa activeCount', () => {
        const handle = setInterval(() => {}, 100_000);
        registerTimer('test-interval', 'interval', handle);
        assert.equal(activeCount(), 1);
    });

    it('substitui timer existente com mesmo id', () => {
        const h1 = setTimeout(() => {}, 100_000);
        const h2 = setTimeout(() => {}, 100_000);
        registerTimer('dup', 'timeout', h1);
        registerTimer('dup', 'timeout', h2);
        assert.equal(activeCount(), 1);
    });

    it('retorna o handle passado', () => {
        const handle = setTimeout(() => {}, 100_000);
        const returned = registerTimer('ret', 'timeout', handle);
        assert.equal(returned, handle);
    });
});

describe('core/timer-registry.js › cancel', () => {
    it('cancela timer existente e retorna true', () => {
        const handle = setTimeout(() => {}, 100_000);
        registerTimer('c1', 'timeout', handle);
        assert.equal(cancel('c1'), true);
        assert.equal(activeCount(), 0);
    });

    it('retorna false para timer inexistente', () => {
        assert.equal(cancel('nope'), false);
    });

    it('cancela interval corretamente', () => {
        const handle = setInterval(() => {}, 100_000);
        registerTimer('int1', 'interval', handle);
        assert.equal(cancel('int1'), true);
        assert.equal(activeCount(), 0);
    });
});

describe('core/timer-registry.js › cancelAll', () => {
    it('cancela todos os timers registrados', () => {
        registerTimer(
            'a',
            'timeout',
            setTimeout(() => {}, 100_000),
        );
        registerTimer(
            'b',
            'interval',
            setInterval(() => {}, 100_000),
        );
        registerTimer(
            'c',
            'timeout',
            setTimeout(() => {}, 100_000),
        );
        const cancelled = cancelAll();
        assert.equal(cancelled, 3);
        assert.equal(activeCount(), 0);
    });

    it('retorna 0 para registry vazio', () => {
        assert.equal(cancelAll(), 0);
    });
});

describe('core/timer-registry.js › listActiveTimers', () => {
    it('expõe snapshot estável sem handle nativo e ordenado por idade', () => {
        registerTimer(
            'newer',
            'timeout',
            setTimeout(() => {}, 100_000),
        );
        registerTimer(
            'older',
            'interval',
            setInterval(() => {}, 100_000),
        );

        const registeredAt = listActiveTimers().find((timer) => timer.id === 'older')?.registeredAt ?? Date.now();
        const snapshot = listActiveTimers(registeredAt + 5_000);

        assert.equal(snapshot.length, 2);
        assert.equal(snapshot[0]?.id, 'newer');
        assert.equal(Object.hasOwn(snapshot[0] ?? {}, 'handle'), false);
        assert.equal(typeof snapshot[0]?.ageMs, 'number');
    });
});
