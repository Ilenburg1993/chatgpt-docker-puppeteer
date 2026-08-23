// @ts-check
import { redactSecretRecord, redactSecretText } from '#copilot/infra/public/observability/redaction';
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

describe('infra observability redaction', () => {
    it('redige tokens GitHub de sessão e campos sensíveis por chave', () => {
        const token = 'ghs_abcdefghijklmnopqrstuvwxyz1234567890';
        assert.equal(redactSecretText(`gitHubToken=${token}`).includes(token), false);
        assert.deepEqual(redactSecretRecord({ gitHubToken: token, nested: { authorization: `Bearer ${token}` } }), {
            gitHubToken: '[redacted]',
            nested: { authorization: '[redacted]' },
        });
    });
    it('não confunde contadores de tokens com segredo', () => {
        assert.deepEqual(redactSecretRecord({ tokens: 42, providerToken: 'sk-testsecret1234567890' }), {
            tokens: 42,
            providerToken: '[redacted]',
        });
    });
    it('redige segredos embutidos em nomes de chave', () => {
        const token = 'ghs_abcdefghijklmnopqrstuvwxyz1234567890';
        const record = redactSecretRecord({ [`metric.${token}`]: 1 });
        assert.equal(JSON.stringify(record).includes(token), false);
        assert.equal(record['metric.[redacted]'], 1);
    });
    it('é cycle-safe e bounded por profundidade/nós/arrays', () => {
        const cyclic = /** @type {Record<string, unknown>} */ ({ token: 'ghs_abcdefghijklmnopqrstuvwxyz1234567890' });
        cyclic['self'] = cyclic;
        const redacted = redactSecretRecord(cyclic);
        assert.equal(redacted['token'], '[redacted]');
        assert.equal(redacted['self'], '[circular]');
        const deep = { a: { b: { c: { d: 1 } } } };
        assert.equal(
            JSON.stringify(redactSecretRecord(deep, { maxDepth: 2 })).includes('redaction-depth-exceeded'),
            true,
        );
        const array = redactSecretRecord({ values: [1, 2, 3, 4] }, { maxArrayItems: 2 });
        assert.deepEqual(array['values'], [1, 2, '[2 item(s) truncated]']);
    });
});
