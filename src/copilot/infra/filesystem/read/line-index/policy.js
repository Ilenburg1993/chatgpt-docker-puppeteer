// @ts-check
/** Memory/line limits and adaptive read sizing for the progressive byte-line index. */

/** @typedef {import('./types.js').ByteLineIndexEntry} ByteLineIndexEntry */

export const BYTE_LINE_INDEX_MAX_ENTRIES = 64;
const DEFAULT_BYTE_LINE_INDEX_MAX_BYTES = 32 * 1024 * 1024;
const HARD_BYTE_LINE_INDEX_MAX_BYTES = 256 * 1024 * 1024;
const BYTE_LINE_INDEX_ENTRY_OVERHEAD_BYTES = 512;
const BYTE_LINE_INDEX_ESTIMATED_BYTES_PER_OFFSET = 16;
const BYTE_LINE_INDEX_INITIAL_HIGH_WATER_MARK = 32 * 1024;
const BYTE_LINE_INDEX_SMALL_EXTENSION_HIGH_WATER_MARK = 16 * 1024;
const BYTE_LINE_INDEX_LARGE_EXTENSION_HIGH_WATER_MARK = 64 * 1024;
const BYTE_LINE_INDEX_MEDIUM_EXTENSION_MAX_BYTES = 1024 * 1024;
const DEFAULT_BYTE_LINE_INDEX_MAX_LINES = 1_000_000;
const HARD_BYTE_LINE_INDEX_MAX_LINES = 5_000_000;

export function readByteLineIndexMaxBytes() {
    const configured = Number(process.env['COPILOT_IO_BYTE_LINE_INDEX_MAX_BYTES'] ?? DEFAULT_BYTE_LINE_INDEX_MAX_BYTES);
    if (!Number.isFinite(configured) || configured <= 0) return DEFAULT_BYTE_LINE_INDEX_MAX_BYTES;
    return Math.min(HARD_BYTE_LINE_INDEX_MAX_BYTES, Math.max(1024, Math.floor(configured)));
}

/** @param {ByteLineIndexEntry} entry */
export function estimateByteLineIndexEntryBytes(entry) {
    return BYTE_LINE_INDEX_ENTRY_OVERHEAD_BYTES + entry.lineStarts.length * BYTE_LINE_INDEX_ESTIMATED_BYTES_PER_OFFSET;
}

export function readByteLineIndexMaxLines() {
    const configured = Number(process.env['COPILOT_IO_BYTE_LINE_INDEX_MAX_LINES'] ?? DEFAULT_BYTE_LINE_INDEX_MAX_LINES);
    if (!Number.isFinite(configured) || configured <= 0) return DEFAULT_BYTE_LINE_INDEX_MAX_LINES;
    return Math.min(HARD_BYTE_LINE_INDEX_MAX_LINES, Math.floor(configured));
}

/**
 * @param {number | undefined} configured
 * @param {ByteLineIndexEntry | null} existing
 * @param {number | null} requiredLineStarts
 */
export function resolveByteLineIndexHighWaterMark(configured, existing, requiredLineStarts) {
    if (Number.isFinite(configured) && Number(configured) > 0) return Math.floor(Number(configured));
    if (!existing) return BYTE_LINE_INDEX_INITIAL_HIGH_WATER_MARK;
    if (requiredLineStarts === null) return BYTE_LINE_INDEX_LARGE_EXTENSION_HIGH_WATER_MARK;
    const knownLogicalLines = Math.max(1, existing.lineStarts.length - 1);
    const observedBytesPerLine = Math.max(1, existing.scannedBytes / knownLogicalLines);
    const additionalLineStarts = Math.max(0, requiredLineStarts - existing.lineStarts.length);
    const estimatedBytes = additionalLineStarts * observedBytesPerLine;
    if (estimatedBytes <= BYTE_LINE_INDEX_SMALL_EXTENSION_HIGH_WATER_MARK)
        return BYTE_LINE_INDEX_SMALL_EXTENSION_HIGH_WATER_MARK;
    if (estimatedBytes <= BYTE_LINE_INDEX_MEDIUM_EXTENSION_MAX_BYTES) return BYTE_LINE_INDEX_INITIAL_HIGH_WATER_MARK;
    return BYTE_LINE_INDEX_LARGE_EXTENSION_HIGH_WATER_MARK;
}

/** @param {number} endLine */
export function resolveByteLineSeedStreamHighWaterMark(endLine) {
    return endLine <= 1000 ? BYTE_LINE_INDEX_INITIAL_HIGH_WATER_MARK : BYTE_LINE_INDEX_LARGE_EXTENSION_HIGH_WATER_MARK;
}
