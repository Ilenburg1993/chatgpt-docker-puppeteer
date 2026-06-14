// @ts-check
/**
 * Leitura bounded de respostas dos importers de catálogo.
 *
 * @module copilot/model-gateway/catalog/importers/response-body
 */

import { concatBufferViews, decodeUtf8Buffer, utf8ByteLength } from '#copilot/infra/public/buffer';

export const DEFAULT_CATALOG_RESPONSE_MAX_BYTES = 8 * 1024 * 1024;
export const MAX_CATALOG_RESPONSE_MAX_BYTES = 32 * 1024 * 1024;

/**
 * @param {unknown} value
 * @returns {number}
 */
function normalizeCatalogResponseMaxBytes(value) {
    const numeric = Number(value ?? DEFAULT_CATALOG_RESPONSE_MAX_BYTES);
    if (!Number.isFinite(numeric) || numeric <= 0) return DEFAULT_CATALOG_RESPONSE_MAX_BYTES;
    return Math.min(MAX_CATALOG_RESPONSE_MAX_BYTES, Math.max(1, Math.trunc(numeric)));
}

/**
 * @param {Response} response
 * @param {{ maxBytes?: number; label?: string }} [options]
 * @returns {Promise<string>}
 */
export async function readCatalogResponseText(response, options = {}) {
    const maxBytes = normalizeCatalogResponseMaxBytes(options.maxBytes);
    const label = options.label ?? 'Catalog response';
    const contentLength = Number(response.headers?.get?.('content-length') ?? 0);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
        throw new Error(`${label} exceeds ${maxBytes} bytes.`);
    }

    const reader = response.body?.getReader?.();
    if (!reader) {
        if (typeof response.text !== 'function') {
            throw new Error(`${label} does not expose a readable text body.`);
        }
        const text = await response.text();
        if (utf8ByteLength(text, label) > maxBytes) throw new Error(`${label} exceeds ${maxBytes} bytes.`);
        return text;
    }

    /** @type {Uint8Array[]} */
    const chunks = [];
    let bytesRead = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (!value) continue;
            bytesRead += value.byteLength;
            if (bytesRead > maxBytes) throw new Error(`${label} exceeds ${maxBytes} bytes.`);
            chunks.push(value);
        }
    } finally {
        try {
            await reader.cancel();
        } catch {
            // best effort: the response may already be closed
        }
        reader.releaseLock?.();
    }

    return decodeUtf8Buffer(
        concatBufferViews(chunks, bytesRead),
        `${label} contains invalid UTF-8.`,
    );
}

/**
 * @param {Response} response
 * @param {{ maxBytes?: number; label?: string }} [options]
 * @returns {Promise<unknown>}
 */
export async function readCatalogResponseJson(response, options = {}) {
    if (typeof response.body?.getReader !== 'function' && typeof response.json === 'function') {
        return response.json();
    }
    return JSON.parse(await readCatalogResponseText(response, options));
}
