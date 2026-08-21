// @ts-check
/** @module copilot/infra/platform */

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
} from './buffer.js';
export { booleanValueOr, boundedIntegerOr, nonNegativeIntegerOr, positiveIntegerOr } from './config-values.js';
export { readEnvBoolean, readEnvIntAtLeast, readEnvNonNegativeInt, readEnvPositiveInt } from './env.js';
export { fingerprintMatches, richFingerprintMatches } from './fingerprint.js';
export { sha256 } from './hash.js';
export {
    DEFAULT_HTTP_RESPONSE_MAX_BYTES,
    MAX_HTTP_RESPONSE_MAX_BYTES,
    readBoundedResponseBytes,
    readBoundedResponseJson,
    readBoundedResponseText,
} from './http-response.js';
export {
    BoundedProcessOutputCapture,
    DEFAULT_PROCESS_OUTPUT_MAX_BYTES,
    MAX_PROCESS_OUTPUT_MAX_BYTES,
    createBoundedProcessOutputCapture,
} from './process-output.js';
export {
    collectPhysicalLineStarts,
    countPhysicalTextLines,
    iterateTextLines,
    lineNumberAtTextOffset,
    slicePhysicalTextLines,
    splitPhysicalTextLines,
} from './text-lines.js';
