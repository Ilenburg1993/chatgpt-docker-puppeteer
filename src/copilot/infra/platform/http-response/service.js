// @ts-check
/**
 * Leitura bounded de corpos HTTP recebidos pelo runtime.
 *
 * @module copilot/infra/platform/http-response/service
 */

import { concatBufferViews, decodeUtf8Buffer, utf8ByteLength } from '../buffer/index.js';

export const DEFAULT_HTTP_RESPONSE_MAX_BYTES = 2 * 1024 * 1024;
export const MAX_HTTP_RESPONSE_MAX_BYTES = 32 * 1024 * 1024;

/**
 * Minimal structural response consumed by the bounded body readers. Native `Response` satisfies this contract, while
 * tests/adapters may provide only the body capabilities they actually implement.
 *
 * @typedef {object} ReadableHttpResponse
 * @property {Pick<Headers, 'get'>} [headers]
 * @property {Pick<ReadableStream<Uint8Array>, 'getReader'> | null} [body]
 * @property {() => Promise<ArrayBuffer>} [arrayBuffer]
 * @property {() => Promise<string>} [text]
 * @property {() => Promise<unknown>} [json]
 */

/**
 * @typedef {{
 *   maxBytes?: number;
 *   defaultMaxBytes?: number;
 *   hardMaxBytes?: number;
 *   label?: string;
 * }} BoundedResponseOptions
 */

/**
 * @param {number | undefined} value
 * @param {number} fallback
 * @returns {number}
 */
function normalizePositiveInteger(value, fallback) {
    const numeric = Number(value ?? fallback);
    if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
    return Math.max(1, Math.trunc(numeric));
}

/**
 * @param {BoundedResponseOptions} options
 * @returns {{ limit: number; label: string }}
 */
function resolveResponseLimit(options) {
    const hardMaxBytes = Math.min(
        MAX_HTTP_RESPONSE_MAX_BYTES,
        normalizePositiveInteger(options.hardMaxBytes, MAX_HTTP_RESPONSE_MAX_BYTES),
    );
    const defaultMaxBytes = Math.min(
        hardMaxBytes,
        normalizePositiveInteger(options.defaultMaxBytes, DEFAULT_HTTP_RESPONSE_MAX_BYTES),
    );
    return {
        limit: Math.min(hardMaxBytes, normalizePositiveInteger(options.maxBytes, defaultMaxBytes)),
        label: options.label ?? 'HTTP response',
    };
}

/**
 * @param {ReadableHttpResponse} response
 * @param {BoundedResponseOptions} [options]
 * @returns {Promise<Buffer>}
 */
export async function readBoundedResponseBytes(response, options = {}) {
    const { limit, label } = resolveResponseLimit(options);
    const contentLength = Number(response.headers?.get?.('content-length') ?? 0);
    if (Number.isFinite(contentLength) && contentLength > limit) {
        throw new Error(`${label} exceeds ${limit} bytes.`);
    }

    const reader = response.body?.getReader?.();
    if (!reader) {
        if (typeof response.arrayBuffer === 'function') {
            const bytes = Buffer.from(await response.arrayBuffer());
            if (bytes.byteLength > limit) throw new Error(`${label} exceeds ${limit} bytes.`);
            return bytes;
        }
        if (typeof response.text === 'function') {
            const text = await response.text();
            if (utf8ByteLength(text, label) > limit) throw new Error(`${label} exceeds ${limit} bytes.`);
            return Buffer.from(text);
        }
        throw new Error(`${label} does not expose a readable body.`);
    }

    /** @type {Uint8Array[]} */
    const chunks = [];
    let bytesRead = 0;
    let completed = false;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                completed = true;
                break;
            }
            if (!value) continue;
            bytesRead += value.byteLength;
            if (bytesRead > limit) throw new Error(`${label} exceeds ${limit} bytes.`);
            chunks.push(value);
        }
    } finally {
        if (!completed) {
            try {
                await reader.cancel();
            } catch {
                // best effort: preserving the limit failure is more useful than a cleanup error
            }
        }
        reader.releaseLock?.();
    }
    return concatBufferViews(chunks, bytesRead);
}

/**
 * @param {ReadableHttpResponse} response
 * @param {BoundedResponseOptions} [options]
 * @returns {Promise<string>}
 */
export async function readBoundedResponseText(response, options = {}) {
    const label = options.label ?? 'HTTP response';
    return decodeUtf8Buffer(await readBoundedResponseBytes(response, options), `${label} contains invalid UTF-8.`);
}

/**
 * @param {ReadableHttpResponse} response
 * @param {BoundedResponseOptions} [options]
 * @returns {Promise<unknown>}
 */
export async function readBoundedResponseJson(response, options = {}) {
    if (
        typeof response.body?.getReader !== 'function' &&
        typeof response.arrayBuffer !== 'function' &&
        typeof response.json === 'function'
    ) {
        return response.json();
    }
    return JSON.parse(await readBoundedResponseText(response, options));
}
