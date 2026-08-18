// @ts-check

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { sha256 } from '../../../../src/copilot/infra/shared/hash.js';

/** @param {string | Buffer | Uint8Array} value */
function legacySha256(value) {
    return createHash('sha256').update(value).digest('hex');
}

describe('infra/shared/hash', () => {
    it('preserva vetores SHA-256 conhecidos', () => {
        expect(sha256('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
        expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    });

    it('permanece equivalente ao createHash para strings, unicode, Buffer e Uint8Array', () => {
        const inputs = [
            'workspace-io-node24',
            'latência · segurança · coerência 🚀',
            Buffer.from('buffer-payload\u0000with-null', 'utf8'),
            new Uint8Array([0, 1, 2, 3, 127, 128, 254, 255]),
        ];

        for (const input of inputs) expect(sha256(input)).toBe(legacySha256(input));
    });

    it('preserva identidade em payload one-shot de 1 MiB', () => {
        const payload = Buffer.alloc(1024 * 1024, 0x61);
        expect(sha256(payload)).toBe(legacySha256(payload));
    });
});
