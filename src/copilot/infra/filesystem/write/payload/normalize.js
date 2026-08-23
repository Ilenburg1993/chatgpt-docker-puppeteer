// @ts-check
/** Owned payload normalization shared by locked append/write orchestration. */
import { toOwnedBuffer } from '#copilot/infra/internal/platform/buffer';
/**
 * @param {string | Buffer | Uint8Array | ArrayBuffer | SharedArrayBuffer | DataView} content
 * @param {BufferEncoding} [encoding]
 */
export function toWriteBuffer(content, encoding = 'utf8') {
    return toOwnedBuffer(content, encoding);
}
/**
 * @param {string} filePath
 * @param {string | Buffer | Uint8Array | ArrayBuffer | SharedArrayBuffer | DataView} content
 * @param {BufferEncoding} encoding
 */
export function normalizeWritePayload(filePath, content, encoding) {
    void filePath;
    const payload = toWriteBuffer(content, encoding);
    return { payload, bytes: payload.byteLength };
}
