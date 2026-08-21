// @ts-check
/**
 * Diff textual simples e puro.
 *
 * @module copilot/infra/filesystem/patch/diff/algorithm
 */

import { iterateTextLines } from '#copilot/infra/internal/platform';

/**
 * @param {string} contentA
 * @param {string} contentB
 * @returns {Generator<{ index: number; a: string | undefined; b: string | undefined }>}
 */
function* iteratePairedTextLines(contentA, contentB) {
    const aIterator = iterateTextLines(contentA);
    const bIterator = iterateTextLines(contentB);
    let index = 0;
    while (true) {
        const aEntry = aIterator.next();
        const bEntry = bIterator.next();
        if (aEntry.done && bEntry.done) return;
        yield {
            index,
            a: aEntry.done ? undefined : aEntry.value.text,
            b: bEntry.done ? undefined : bEntry.value.text,
        };
        index += 1;
    }
}

/**
 * @param {string} contentA
 * @param {string} contentB
 * @param {{ contextLines?: number }} [options]
 * @returns {{ diff: string; contextLines: number }}
 */
export function buildSimpleTextDiff(contentA, contentB, options = {}) {
    const contextLines = Math.max(0, options.contextLines ?? 3);
    /** @type {{ start: number; end: number }[]} */
    const hunks = [];
    let totalLines = 0;
    for (const { index, a, b } of iteratePairedTextLines(contentA, contentB)) {
        totalLines = index + 1;
        if (a === b) continue;
        const start = Math.max(0, index - contextLines);
        const end = index + contextLines + 1;
        const last = hunks[hunks.length - 1];
        if (last && start <= last.end) {
            last.end = Math.max(last.end, end);
            continue;
        }
        hunks.push({ start, end });
    }
    if (hunks.length === 0) return { diff: '', contextLines };
    for (const hunk of hunks) hunk.end = Math.min(totalLines, hunk.end);

    /** @type {string[]} */
    const out = [];
    let hunkIndex = 0;
    for (const { index, a, b } of iteratePairedTextLines(contentA, contentB)) {
        const hunk = hunks[hunkIndex];
        if (!hunk || index < hunk.start) continue;
        if (index === hunk.start) out.push(`@@ ${hunk.start + 1},${hunk.end - hunk.start} @@`);
        if (a === b) {
            if (a !== undefined) out.push(` ${a}`);
        } else {
            if (a !== undefined) out.push(`-${a}`);
            if (b !== undefined) out.push(`+${b}`);
        }
        if (index + 1 >= hunk.end) hunkIndex += 1;
    }
    return { diff: out.join('\n'), contextLines };
}

/**
 * Extract only the requested 1-based line window without splitting the full text.
 *
 * @param {string} text
 * @param {number} startLine
 * @param {number} endLine
 * @returns {string[]}
 */
function extractLineWindow(text, startLine, endLine) {
    const lines = [];
    for (const entry of iterateTextLines(text)) {
        if (entry.line > endLine) break;
        if (entry.line >= startLine) lines.push(entry.text);
    }
    return lines;
}

/**
 * Build a compact diff around a known single-line replacement range.
 *
 * This is intentionally conservative: insertions/deletions or multi-occurrence replacements fall back to the full diff.
 *
 * @param {string} contentA
 * @param {string} contentB
 * @param {{
 *     firstMatchLine?: number | null;
 *     lastMatchLine?: number | null;
 *     lineDelta?: number | null;
 *     replacedOccurrences?: number | null;
 *     contextLines?: number;
 * }} [options]
 * @returns {{ diff: string; contextLines: number; rangeOptimized: boolean }}
 */
export function buildSimpleTextDiffAroundLineRange(contentA, contentB, options = {}) {
    const contextLines = Math.max(0, options.contextLines ?? 3);
    const firstMatchLine = Number(options.firstMatchLine);
    const lastMatchLine = Number(options.lastMatchLine);
    const lineDelta = Number(options.lineDelta ?? 0);
    const replacedOccurrences = Number(options.replacedOccurrences ?? 0);
    if (
        replacedOccurrences !== 1 ||
        lineDelta !== 0 ||
        !Number.isInteger(firstMatchLine) ||
        !Number.isInteger(lastMatchLine) ||
        firstMatchLine < 1 ||
        lastMatchLine < firstMatchLine
    ) {
        return { ...buildSimpleTextDiff(contentA, contentB, { contextLines }), rangeOptimized: false };
    }
    const startLine = Math.max(1, firstMatchLine - contextLines);
    const endLine = lastMatchLine + contextLines;
    const aLines = extractLineWindow(contentA, startLine, endLine);
    const bLines = extractLineWindow(contentB, startLine, endLine);
    const max = Math.max(aLines.length, bLines.length);
    const out = [`@@ ${startLine},${max} @@`];
    for (let index = 0; index < max; index++) {
        if (aLines[index] === bLines[index]) {
            if (aLines[index] !== undefined) out.push(` ${aLines[index]}`);
            continue;
        }
        if (aLines[index] !== undefined) out.push(`-${aLines[index]}`);
        if (bLines[index] !== undefined) out.push(`+${bLines[index]}`);
    }
    return { diff: out.join('\n'), contextLines, rangeOptimized: true };
}
