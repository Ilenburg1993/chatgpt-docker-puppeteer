// @ts-check
/**
 * Trusted runtime boundary for JSONL persistence reads.
 *
 * Caller identity is validated here while parsing, UTF-8 validation, partial-line handling and byte budgets remain owned
 * by the canonical JSONL reader in the same capability.
 *
 * @module copilot/infra/persistence/jsonl/trusted
 */

import { readJsonlTail } from './tail.js';

/**
 * @param {string} filePath
 * @param {{
 *     caller: string;
 *     maxLines?: number;
 *     blockSize?: number;
 *     maxBytes?: number;
 *     repairTrailingPartial?: boolean;
 *     maxTrailingRecordBytes?: number;
 *     flushRepairToDisk?: boolean;
 * }} options
 */
export async function readJsonlTailTrusted(filePath, options) {
    const caller = options?.caller?.trim();
    if (!caller) throw new TypeError('readJsonlTailTrusted requires a non-empty caller');
    const { caller: _caller, ...readOptions } = options;
    return readJsonlTail(filePath, readOptions);
}
