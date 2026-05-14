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
    /** @type {string[]} */
    const out = [];
    for (let i = 0; i < max; i++) {
        if (aLines[i] === bLines[i]) continue;
        const start = Math.max(0, i - contextLines);
        const end = Math.min(max, i + contextLines + 1);
        out.push(`@@ ${start + 1},${end - start} @@`);
        for (let j = start; j < end; j++) {
            if (aLines[j] === bLines[j]) {
                if (aLines[j] !== undefined) out.push(` ${aLines[j]}`);
            } else {
                if (aLines[j] !== undefined) out.push(`-${aLines[j]}`);
                if (bLines[j] !== undefined) out.push(`+${bLines[j]}`);
            }
        }
        i = end - 1;
    }
    return { diff: out.join('\n'), contextLines };
}
