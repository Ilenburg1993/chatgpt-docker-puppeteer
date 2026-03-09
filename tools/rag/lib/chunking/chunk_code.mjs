// @ts-check
import { MAX_CHUNK_CHARS_CODE } from '../contract.mjs';
import { estimateCharsForLines } from '../text.mjs';
import { chunkPlain } from './chunk_plain.mjs';
import { mergeSmallRanges } from './merge_ranges.mjs';

const ANCHOR_RE =
    /^(?:\s*export\s+|\s*class\s+\w|\s*(?:async\s+)?function\s+\w|\s*interface\s+\w|\s*type\s+\w|\s*const\s+\w+\s*=\s*\(|\s*describe\(|\s*it\()/;
const BLOCK_COMMENT_START = /^\s*\/\*\*/;

export function chunkCode(/** @type {any} */ { lines, maxChunkChars = MAX_CHUNK_CHARS_CODE, minChunkChars = 200 }) {
    if (!lines || lines.length === 0) return [];

    const candidates = new Set([0]);
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (ANCHOR_RE.test(line)) candidates.add(i);
        if (BLOCK_COMMENT_START.test(line)) candidates.add(i);
    }

    const starts = [...candidates].sort((a, b) => a - b);
    const ranges = [];

    for (let s = 0; s < starts.length; s++) {
        const startIdx = /** @type {number} */ (starts[s]);
        const endIdx = s + 1 < starts.length ? /** @type {number} */ (starts[s + 1]) - 1 : lines.length - 1;
        if (startIdx > endIdx) continue;

        const len = estimateCharsForLines(lines, startIdx, endIdx);
        if (len <= maxChunkChars) {
            ranges.push({ startLine: startIdx + 1, endLine: endIdx + 1 });
            continue;
        }

        const subLines = lines.slice(startIdx, endIdx + 1);
        const subRanges = chunkPlain({ lines: subLines, maxChunkChars, minChunkChars, linesPerBlock: 80 });
        for (const r of subRanges) {
            ranges.push({ startLine: startIdx + r.startLine, endLine: startIdx + r.endLine });
        }
    }

    const finalRanges = ranges.length ? ranges : chunkPlain({ lines, maxChunkChars, minChunkChars, linesPerBlock: 80 });

    return mergeSmallRanges({ ranges: finalRanges, lines, minChunkChars, maxChunkChars });
}
