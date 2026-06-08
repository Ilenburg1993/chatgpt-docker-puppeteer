// @ts-check

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { redactSecretRecord, redactSecretText } from '../../../../src/copilot/core/security/redaction.js';

describe('core/security redaction', () => {
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
});
