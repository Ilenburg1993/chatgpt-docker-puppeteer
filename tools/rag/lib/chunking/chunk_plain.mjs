// @ts-check
import { MAX_CHUNK_CHARS_CODE } from '../contract.mjs';
import { estimateCharsForLines } from '../text.mjs';

export function chunkPlain(/** @type {any} */ { lines, maxChunkChars = MAX_CHUNK_CHARS_CODE, minChunkChars = 200, linesPerBlock = 80 }) {
    if (!lines || lines.length === 0) return [];

    const ranges = [];
    let start = 0;

    while (start < lines.length) {
        let end = Math.min(lines.length - 1, start + linesPerBlock - 1);

        while (end < lines.length - 1 && estimateCharsForLines(lines, start, end) < minChunkChars) {
            const nextEnd = Math.min(lines.length - 1, end + linesPerBlock);
            if (nextEnd === end) break;
            end = nextEnd;
        }

        while (end > start && estimateCharsForLines(lines, start, end) > maxChunkChars) {
            end--;
        }

        ranges.push({ startLine: start + 1, endLine: end + 1 });
        start = end + 1;
    }

    return ranges;
}
