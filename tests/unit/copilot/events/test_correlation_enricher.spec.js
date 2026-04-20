// @ts-check
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { correlationEnricher } from '../../../../src/copilot/events/middleware/correlation-enricher.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * @param {string} type
 * @param {Record<string, unknown>} [extra]
 * @returns {import('../../../../src/copilot/events/legacy-events.js').BaseEvent}
 */
function evt(type, extra = {}) {
    return { type, timestamp: Date.now(), ...extra };
}

describe('middleware/correlation-enricher (FAIXA-L16)', () => {
    it('gera correlationId UUID v4 quando ausente', () => {
        const event = evt('test:foo');
        let called = false;
        correlationEnricher(event, () => {
            called = true;
        });
        assert.ok(called, 'next() deve ser chamado');
        assert.ok(typeof event.correlationId === 'string', 'correlationId deve ser string');
        assert.ok(UUID_RE.test(event.correlationId), `correlationId deve ser UUID: ${event.correlationId}`);
    });

    it('preserva correlationId existente', () => {
        const event = evt('test:bar', { correlationId: 'existing-id-123' });
        correlationEnricher(event, () => {});
        assert.equal(event.correlationId, 'existing-id-123');
    });

    it('gera IDs diferentes para eventos diferentes', () => {
        const e1 = evt('test:a');
        const e2 = evt('test:b');
        correlationEnricher(e1, () => {});
        correlationEnricher(e2, () => {});
        assert.notEqual(e1.correlationId, e2.correlationId);
    });

    it('chama next() incondicionalmente', () => {
        let nextCalled = 0;
        correlationEnricher(evt('test:c'), () => {
            nextCalled++;
        });
        correlationEnricher(evt('test:d', { correlationId: 'x' }), () => {
            nextCalled++;
        });
        assert.equal(nextCalled, 2);
    });
});
