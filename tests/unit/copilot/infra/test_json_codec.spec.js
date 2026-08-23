// @ts-check
import { parseJsonResult, parseJsonStrict, stringifyJsonStrict } from '#copilot/infra/public/platform/json';
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

describe('infra platform JSON codec', () => {
    it('parseJsonResult distinguishes valid and invalid JSON without throwing', () => {
        assert.deepEqual(parseJsonResult('{"a":1}'), { ok: true, data: { a: 1 } });
        const invalid = parseJsonResult('{bad}', 'codec-test');
        assert.equal(invalid.ok, false);
        assert.ok(!invalid.ok && invalid.error instanceof SyntaxError);
        assert.match(!invalid.ok ? invalid.error.message : '', /codec-test/u);
    });

    it('parseJsonStrict throws SyntaxError with cause on invalid JSON', () => {
        assert.deepEqual(parseJsonStrict('[1,2,3]'), [1, 2, 3]);
        assert.throws(() => parseJsonStrict('bad', 'strict-test'), SyntaxError);
    });

    it('stringifyJsonStrict always returns string or throws', () => {
        assert.equal(stringifyJsonStrict({ a: 1 }), '{"a":1}');
        assert.equal(stringifyJsonStrict(null), 'null');
        assert.throws(() => stringifyJsonStrict(undefined), TypeError);
        const cyclic = {};
        cyclic.self = cyclic;
        assert.throws(() => stringifyJsonStrict(cyclic), TypeError);
    });
});
