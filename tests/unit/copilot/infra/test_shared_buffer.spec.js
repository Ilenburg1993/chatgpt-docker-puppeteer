// @ts-check

import { describe, expect, it } from 'vitest';

import {
    BUFFER_MAX_LENGTH,
    assertBufferByteLengthWithinNodeLimit,
    decodeBase64ToOwnedBuffer,
    toBufferView,
    toOwnedBuffer,
    truncateBufferView,
} from '../../../../src/copilot/infra/shared/buffer.js';

describe('infra/shared/buffer', () => {
    it('toBufferView respeita byteOffset/byteLength de Uint8Array', () => {
        const storage = new Uint8Array([99, 1, 2, 3, 88]);
        const view = new Uint8Array(storage.buffer, 1, 3);

        const result = toBufferView(view);

        expect([...result]).toEqual([1, 2, 3]);
    });

    it('toOwnedBuffer copia a view para evitar alias de memória', () => {
        const storage = new Uint8Array([10, 20, 30]);
        const owned = toOwnedBuffer(storage);

        storage[0] = 99;

        expect([...owned]).toEqual([10, 20, 30]);
    });

    it('truncateBufferView trunca preservando a janela da view', () => {
        const storage = new Uint8Array([9, 8, 7, 6, 5]);
        const view = new Uint8Array(storage.buffer, 1, 3);

        const result = truncateBufferView(view, 2);

        expect([...result]).toEqual([8, 7]);
    });

    it('assertBufferByteLengthWithinNodeLimit falha com tamanho acima do limite do Node', () => {
        expect(() => assertBufferByteLengthWithinNodeLimit(BUFFER_MAX_LENGTH + 1)).toThrow(
            /Buffer\.constants\.MAX_LENGTH/,
        );
    });

    it('decodeBase64ToOwnedBuffer aceita base64url e rejeita payload malformado', () => {
        expect(decodeBase64ToOwnedBuffer('YmluYXJ5LXBheWxvYWQ').toString('utf8')).toBe('binary-payload');
        expect(() => decodeBase64ToOwnedBuffer('%%%')).toThrow(/base64/);
    });
});
