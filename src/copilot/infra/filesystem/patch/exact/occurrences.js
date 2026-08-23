// @ts-check
/** Exact-string occurrence scanning and bounded line evidence. */
import { lineNumberAtTextOffset } from '#copilot/infra/internal/platform/text-lines';

/**
 * @param {string} content
 * @param {string} needle
 * @param {number} [maxOffsets]
 * @returns {{ offsets: number[]; truncated: boolean }}
 */
export function findOccurrenceOffsets(content, needle, maxOffsets = Number.POSITIVE_INFINITY) {
    /** @type {number[]} */
    const offsets = [];
    let index = 0;
    while (index <= content.length) {
        const found = content.indexOf(needle, index);
        if (found === -1) break;
        offsets.push(found);
        if (offsets.length >= maxOffsets) return { offsets, truncated: true };
        index = found + needle.length;
    }
    return { offsets, truncated: false };
}

/**
 * Bounded line-location evidence for retrying an ambiguous exact-string patch without another file read.
 *
 * @param {string} content
 * @param {number[]} offsets
 * @param {number} [maxLines]
 */
export function occurrenceLineEvidence(content, offsets, maxLines = 16) {
    const selected = offsets.slice(0, maxLines);
    return {
        occurrenceLines: selected.map((offset) => lineNumberAtTextOffset(content, offset)),
        occurrenceLinesTruncated: offsets.length > selected.length,
    };
}
