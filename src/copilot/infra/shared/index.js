// @ts-check
/**
 * Barrel de utilitários compartilhados da infra.
 *
 * @module copilot/infra/shared
 */

export {
    BUFFER_MAX_LENGTH,
    BUFFER_MAX_STRING_LENGTH,
    assertBufferByteLengthWithinNodeLimit,
    assertStringByteLengthWithinNodeLimit,
    bufferIsAscii,
    bufferIsUtf8,
    decodeBase64ToOwnedBuffer,
    toBufferView,
    toOwnedBuffer,
    truncateBufferView,
} from './buffer.js';
export { readEnvNonNegativeInt, readEnvPositiveInt } from './env.js';
export { sha256 } from './hash.js';
