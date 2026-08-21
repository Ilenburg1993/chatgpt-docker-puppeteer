// @ts-check

import { describe, expect, it } from 'vitest';

import {
    BUFFER_MAX_LENGTH,
    assertBufferByteLengthWithinNodeLimit,
    concatBufferViews,
    decodeBase64ToOwnedBuffer,
    decodeUtf8Buffer,
    isBufferValue,
    toBufferView,
    toOwnedBuffer,
    truncateBufferView,
    truncateUtf8String,
    utf8ByteLength,
} from '../../../../src/copilot/infra/platform/buffer.js';

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

    it('utf8ByteLength mede texto e valida tipo', () => {
        expect(utf8ByteLength('ação')).toBe(Buffer.byteLength('ação', 'utf8'));
        expect(() => utf8ByteLength(/** @type {any} */ (123))).toThrow(/esperado string/);
    });

    it('decodeUtf8Buffer rejeita bytes UTF-8 inválidos com BinaryFileError', () => {
        expect(decodeUtf8Buffer(Buffer.from('ok', 'utf8'))).toBe('ok');
        expect(() => decodeUtf8Buffer(Buffer.from([0xff]))).toThrow(/UTF-8/);
        try {
            decodeUtf8Buffer(Buffer.from([0xff]));
        } catch (error) {
            expect(/** @type {Error} */ (error).name).toBe('BinaryFileError');
        }
    });

    it('concatBufferViews concatena preservando views e isBufferValue identifica Buffer', () => {
        const storage = new Uint8Array([0, 1, 2, 3, 4]);
        const result = concatBufferViews([new Uint8Array(storage.buffer, 1, 2), Buffer.from([9])]);

        expect([...result]).toEqual([1, 2, 9]);
        expect(isBufferValue(result)).toBe(true);
        expect(isBufferValue(storage)).toBe(false);
    });

    it('truncateUtf8String trunca por bytes sem deixar replacement char final', () => {
        const result = truncateUtf8String('ação', 2);

        expect(result.text).toBe('a');
        expect(result.truncated).toBe(true);
        expect(result.limitBytes).toBe(2);
        expect(result.originalBytes).toBe(Buffer.byteLength('ação', 'utf8'));
    });
});
