// @ts-check
/** Pure JSONL trailing-repair policy and classification. */
import { decodeJsonlUtf8 } from '../codec/index.js';

export const DEFAULT_JSONL_MAX_TRAILING_RECORD_BYTES = 4 * 1024 * 1024;
export const DEFAULT_JSONL_MAX_REPAIR_SCAN_BYTES = 16 * 1024 * 1024;

/**
 * @param {{maxTrailingRecordBytes?:number;maxRepairScanBytes?:number}} [options]
 */
export function resolveJsonlRepairPolicy(options = {}) {
    const maxTrailingRecordBytes = Math.max(
        1_024,
        Math.trunc(options.maxTrailingRecordBytes ?? DEFAULT_JSONL_MAX_TRAILING_RECORD_BYTES),
    );
    const maxRepairScanBytes = Math.max(
        maxTrailingRecordBytes,
        Math.trunc(options.maxRepairScanBytes ?? DEFAULT_JSONL_MAX_REPAIR_SCAN_BYTES),
    );
    return Object.freeze({ maxTrailingRecordBytes, maxRepairScanBytes });
}

/** @param {Buffer} bytes */
export function lastJsonlNewlineOffset(bytes) {
    return bytes.lastIndexOf(0x0a);
}

/**
 * @typedef {'missing'|'empty'|'newline-terminated'|'valid-trailing-record'|'trailing-record-too-large'|'invalid-trailing-partial'} JsonlTrailingRepairReason
 * @typedef {{ repaired:boolean; reason:JsonlTrailingRepairReason; previousBytes:number; finalBytes:number; truncatedBytes:number }} JsonlTrailingRepairResult
 */

/** @param {JsonlTrailingRepairReason} reason @param {number} previousBytes @param {number} finalBytes @returns {JsonlTrailingRepairResult} */
export function createJsonlTrailingRepairResult(reason, previousBytes, finalBytes) {
    return Object.freeze({
        repaired: reason === 'invalid-trailing-partial',
        reason,
        previousBytes,
        finalBytes,
        truncatedBytes: Math.max(0, previousBytes - finalBytes),
    });
}

/**
 * Preserve the existing repair contract: a record that starts after a prior newline may exceed the fast-record budget
 * when it is still inside the bounded repair scan; a first/only record beyond the record budget is left untouched.
 * Strict UTF-8 decode failures intentionally propagate rather than being converted into permission to truncate bytes.
 *
 * @param {{recordStart:number|null;size:number;maxTrailingRecordBytes:number;recordBuffer:Buffer|null}} input
 */
export function classifyJsonlTrailingCandidate(input) {
    if (input.recordStart === null || (input.recordStart === 0 && input.size > input.maxTrailingRecordBytes)) {
        return Object.freeze({ reason: /** @type {const} */ ('trailing-record-too-large'), finalBytes: input.size });
    }
    if (!input.recordBuffer) throw new TypeError('recordBuffer is required for a bounded trailing JSONL candidate.');
    const record = decodeJsonlUtf8(input.recordBuffer);
    try {
        JSON.parse(record);
        return Object.freeze({ reason: /** @type {const} */ ('valid-trailing-record'), finalBytes: input.size });
    } catch {
        return Object.freeze({
            reason: /** @type {const} */ ('invalid-trailing-partial'),
            finalBytes: input.recordStart,
        });
    }
}
