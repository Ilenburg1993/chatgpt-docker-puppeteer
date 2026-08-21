// @ts-check
/** Abort and fatal UTF-8 decoding primitives for chunked reads. */

/**
 * @returns {never}
 */
export function throwAbortError() {
    const error = /** @type {Error & { code?: string }} */ (new Error('The operation was aborted'));
    error.name = 'AbortError';
    error.code = 'ABORT_ERR';
    throw error;
}

/**
 * @param {unknown} cause
 * @returns {Error & { code?: string }}
 */
function createInvalidUtf8ChunkError(cause) {
    const error = /** @type {Error & { code?: string }} */ (
        new Error('Arquivo binário detectado (bytes inválidos para UTF-8).', { cause })
    );
    error.name = 'BinaryFileError';
    error.code = 'ERR_INVALID_UTF8';
    return error;
}

/**
 * @param {TextDecoder} decoder
 * @param {Buffer | Uint8Array | undefined} chunk
 * @param {boolean} final
 */
export function decodeUtf8Chunk(decoder, chunk, final = false) {
    try {
        return final ? decoder.decode() : decoder.decode(chunk, { stream: true });
    } catch (error) {
        throw createInvalidUtf8ChunkError(error);
    }
}

/** @param {Buffer | Uint8Array} content */
export function decodeUtf8Buffer(content) {
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(content);
    } catch (error) {
        throw createInvalidUtf8ChunkError(error);
    }
}
