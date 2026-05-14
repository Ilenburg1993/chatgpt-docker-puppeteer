// @ts-check
/**
 * Utilitários canônicos de Buffer/ArrayBuffer para IO.
 *
 * @module copilot/infra/shared/buffer
 */

import { Buffer, constants, isAscii, isUtf8 } from 'node:buffer';

export const BUFFER_MAX_LENGTH = constants.MAX_LENGTH;
export const BUFFER_MAX_STRING_LENGTH = constants.MAX_STRING_LENGTH;

/**
 * @param {number} byteLength
 * @param {string} [label]
 */
export function assertBufferByteLengthWithinNodeLimit(byteLength, label = 'buffer') {
    if (!Number.isFinite(byteLength) || byteLength < 0) {
        throw new RangeError(`${label}: byteLength inválido.`);
    }
    if (byteLength > BUFFER_MAX_LENGTH) {
        const error = new RangeError(`${label}: ${byteLength} bytes excede Buffer.constants.MAX_LENGTH.`);
        /** @type {{ code?: string }} */ (error).code = 'ERR_BUFFER_TOO_LARGE';
        throw error;
    }
}

/**
 * @param {number} byteLength
 * @param {string} [label]
 */
export function assertStringByteLengthWithinNodeLimit(byteLength, label = 'string') {
    if (!Number.isFinite(byteLength) || byteLength < 0) {
        throw new RangeError(`${label}: byteLength inválido.`);
    }
    if (byteLength > BUFFER_MAX_STRING_LENGTH) {
        const error = new RangeError(`${label}: ${byteLength} bytes excede Buffer.constants.MAX_STRING_LENGTH.`);
        /** @type {{ code?: string }} */ (error).code = 'ERR_STRING_TOO_LARGE';
        throw error;
    }
}

/**
 * @param {unknown} value
 * @returns {value is ArrayBuffer | SharedArrayBuffer}
 */
function isArrayBufferStorage(value) {
    return (
        value instanceof ArrayBuffer ||
        (typeof SharedArrayBuffer !== 'undefined' && value instanceof SharedArrayBuffer)
    );
}

/**
 * Converte uma view binária para Buffer sem cópia, preservando offset/length da view.
 *
 * Use apenas para leitura imediata. Para armazenamento ou escrita mutável, prefira `toOwnedBuffer`.
 *
 * @param {Buffer | Uint8Array | ArrayBuffer | SharedArrayBuffer | DataView} value
 * @returns {Buffer}
 */
export function toBufferView(value) {
    if (Buffer.isBuffer(value)) return value;
    if (ArrayBuffer.isView(value)) {
        return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    }
    if (isArrayBufferStorage(value)) {
        return Buffer.from(value);
    }
    throw new TypeError('Valor binário inválido: esperado Buffer, Uint8Array, ArrayBuffer ou DataView.');
}

/**
 * Converte para Buffer próprio, sem compartilhar memória com a entrada.
 *
 * @param {string | Buffer | Uint8Array | ArrayBuffer | SharedArrayBuffer | DataView} value
 * @param {BufferEncoding} [encoding]
 * @returns {Buffer}
 */
export function toOwnedBuffer(value, encoding = 'utf8') {
    if (typeof value === 'string') {
        const bytes = Buffer.byteLength(value, encoding);
        assertStringByteLengthWithinNodeLimit(bytes, 'string write payload');
        assertBufferByteLengthWithinNodeLimit(bytes, 'buffer write payload');
        return Buffer.from(value, encoding);
    }

    const view = toBufferView(value);
    assertBufferByteLengthWithinNodeLimit(view.byteLength, 'buffer payload');
    if (view instanceof Uint8Array && typeof Buffer.copyBytesFrom === 'function') {
        return Buffer.copyBytesFrom(view);
    }
    return Buffer.from(view);
}

/**
 * Decodifica payload textual base64/base64url com validação explícita.
 *
 * @param {string} value
 * @param {string} [label]
 * @returns {Buffer}
 */
export function decodeBase64ToOwnedBuffer(value, label = 'base64 payload') {
    if (typeof value !== 'string') {
        throw new TypeError(`${label}: esperado string base64.`);
    }
    const compact = value.replace(/\s+/g, '');
    if (compact.length === 0) return Buffer.alloc(0);
    if (!/^[A-Za-z0-9+/=_-]+$/.test(compact) || compact.length % 4 === 1) {
        const error = new TypeError(`${label}: conteúdo base64/base64url inválido.`);
        /** @type {{ code?: string }} */ (error).code = 'ERR_INVALID_BASE64';
        throw error;
    }
    const decoded = Buffer.from(compact, 'base64');
    assertBufferByteLengthWithinNodeLimit(decoded.byteLength, label);
    return Buffer.from(decoded);
}

/**
 * @param {Buffer | Uint8Array | ArrayBuffer | SharedArrayBuffer | DataView} value
 * @param {number} maxBytes
 * @returns {Buffer}
 */
export function truncateBufferView(value, maxBytes) {
    const view = toBufferView(value);
    if (!Number.isFinite(maxBytes) || maxBytes < 0) return view;
    return view.byteLength <= maxBytes ? view : view.subarray(0, Math.trunc(maxBytes));
}

export { isAscii as bufferIsAscii, isUtf8 as bufferIsUtf8 };
