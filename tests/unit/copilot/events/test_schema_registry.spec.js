// @ts-check
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'vitest';

import { BUILTIN_SCHEMAS } from '../../../../src/copilot/events/schemas/builtin-schemas.js';
import {
    clearSchemas,
    getAllSchemas,
    getEventSchema,
    registerEventSchema,
    registerEventSchemas,
    schemaCount,
    validateEvent,
} from '../../../../src/copilot/events/schemas/registry.js';

describe('Schema Registry (FAIXA-L18)', () => {
    beforeEach(() => {
        clearSchemas();
    });

    describe('registerEventSchema', () => {
        it('registra e recupera um schema', () => {
            registerEventSchema({
                type: 'test:event',
                required: ['type', 'timestamp', 'foo'],
                fields: { foo: 'string' },
            });
            assert.equal(schemaCount(), 1);
            const s = getEventSchema('test:event');
            assert.ok(s);
            assert.deepEqual(s.required, ['type', 'timestamp', 'foo']);
        });
    });

    describe('registerEventSchemas (batch)', () => {
        it('registra múltiplos schemas', () => {
            registerEventSchemas([
                { type: 'a', required: ['type'] },
                { type: 'b', required: ['type'] },
            ]);
            assert.equal(schemaCount(), 2);
        });
    });

    describe('validateEvent', () => {
        it('passa se nenhum schema registrado para tipo', () => {
            const result = validateEvent({ type: 'unknown', timestamp: 1 });
            assert.equal(result.valid, true);
            assert.equal(result.errors.length, 0);
        });

        it('falha se campo required ausente', () => {
            registerEventSchema({
                type: 'test:ev',
                required: ['type', 'timestamp', 'foo'],
            });
            const result = validateEvent({ type: 'test:ev', timestamp: 1 });
            assert.equal(result.valid, false);
            assert.ok(result.errors[0]?.includes('foo'));
        });

        it('falha se tipo de campo errado', () => {
            registerEventSchema({
                type: 'test:typed',
                required: ['type'],
                fields: { count: 'number' },
            });
            const result = validateEvent({ type: 'test:typed', timestamp: 1, count: 'notANumber' });
            assert.equal(result.valid, false);
            assert.ok(result.errors[0]?.includes('count'));
        });

        it('passa com campos corretos', () => {
            registerEventSchema({
                type: 'test:ok',
                required: ['type', 'timestamp'],
                fields: { name: 'string' },
            });
            const result = validateEvent({ type: 'test:ok', timestamp: 1, name: 'hello' });
            assert.equal(result.valid, true);
        });
    });

    describe('getAllSchemas', () => {
        it('retorna cópia do registry', () => {
            registerEventSchema({ type: 'x', required: ['type'] });
            const all = getAllSchemas();
            assert.equal(all.size, 1);
            // Mutating the copy should not affect registry
            all.delete('x');
            assert.equal(schemaCount(), 1);
        });
    });

    describe('BUILTIN_SCHEMAS', () => {
        it('tem schemas definidos para tipos-chave', () => {
            assert.ok(BUILTIN_SCHEMAS.length >= 20);
            const types = BUILTIN_SCHEMAS.map((s) => s.type);
            assert.ok(types.includes('agent:ready'));
            assert.ok(types.includes('agent:task:completed'));
            assert.ok(types.includes('agent:dialog:turn_end'));
            assert.ok(types.includes('agent:tool:execution_start'));
        });

        it('todos os schemas tem type e required', () => {
            for (const schema of BUILTIN_SCHEMAS) {
                assert.ok(typeof schema.type === 'string' && schema.type.length > 0);
                assert.ok(Array.isArray(schema.required) && schema.required.length > 0);
            }
        });

        it('registerEventSchemas carrega todos sem erro', () => {
            registerEventSchemas(BUILTIN_SCHEMAS);
            assert.equal(schemaCount(), BUILTIN_SCHEMAS.length);
        });
    });
});
