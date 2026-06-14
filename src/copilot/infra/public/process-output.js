// @ts-check
/**
 * Captura binária bounded para stdout/stderr e outros streams de subprocesso.
 *
 * @module copilot/infra/process-output
 */

import { concatBufferViews, decodeUtf8Buffer, toBufferView } from './buffer.js';

export const DEFAULT_PROCESS_OUTPUT_MAX_BYTES = 2 * 1024 * 1024;
export const MAX_PROCESS_OUTPUT_MAX_BYTES = 64 * 1024 * 1024;

/**
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function normalizeMaxBytes(value, fallback) {
    const numeric = Number(value ?? fallback);
    if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
    return Math.min(MAX_PROCESS_OUTPUT_MAX_BYTES, Math.max(1, Math.trunc(numeric)));
}

export class BoundedProcessOutputCapture {
    /** @type {Buffer} */
    #buffer;
    #maxBytes;
    /** @type {'head' | 'tail'} */
    #mode;
    #observedBytes = 0;
    #storedBytes = 0;
    #writeOffset = 0;

    /**
     * @param {{ maxBytes?: number; mode?: 'head' | 'tail' }} [options]
     */
    constructor(options = {}) {
        const maxBytes = normalizeMaxBytes(options.maxBytes, DEFAULT_PROCESS_OUTPUT_MAX_BYTES);
        this.#mode = options.mode ?? 'head';
        this.#maxBytes = maxBytes;
        this.#buffer = Buffer.allocUnsafe(
            this.#mode === 'tail' ? maxBytes : Math.min(maxBytes, 64 * 1024),
        );
    }

    /**
     * @param {string | Buffer | Uint8Array | ArrayBuffer | SharedArrayBuffer | DataView} chunk
     * @returns {{ acceptedBytes: number; observedBytes: number; storedBytes: number; truncated: boolean }}
     */
    append(chunk) {
        const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : toBufferView(chunk);
        this.#observedBytes += bytes.byteLength;
        const acceptedBytes =
            this.#mode === 'tail' ? this.#appendTail(bytes) : this.#appendHead(bytes);
        return {
            acceptedBytes,
            observedBytes: this.#observedBytes,
            storedBytes: this.#storedBytes,
            truncated: this.#observedBytes > this.#storedBytes,
        };
    }

    /**
     * @returns {Buffer}
     */
    toBuffer() {
        if (this.#storedBytes === 0) return Buffer.alloc(0);
        if (this.#mode === 'head' || this.#storedBytes < this.#maxBytes || this.#writeOffset === 0) {
            return Buffer.from(this.#buffer.subarray(0, this.#storedBytes));
        }
        return concatBufferViews(
            [
                this.#buffer.subarray(this.#writeOffset),
                this.#buffer.subarray(0, this.#writeOffset),
            ],
            this.#storedBytes,
        );
    }

    /**
     * @param {{ fatal?: boolean; label?: string; includeTruncationMarker?: boolean }} [options]
     * @returns {string}
     */
    toString(options = {}) {
        const bytes = this.toBuffer();
        const text = options.fatal
            ? decodeUtf8Buffer(bytes, `${options.label ?? 'Process output'} contains invalid UTF-8.`)
            : bytes.toString('utf8');
        if (!options.includeTruncationMarker || this.#observedBytes <= this.#storedBytes) return text;
        return `${text}\n[stream output truncated: ${this.#observedBytes - this.#storedBytes} bytes omitted]`;
    }

    /**
     * @returns {{
     *   mode: 'head' | 'tail';
     *   maxBytes: number;
     *   observedBytes: number;
     *   storedBytes: number;
     *   omittedBytes: number;
     *   truncated: boolean;
     * }}
     */
    snapshot() {
        return {
            mode: this.#mode,
            maxBytes: this.#maxBytes,
            observedBytes: this.#observedBytes,
            storedBytes: this.#storedBytes,
            omittedBytes: Math.max(0, this.#observedBytes - this.#storedBytes),
            truncated: this.#observedBytes > this.#storedBytes,
        };
    }

    /**
     * @param {Buffer} bytes
     * @returns {number}
     */
    #appendHead(bytes) {
        const acceptedBytes = Math.min(bytes.byteLength, this.#maxBytes - this.#storedBytes);
        if (acceptedBytes > 0) {
            this.#ensureHeadCapacity(this.#storedBytes + acceptedBytes);
            bytes.copy(this.#buffer, this.#storedBytes, 0, acceptedBytes);
            this.#storedBytes += acceptedBytes;
            this.#writeOffset = this.#storedBytes % this.#maxBytes;
        }
        return acceptedBytes;
    }

    /**
     * @param {number} requiredBytes
     */
    #ensureHeadCapacity(requiredBytes) {
        if (requiredBytes <= this.#buffer.byteLength) return;
        const nextCapacity = Math.min(
            this.#maxBytes,
            Math.max(requiredBytes, this.#buffer.byteLength * 2),
        );
        const next = Buffer.allocUnsafe(nextCapacity);
        this.#buffer.copy(next, 0, 0, this.#storedBytes);
        this.#buffer = next;
    }

    /**
     * @param {Buffer} bytes
     * @returns {number}
     */
    #appendTail(bytes) {
        if (bytes.byteLength >= this.#buffer.byteLength) {
            bytes.copy(
                this.#buffer,
                0,
                bytes.byteLength - this.#buffer.byteLength,
                bytes.byteLength,
            );
            this.#storedBytes = this.#buffer.byteLength;
            this.#writeOffset = 0;
            return this.#buffer.byteLength;
        }

        const firstLength = Math.min(bytes.byteLength, this.#buffer.byteLength - this.#writeOffset);
        bytes.copy(this.#buffer, this.#writeOffset, 0, firstLength);
        const remaining = bytes.byteLength - firstLength;
        if (remaining > 0) bytes.copy(this.#buffer, 0, firstLength);
        this.#writeOffset = (this.#writeOffset + bytes.byteLength) % this.#buffer.byteLength;
        this.#storedBytes = Math.min(this.#buffer.byteLength, this.#storedBytes + bytes.byteLength);
        return bytes.byteLength;
    }
}

/**
 * @param {{ maxBytes?: number; mode?: 'head' | 'tail' }} [options]
 * @returns {BoundedProcessOutputCapture}
 */
export function createBoundedProcessOutputCapture(options = {}) {
    return new BoundedProcessOutputCapture(options);
}
