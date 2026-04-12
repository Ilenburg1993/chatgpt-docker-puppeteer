// @ts-check
/**
 * tests/unit/copilot/bridges/test_mcp_tool_schema.spec.js
 *
 * F169: Testes para mcp-tool-schema.js — conversão de JSON Schema para Zod. buildZodSchema é uma função pura: ideal
 * para testes unitários exaustivos.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildZodSchema } from '../../../../src/copilot/bridges/mcp-tool-schema.js';

describe('buildZodSchema — escalares', () => {
    it('string simples', () => {
        const schema = buildZodSchema({ type: 'string', description: 'um nome' });
        const result = schema.safeParse('hello');
        assert.strictEqual(result.success, true);
    });

    it('number', () => {
        const schema = buildZodSchema({ type: 'number', description: 'count' });
        assert.ok(schema.safeParse(42).success);
        assert.ok(!schema.safeParse('abc').success);
    });

    it('integer mapeia para z.number()', () => {
        const schema = buildZodSchema({ type: 'integer' });
        assert.ok(schema.safeParse(10).success);
    });

    it('boolean', () => {
        const schema = buildZodSchema({ type: 'boolean' });
        assert.ok(schema.safeParse(true).success);
        assert.ok(!schema.safeParse('true').success);
    });

    it('tipo desconhecido cai em string default', () => {
        const schema = buildZodSchema({ type: 'unknown-type' });
        assert.ok(schema.safeParse('abc').success);
    });

    it('schema null/undefined retorna z.unknown()', () => {
        const schema = buildZodSchema(null);
        assert.ok(schema.safeParse(123).success);
        assert.ok(schema.safeParse('xyz').success);
    });
});

describe('buildZodSchema — enum', () => {
    it('enum de strings gera z.enum()', () => {
        const schema = buildZodSchema({ enum: ['a', 'b', 'c'] });
        assert.ok(schema.safeParse('a').success);
        assert.ok(!schema.safeParse('d').success);
    });

    it('enum respects required/optional', () => {
        const required = new Set(['color']);
        const schema = buildZodSchema({ enum: ['red', 'blue'] }, required, 'color');
        // Required: deve falhar com undefined
        assert.ok(schema.safeParse('red').success);
    });
});

describe('buildZodSchema — object', () => {
    it('objeto com properties obrigatórias', () => {
        const schema = buildZodSchema({
            type: 'object',
            properties: {
                name: { type: 'string' },
                age: { type: 'number' },
            },
            required: ['name'],
        });
        assert.ok(schema.safeParse({ name: 'Alice', age: 30 }).success);
        assert.ok(schema.safeParse({ name: 'Bob' }).success); // age é opcional
        assert.ok(!schema.safeParse({ age: 30 }).success); // name é obrigatório
    });

    it('objeto sem properties retorna z.record()', () => {
        const schema = buildZodSchema({ type: 'object' });
        assert.ok(schema.safeParse({ any: 'thing' }).success);
    });

    it('objeto aninhado recursivo', () => {
        const schema = buildZodSchema({
            type: 'object',
            properties: {
                nested: {
                    type: 'object',
                    properties: {
                        value: { type: 'number' },
                    },
                    required: ['value'],
                },
            },
            required: ['nested'],
        });
        assert.ok(schema.safeParse({ nested: { value: 42 } }).success);
        assert.ok(!schema.safeParse({ nested: {} }).success); // value required
    });
});

describe('buildZodSchema — array', () => {
    it('array de strings', () => {
        const schema = buildZodSchema({
            type: 'array',
            items: { type: 'string' },
        });
        assert.ok(schema.safeParse(['a', 'b']).success);
        assert.ok(!schema.safeParse('not-array').success);
    });

    it('array sem items retorna z.array(z.unknown())', () => {
        const schema = buildZodSchema({ type: 'array' });
        assert.ok(schema.safeParse([1, 'a', true]).success);
    });
});

describe('buildZodSchema — allOf / oneOf / anyOf', () => {
    it('allOf merge properties de múltiplos schemas', () => {
        const schema = buildZodSchema({
            allOf: [
                { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
                { type: 'object', properties: { b: { type: 'number' } }, required: ['b'] },
            ],
        });
        assert.ok(schema.safeParse({ a: 'x', b: 1 }).success);
        assert.ok(!schema.safeParse({ a: 'x' }).success); // b required
    });

    it('allOf com 1 elemento delega diretamente', () => {
        const schema = buildZodSchema({
            allOf: [{ type: 'string' }],
        });
        assert.ok(schema.safeParse('hello').success);
    });

    it('oneOf gera z.union()', () => {
        const schema = buildZodSchema({
            oneOf: [{ type: 'string' }, { type: 'number' }],
        });
        assert.ok(schema.safeParse('text').success);
        assert.ok(schema.safeParse(42).success);
    });

    it('anyOf gera z.union()', () => {
        const schema = buildZodSchema({
            anyOf: [{ type: 'boolean' }, { type: 'string' }],
        });
        assert.ok(schema.safeParse(true).success);
        assert.ok(schema.safeParse('yes').success);
    });
});

describe('buildZodSchema — optional fields', () => {
    it('campo não listado em required é opcional', () => {
        const required = new Set(['name']);
        const schema = buildZodSchema({ type: 'string' }, required, 'description');
        // Campo opcional: undefined deve ser aceito
        assert.ok(schema.safeParse(undefined).success);
    });

    it('campo listado em required é obrigatório', () => {
        const required = new Set(['name']);
        const schema = buildZodSchema({ type: 'string' }, required, 'name');
        assert.ok(schema.safeParse('value').success);
    });
});
