// @ts-check
/** Shared scalar/path normalization for cross-process journal and replay. */
import path from 'node:path';

/** @param {unknown} value */
export function readSequenceValue(value) {
    const parsed = Number(value ?? 0);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}
/** @param {unknown} value @param {number} fallback */
export function normalizeNonNegativeInteger(value, fallback) {
    const parsed = Number(value ?? fallback);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}
/** @param {unknown} row */
export function readSequence(row) {
    return readSequenceValue(/** @type {{ sequence?: unknown }} */ (row ?? {}).sequence);
}
/** @param {string} filePath */
export function normalizeJournalPath(filePath) {
    return path.resolve(String(filePath));
}
/** @param {unknown} source */
export function normalizeJournalSource(source) {
    const normalized = String(source ?? 'io')
        .replace(/[\r\n\t]+/gu, ' ')
        .trim();
    return normalized.slice(0, 96) || 'io';
}
export function monotonicJournalMs() {
    return Number(process.hrtime.bigint()) / 1_000_000;
}
/** @param {number} value */
export function roundJournalMilliseconds(value) {
    return Math.round(value * 1000) / 1000;
}
