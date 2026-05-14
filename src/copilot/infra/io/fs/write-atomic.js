// @ts-check
/**
 * Escrita atômica baixa, sem locks, cache ou observabilidade.
 *
 * @module copilot/infra/io/fs/write-atomic
 */

import { randomBytes } from 'node:crypto';
import { rename, unlink, writeFile } from 'node:fs/promises';
import { toOwnedBuffer } from '../../shared/buffer.js';

/**
 * @param {string | Buffer | Uint8Array | ArrayBuffer | SharedArrayBuffer | DataView} content
 * @param {BufferEncoding} [encoding]
 * @returns {Buffer}
 */
export function toWriteBuffer(content, encoding = 'utf8') {
    return toOwnedBuffer(content, encoding);
}

/**
 * @param {string} filePath
 * @param {string | Buffer | Uint8Array | ArrayBuffer | SharedArrayBuffer | DataView} content
 * @param {BufferEncoding} encoding
 * @returns {{ payload: Buffer; bytes: number }}
 */
export function normalizeWritePayload(filePath, content, encoding) {
    void filePath;
    const buf = toWriteBuffer(content, encoding);
    return {
        payload: buf,
        bytes: buf.byteLength,
    };
}

/**
 * Escrita atômica sem lock. O caller deve segurar o lock correto quando necessário.
 *
 * @param {string} filePath
 * @param {string | Buffer | Uint8Array | ArrayBuffer | SharedArrayBuffer | DataView} payload
 * @param {{ mode?: number }} [options]
 * @returns {Promise<void>}
 */
export async function writeAtomicFileUnlocked(filePath, payload, options = {}) {
    const tmpPath = `${filePath}.${randomBytes(4).toString('hex')}.tmp`;
    const writePayload = toOwnedBuffer(payload);
    try {
        await writeFile(tmpPath, writePayload, options.mode === undefined ? undefined : { mode: options.mode });
        await rename(tmpPath, filePath);
    } catch (error) {
        try {
            await unlink(tmpPath);
        } catch {
            // best-effort cleanup
        }
        throw error;
    }
}
