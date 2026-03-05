// @ts-check
import crypto from 'node:crypto';
import xxhashFactory from 'xxhash-wasm';

/** @type {any} */ let xxhashPromise = null;
async function getXXHash() {
    if (!xxhashPromise) {
        xxhashPromise = xxhashFactory();
    }
    return xxhashPromise;
}

export async function fingerprintBuffer(/** @type {any} */ buf) {
    const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
    const { h64Raw } = await getXXHash();
    const raw = h64Raw(buf);
    const xxhash64 = raw.toString(16).padStart(16, '0');
    return { xxhash64, sha256 };
}
