// @ts-check
/**
 * Diff textual simples e puro.
 *
 * @module copilot/infra/io/patch/text-diff
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
