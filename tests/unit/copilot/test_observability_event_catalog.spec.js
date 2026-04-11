// @ts-check
/**
 * tests/unit/copilot/test_observability_event_catalog.spec.js
 *
 * Testes unitários para src/copilot/observability/event-catalog.js.
 */

import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

describe('event-catalog', () => {
    beforeEach(async () => {
        const { clearDeadLetters } = await import('../../../src/copilot/observability/event-catalog.js');
        clearDeadLetters();
    });

    it('getCatalog retorna objeto com catálogo de eventos', async () => {
        const { getCatalog } = await import('../../../src/copilot/observability/event-catalog.js');
        const catalog = getCatalog();
        assert.ok(catalog !== null && typeof catalog === 'object', 'getCatalog deve retornar objeto');
    });

    it('getDeadLetters retorna array vazio após clearDeadLetters', async () => {
        const { getDeadLetters } = await import('../../../src/copilot/observability/event-catalog.js');
        const letters = getDeadLetters();
        assert.ok(Array.isArray(letters), 'getDeadLetters deve retornar array');
        assert.equal(letters.length, 0, 'Deve estar vazio após clear');
    });

    it('recordDeadLetter adiciona uma dead letter', async () => {
        const { recordDeadLetter, getDeadLetters } =
            await import('../../../src/copilot/observability/event-catalog.js');
        recordDeadLetter('test:event');
        const letters = getDeadLetters();
        assert.ok(letters.length >= 1, 'Deve ter pelo menos 1 dead letter');
    });

    it('getDeadLetters com limite respeita o parâmetro', async () => {
        const { recordDeadLetter, getDeadLetters } =
            await import('../../../src/copilot/observability/event-catalog.js');
        recordDeadLetter('ev:1');
        recordDeadLetter('ev:2');
        recordDeadLetter('ev:3');
        const limited = getDeadLetters(2);
        assert.ok(limited.length <= 2, 'Deve respeitar o limite de 2');
    });
});
