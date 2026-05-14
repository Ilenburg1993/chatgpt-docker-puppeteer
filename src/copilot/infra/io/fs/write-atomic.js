// @ts-check
/**
 * Escrita atômica baixa, sem locks, cache ou observabilidade.
 *
 * @module copilot/infra/io/fs/write-atomic
 */

import { randomBytes } from 'node:crypto';
import { rename, unlink, writeFile } from 'node:fs/promises';

/**
 * @param {string | Buffer} content
 * @param {BufferEncoding} [encoding]
 * @returns {Buffer}
 */
export function toWriteBuffer(content, encoding = 'utf8') {
    return Buffer.isBuffer(content) ? content : Buffer.from(content, encoding);
}

/**
 * @param {string} filePath
 * @param {string | Buffer} content
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
 * @param {string | Buffer} payload
 * @param {{ mode?: number }} [options]
 * @returns {Promise<void>}
 */
export async function writeAtomicFileUnlocked(filePath, payload, options = {}) {
    const tmpPath = `${filePath}.${randomBytes(4).toString('hex')}.tmp`;
    try {
        await writeFile(tmpPath, payload, options.mode === undefined ? undefined : { mode: options.mode });
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
