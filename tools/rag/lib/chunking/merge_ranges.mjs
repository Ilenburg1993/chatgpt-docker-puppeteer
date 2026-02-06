import { estimateCharsForLines } from '../text.mjs';

export function mergeSmallRanges({ ranges, lines, minChunkChars, maxChunkChars }) {
    if (!ranges.length) return ranges;
    const merged = [];

    for (const r of ranges) {
        if (!merged.length) {
            merged.push({ ...r });
            continue;
        }

        const current = merged[merged.length - 1];
        const currentLen = estimateCharsForLines(lines, current.startLine - 1, current.endLine - 1);
        if (currentLen >= minChunkChars) {
            merged.push({ ...r });
            continue;
        }

        const combined = { startLine: current.startLine, endLine: r.endLine };
        const combinedLen = estimateCharsForLines(lines, combined.startLine - 1, combined.endLine - 1);
        if (combinedLen <= maxChunkChars) {
            merged[merged.length - 1] = combined;
        } else {
            merged.push({ ...r });
        }
    }

    // If the last chunk is still too small, merge backward if possible.
    if (merged.length >= 2) {
        const last = merged[merged.length - 1];
        const lastLen = estimateCharsForLines(lines, last.startLine - 1, last.endLine - 1);
        if (lastLen < minChunkChars) {
            const prev = merged[merged.length - 2];
            const combined = { startLine: prev.startLine, endLine: last.endLine };
            const combinedLen = estimateCharsForLines(lines, combined.startLine - 1, combined.endLine - 1);
            if (combinedLen <= maxChunkChars) {
                merged.splice(-2, 2, combined);
            }
        }
    }

    return merged;
}

