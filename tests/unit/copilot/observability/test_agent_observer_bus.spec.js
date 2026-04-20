// @ts-check
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { EMITTER_TO_BUS_TYPE } from '../../../../src/copilot/observability/observers/event-name-map.js';

/**
 * Testa o mapeamento EMITTER_TO_BUS_TYPE — pilar da migração FAIXA-L14.
 *
 * O teste do observer completo (attachToBus) falha por bug preexistente de dependência circular em otel.js. Quando
 * resolvido, expandir este arquivo.
 */
describe('event-name-map › EMITTER_TO_BUS_TYPE (FAIXA-L14)', () => {
    it('mapeia pelo menos 40 eventos do agente', () => {
        const count = Object.keys(EMITTER_TO_BUS_TYPE).length;
        assert.ok(count >= 40, `expected ≥ 40, got ${count}`);
    });

    it('todos os valores seguem namespace :-separated', () => {
        for (const [key, busType] of Object.entries(EMITTER_TO_BUS_TYPE)) {
            assert.ok(busType.includes(':'), `event '${key}' maps to '${busType}' which has no ':' separator`);
        }
    });

    it('não contém valores undefined ou vazios', () => {
        for (const [key, busType] of Object.entries(EMITTER_TO_BUS_TYPE)) {
            assert.ok(busType, `event '${key}' maps to falsy value: ${busType}`);
            assert.ok(typeof busType === 'string', `event '${key}' maps to non-string`);
        }
    });

    it('eventos conhecidos estão presentes no mapa', () => {
        const expected = [
            'dialog.turn_start',
            'dialog.turn_end',
            'dialog.ready',
            'task.started',
            'task.completed',
            'session.fatal',
            'ready',
            'status',
        ];
        for (const name of expected) {
            assert.ok(name in EMITTER_TO_BUS_TYPE, `missing event '${name}' in map`);
        }
    });
});
