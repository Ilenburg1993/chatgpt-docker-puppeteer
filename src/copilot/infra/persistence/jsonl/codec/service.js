// @ts-check
/** Strict UTF-8 decoding and bounded numeric normalization for JSONL readers. */
/** @param {Buffer | Uint8Array} bytes */
export function decodeJsonlUtf8(bytes) {
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (cause) {
        throw Object.assign(new Error('JSONL contém bytes inválidos para UTF-8.', { cause }), { code: 'EUTF8JSONL' });
    }
}
/** @param {unknown} value @param {number} fallback @param {number} minimum @param {number} maximum */
export function normalizeJsonlLimit(value, fallback, minimum, maximum) {
    const numeric = Number(value ?? fallback);
    if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
    return Math.min(maximum, Math.max(minimum, Math.trunc(numeric)));
}
/** @param {Buffer[]} chunks */
export function decodeJsonlChunks(chunks) {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    /** @type {string[]} */ const decoded = [];
    try {
        for (const chunk of chunks) {
            const text = decoder.decode(chunk, { stream: true });
            if (text) decoded.push(text);
        }
        const tail = decoder.decode();
        if (tail) decoded.push(tail);
        return decoded.join('');
    } catch (cause) {
        throw Object.assign(new Error('JSONL contém bytes inválidos para UTF-8.', { cause }), { code: 'EUTF8JSONL' });
    }
}
