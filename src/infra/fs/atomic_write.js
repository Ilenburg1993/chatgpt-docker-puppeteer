// @ts-check
import { promises as fs } from 'node:fs';
import fss from 'node:fs';
import crypto from 'node:crypto';
import { sleep } from './fs_utils.js';

/**
 * Atomically writes content to a file (write to temp → rename).
 * Handles cross-device (EXDEV) scenarios and retries on EPERM/EBUSY.
 *
 * @param {string} filepath - Target file path.
 * @param {string|Buffer|Uint8Array} content - Data to write.
 * @param {BufferEncoding} [encoding='utf-8'] - Encoding for string content (ignored for binary).
 * @returns {Promise<true>}
 */
async function atomicWrite(filepath, content, encoding) {
    const uuid = crypto.randomBytes(4).toString('hex');
    const tmpPath = `${filepath}.tmp.${process.pid}.${uuid}`;

    try {
        const isBinary = content && (Buffer.isBuffer(content) || ArrayBuffer.isView(content));
        if (isBinary) {
            await fs.writeFile(tmpPath, content);
        } else {
            await fs.writeFile(tmpPath, content, encoding || 'utf-8');
        }

        let attempts = 0;
        while (attempts < 10) {
            try {
                await fs.rename(tmpPath, filepath);
                return true;
            } catch (err) {
                const _ce = /** @type {any} */ (err);
                // [FIX 1.4] Suporte a Docker/Volumes (Cross-device link error)
                if (_ce.code === 'EXDEV') {
                    await fs.copyFile(tmpPath, filepath);
                    await fs.unlink(tmpPath);
                    return true;
                }
                if (_ce.code === 'EPERM' || _ce.code === 'EBUSY') {
                    attempts++;
                    await sleep(100 * attempts);
                    continue;
                }
                throw err;
            }
        }
        // P0: All rename retries exhausted — throw so callers don't assume success.
        throw new Error(`atomicWrite: rename failed after 10 retries (EPERM/EBUSY) for ${filepath}`);
    } catch (err) {
        const _ce = /** @type {any} */ (err);
        if (fss.existsSync(tmpPath)) {
            await fs.unlink(tmpPath).catch(() => {});
        }
        throw err;
    }
}

export { atomicWrite };
