// @ts-check
/** Pure JSONL retention/trim planning. */
import { nonEmptyJsonlLines } from './tail.js';

/** @param {string} text @param {number} maxEntries */
export function trimJsonlTextEntries(text, maxEntries) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) throw new TypeError('maxEntries must be a positive integer.');
    const lines = nonEmptyJsonlLines(text);
    const trimmed = lines.length > maxEntries;
    const retained = trimmed ? lines.slice(-maxEntries) : lines;
    return Object.freeze({
        content: retained.length > 0 ? `${retained.join('\n')}\n` : '',
        originalEntries: lines.length,
        retainedEntries: retained.length,
        trimmed,
    });
}
