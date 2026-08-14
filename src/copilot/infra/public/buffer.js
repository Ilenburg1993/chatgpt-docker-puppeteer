// @ts-check
/**
 * Facade pública de helpers de Buffer seguros para tools e adapters.
 *
 * @module copilot/infra/public/buffer
 */

export {
    BUFFER_MAX_LENGTH,
    BUFFER_MAX_STRING_LENGTH,
    assertBufferByteLengthWithinNodeLimit,
    assertStringByteLengthWithinNodeLimit,
    assertUtf8Buffer,
    bufferIsAscii,
    bufferIsUtf8,
    concatBufferViews,
    decodeBase64ToOwnedBuffer,
    decodeUtf8Buffer,
    isBufferValue,
    toBufferView,
    toOwnedBuffer,
    truncateBufferView,
    truncateUtf8String,
    utf8ByteLength,
} from '../shared/buffer.js';
