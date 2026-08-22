// @ts-check
/** Pure bounded JSONL line/tail parsing. */
import { decodeJsonlChunks } from '../codec/index.js';

/** @param {string} text @returns {string[]} */
export function nonEmptyJsonlLines(text) {
    return text.split(/\r?\n/u).filter((line) => line.trim());
}

/** @param {string} text @param {number} maxLines @returns {string[]} */
export function collectJsonlTailLines(text, maxLines) {
    if (!Number.isInteger(maxLines) || maxLines < 1) throw new TypeError('maxLines must be a positive integer.');
    const ring = new Array(maxLines);
    let count = 0;
    let next = 0;
    let start = 0;
    for (let index = 0; index <= text.length; index += 1) {
        if (index < text.length && text.charCodeAt(index) !== 10) continue;
        const line = text.slice(start, index);
        start = index + 1;
        if (!line.trim()) continue;
        ring[next] = line;
        next = (next + 1) % maxLines;
        count = Math.min(maxLines, count + 1);
    }
    const first = count === maxLines ? next : 0;
    return Array.from({ length: count }, (_, index) => /** @type {string} */ (ring[(first + index) % maxLines]));
}

/** @param {readonly Buffer[]} chunks @returns {Buffer[]} */
export function discardLeadingPartialJsonlChunks(chunks) {
    for (let index = 0; index < chunks.length; index += 1) {
        const chunk = chunks[index];
        if (!chunk) continue;
        const newlineIndex = chunk.indexOf(0x0a);
        if (newlineIndex < 0) continue;
        const remainder = chunk.subarray(newlineIndex + 1);
        return [...(remainder.byteLength > 0 ? [remainder] : []), ...chunks.slice(index + 1)];
    }
    return [];
}

/** @param {string} text */
export function parseJsonlTextRecords(text) {
    /** @type {unknown[]} */
    const records = [];
    let invalidLines = 0;
    for (const line of nonEmptyJsonlLines(text)) {
        try {
            records.push(JSON.parse(line));
        } catch {
            invalidLines += 1;
        }
    }
    return Object.freeze({ records: Object.freeze(records), invalidLines });
}

/**
 * @param {readonly Buffer[]} chronologicalChunks
 * @param {{maxLines:number;truncatedBefore:boolean;hasTrailingNewline:boolean}} options
 */
export function parseJsonlTailChunks(chronologicalChunks, options) {
    const completeChunks = options.truncatedBefore
        ? discardLeadingPartialJsonlChunks(chronologicalChunks)
        : [...chronologicalChunks];
    const text = decodeJsonlChunks(completeChunks);
    const lines = collectJsonlTailLines(text, options.maxLines);
    /** @type {unknown[]} */
    const records = [];
    let invalidLines = 0;
    let trailingPartialIgnored = false;
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        if (!line) continue;
        try {
            records.push(JSON.parse(line));
        } catch {
            invalidLines += 1;
            if (!options.hasTrailingNewline && index === lines.length - 1) trailingPartialIgnored = true;
        }
    }
    return Object.freeze({ records: Object.freeze(records), invalidLines, trailingPartialIgnored });
}
