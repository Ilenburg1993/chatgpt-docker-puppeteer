// @ts-check
/**
 * tests/unit/copilot/test_core_safe_json.spec.js
 *
 * Testes unitários — core/safe-json.js: safeJsonParse, parseJsonOrThrow, safeJsonStringify.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { ValidationError } from '../../../src/copilot/core/errors.js';
import { parseJsonOrThrow, safeJsonParse, safeJsonStringify } from '../../../src/copilot/core/safe-json.js';

describe('core/safe-json.js › safeJsonParse', () => {
    it('parseia JSON válido e retorna { ok: true, data }', () => {
        const result = safeJsonParse('{"a":1}');
        assert.equal(result.ok, true);
        assert.deepEqual(result.ok ? result.data : null, { a: 1 });
    });

    it('retorna { ok: false, error } para JSON inválido', () => {
        const result = safeJsonParse('not json');
        assert.equal(result.ok, false);
        assert.ok(!result.ok && result.error instanceof ValidationError);
    });

    it('inclui context na mensagem de erro quando fornecido', () => {
        const result = safeJsonParse('{bad}', 'test-context');
        assert.equal(result.ok, false);
        assert.ok(!result.ok && result.error.message.includes('test-context'));
    });

    it('parseia array JSON', () => {
        const result = safeJsonParse('[1,2,3]');
        assert.equal(result.ok, true);
        assert.deepEqual(result.ok ? result.data : null, [1, 2, 3]);
    });

    it('parseia string JSON', () => {
        const result = safeJsonParse('"hello"');
        assert.equal(result.ok, true);
        assert.equal(result.ok ? result.data : null, 'hello');
    });

    it('parseia null JSON', () => {
        const result = safeJsonParse('null');
        assert.equal(result.ok, true);
        assert.equal(result.ok ? result.data : null, null);
    });

    it('falha para string vazia', () => {
        const result = safeJsonParse('');
        assert.equal(result.ok, false);
    });
});

describe('core/safe-json.js › parseJsonOrThrow', () => {
    it('retorna dados parseados para JSON válido', () => {
        const data = parseJsonOrThrow('{"x":42}');
        assert.deepEqual(data, { x: 42 });
    });

    it('lança ValidationError para JSON inválido', () => {
        assert.throws(
            () => parseJsonOrThrow('bad'),
            (err) => err instanceof ValidationError,
        );
    });

    it('inclui context na mensagem de erro', () => {
        assert.throws(
            () => parseJsonOrThrow('bad', 'my-ctx'),
            (err) => err instanceof ValidationError && err.message.includes('my-ctx'),
        );
    });
});

describe('core/safe-json.js › safeJsonStringify', () => {
    it('serializa objeto simples', () => {
        assert.equal(safeJsonStringify({ a: 1 }), '{"a":1}');
    });

    it('serializa com indentação', () => {
        const result = safeJsonStringify({ a: 1 }, 2);
        assert.ok(result.includes('\n'));
        assert.ok(result.includes('"a": 1'));
    });

    it('retorna "{}" para referência circular', () => {
        const obj = {};
        /** @type {any} */ (obj).self = obj;
        assert.equal(safeJsonStringify(obj), '{}');
    });

    it('serializa null', () => {
        assert.equal(safeJsonStringify(null), 'null');
    });

    it('serializa array', () => {
        assert.equal(safeJsonStringify([1, 2, 3]), '[1,2,3]');
    });

    it('serializa string', () => {
        assert.equal(safeJsonStringify('hello'), '"hello"');
    });

    it('serializa undefined como undefined (JSON.stringify behavior)', () => {
        assert.equal(safeJsonStringify(undefined), undefined);
    });
});
