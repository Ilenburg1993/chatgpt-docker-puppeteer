// @ts-check
/**
 * Diff textual simples e puro.
 *
 * @module copilot/infra/io/patch
 */

/**
 * @param {string} contentA
 * @param {string} contentB
 * @param {{ contextLines?: number }} [options]
 * @returns {{ diff: string; contextLines: number }}
 */
export function buildSimpleTextDiff(contentA, contentB, options = {}) {
    const aLines = contentA.split('\n');
    const bLines = contentB.split('\n');
    const max = Math.max(aLines.length, bLines.length);
    const contextLines = Math.max(0, options.contextLines ?? 3);
    /** @type {number[]} */
    const changeIndexes = [];
    for (let i = 0; i < max; i++) {
        if (aLines[i] !== bLines[i]) changeIndexes.push(i);
    }
    if (changeIndexes.length === 0) {
        return { diff: '', contextLines };
    }

    /** @type {{ start: number; end: number }[]} */
    const hunks = [];
    for (const index of changeIndexes) {
        const start = Math.max(0, index - contextLines);
        const end = Math.min(max, index + contextLines + 1);
        const last = hunks[hunks.length - 1];
        if (last && start <= last.end) {
            last.end = Math.max(last.end, end);
            continue;
        }
        hunks.push({ start, end });
    }

    /** @type {string[]} */
    const out = [];
    for (const hunk of hunks) {
        const start = hunk.start;
        const end = hunk.end;
        out.push(`@@ ${start + 1},${end - start} @@`);
        for (let j = start; j < end; j++) {
            if (aLines[j] === bLines[j]) {
                if (aLines[j] !== undefined) out.push(` ${aLines[j]}`);
            } else {
                if (aLines[j] !== undefined) out.push(`-${aLines[j]}`);
                if (bLines[j] !== undefined) out.push(`+${bLines[j]}`);
            }
        }
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
    let line = 1;
    let start = 0;
    for (let index = 0; index <= text.length; index++) {
        if (index !== text.length && text.charCodeAt(index) !== 10) continue;
        if (line >= startLine && line <= endLine) {
            const end = index > start && text.charCodeAt(index - 1) === 13 ? index - 1 : index;
            lines.push(text.slice(start, end));
        }
        if (line > endLine) break;
        line += 1;
        start = index + 1;
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
 * @param {{ firstMatchLine?: number | null; lastMatchLine?: number | null; lineDelta?: number | null; replacedOccurrences?: number | null; contextLines?: number }} [options]
 * @returns {{ diff: string; contextLines: number; rangeOptimized: boolean }}
 */
export function buildSimpleTextDiffAroundLineRange(contentA, contentB, options = {}) {
    const contextLines = Math.max(0, options.contextLines ?? 3);
    const firstMatchLine = Number(options.firstMatchLine);
    const lastMatchLine = Number(options.lastMatchLine);
    const lineDelta = Number(options.lineDelta ?? 0);
    const replacedOccurrences = Number(options.replacedOccurrences ?? 0);
    if (
        replacedOccurrences !== 1
        || lineDelta !== 0
        || !Number.isInteger(firstMatchLine)
        || !Number.isInteger(lastMatchLine)
        || firstMatchLine < 1
        || lastMatchLine < firstMatchLine
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
