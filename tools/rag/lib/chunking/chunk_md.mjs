import { MAX_CHUNK_CHARS_DOCS } from '../contract.mjs';
import { estimateCharsForLines } from '../text.mjs';
import { chunkPlain } from './chunk_plain.mjs';
import { mergeSmallRanges } from './merge_ranges.mjs';

export function chunkMarkdown({ lines, maxChunkChars = MAX_CHUNK_CHARS_DOCS, minChunkChars = 200 }) {
    if (!lines || lines.length === 0) return [];

    const headingStarts = new Set([0]);
    let inFence = false;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        if (trimmed.startsWith('```')) {
            inFence = !inFence;
            continue;
        }
        if (inFence) continue;
        if (/^#{1,6}\s+\S/.test(trimmed)) {
            headingStarts.add(i);
        }
    }

    const starts = [...headingStarts].sort((a, b) => a - b);
    const ranges = [];

    for (let s = 0; s < starts.length; s++) {
        const startIdx = starts[s];
        const endIdx = s + 1 < starts.length ? starts[s + 1] - 1 : lines.length - 1;
        if (startIdx > endIdx) continue;

        const chunkLen = estimateCharsForLines(lines, startIdx, endIdx);
        if (chunkLen <= maxChunkChars) {
            ranges.push({ startLine: startIdx + 1, endLine: endIdx + 1 });
            continue;
        }

        const subLines = lines.slice(startIdx, endIdx + 1);
        const subRanges = chunkPlain({ lines: subLines, maxChunkChars, minChunkChars, linesPerBlock: 60 });
        for (const r of subRanges) {
            ranges.push({ startLine: startIdx + r.startLine, endLine: startIdx + r.endLine });
        }
    }

    return mergeSmallRanges({ ranges, lines, minChunkChars, maxChunkChars });
}
