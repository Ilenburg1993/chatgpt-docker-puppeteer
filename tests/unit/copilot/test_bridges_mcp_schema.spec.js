// @ts-check
/**
 * tests/unit/copilot/test_bridges_mcp_schema.spec.js
 *
 * Testes unitários para src/copilot/bridges/mcp-tool-schema.js (buildZodSchema).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('buildZodSchema — parse básico', () => {
    it('retorna schema Zod para tipo string', async () => {
        const { buildZodSchema } = await import('../../../src/copilot/bridges/mcp-tool-schema.js');
        const schema = buildZodSchema({ type: 'string', description: 'Nome' }, new Set(), 'name');
        assert.ok(schema, 'Deve retornar schema não-nulo');
        // Schema Zod deve ter método .parse
        assert.equal(typeof schema.parse, 'function', 'Schema deve ter .parse');
    });

    it('parse aceita string válida em schema string', async () => {
        const { buildZodSchema } = await import('../../../src/copilot/bridges/mcp-tool-schema.js');
        const schema = buildZodSchema({ type: 'string' }, new Set(), 'x');
        assert.doesNotThrow(() => schema.parse('hello'), 'String válida não deve lançar');
    });

    it('retorna schema Zod para tipo number', async () => {
        const { buildZodSchema } = await import('../../../src/copilot/bridges/mcp-tool-schema.js');
        const schema = buildZodSchema({ type: 'number' }, new Set(), 'count');
        assert.equal(typeof schema.parse, 'function');
        assert.doesNotThrow(() => schema.parse(42), 'Número válido não deve lançar');
    });

    it('retorna schema Zod para tipo boolean', async () => {
        const { buildZodSchema } = await import('../../../src/copilot/bridges/mcp-tool-schema.js');
        const schema = buildZodSchema({ type: 'boolean' }, new Set(), 'flag');
        assert.doesNotThrow(() => schema.parse(true), 'Boolean válido não deve lançar');
    });

    it('retorna schema Zod para tipo object com properties', async () => {
        const { buildZodSchema } = await import('../../../src/copilot/bridges/mcp-tool-schema.js');
        const jsonSchema = {
            type: 'object',
            properties: {
                name: { type: 'string' },
                age: { type: 'number' },
            },
            required: ['name'],
        };
        const schema = buildZodSchema(jsonSchema, new Set(), 'person');
        assert.ok(schema, 'Schema de objeto deve ser retornado');
        assert.doesNotThrow(() => schema.parse({ name: 'Alice', age: 30 }), 'Objeto válido não deve lançar');
    });
});
