// @ts-check - Type checking rigoroso habilitado (arquivo core)
import { promises as fs } from 'node:fs';
import fss from 'node:fs';
import crypto from 'node:crypto';
import { sleep } from './fs_utils.js';

async function atomicWrite(filepath, content) {
    const uuid = crypto.randomBytes(4).toString('hex');
    const tmpPath = `${filepath}.tmp.${process.pid}.${uuid}`;

    try {
        // [FIX 1.2] Escrita assíncrona para não bloquear o Event Loop
        // Back-compat: callers sometimes pass a third argument (encoding) but older signature ignored it.
        // We keep utf-8 for strings, and support binary (Buffer/Uint8Array) without forcing encoding.
        const isBinary =
            content &&
            (Buffer.isBuffer(content) ||
                ArrayBuffer.isView(content) ||
                content instanceof ArrayBuffer);
        if (isBinary) {
            await fs.writeFile(tmpPath, content);
        } else {
            await fs.writeFile(tmpPath, content, 'utf-8');
        }

        let attempts = 0;
        while (attempts < 10) {
            try {
                await fs.rename(tmpPath, filepath);
                return true;
            } catch (err) {
                // [FIX 1.4] Suporte a Docker/Volumes (Cross-device link error)
                if (err.code === 'EXDEV') {
                    await fs.copyFile(tmpPath, filepath);
                    await fs.unlink(tmpPath);
                    return true;
                }
                if (err.code === 'EPERM' || err.code === 'EBUSY') {
                    attempts++;
                    await sleep(100 * attempts);
                    continue;
                }
                throw err;
            }
        }
    } catch (err) {
        if (fss.existsSync(tmpPath)) {
            await fs.unlink(tmpPath).catch(() => {});
        }
        throw err;
    }
}

export { atomicWrite };
