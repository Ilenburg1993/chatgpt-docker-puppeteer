// @ts-check
/**
 * Parser puro de outline Markdown.
 *
 * @module copilot/infra/code-analysis/markdown-outline
 */

import { iterateTextLines } from '#copilot/infra/internal/platform/text-lines';

/**
 * Extrai headings H1-H4 de Markdown.
 *
 * @param {string} content
 * @returns {string[]}
 */
export function extractMarkdownOutline(content) {
    return extractMarkdownOutlineWithLines(content).map((entry) => entry.heading);
}

/**
 * Extrai headings H1-H4 de Markdown preservando linha real.
 *
 * @param {string} content
 * @returns {{ heading: string; line: number; depth: number }[]}
 */
export function extractMarkdownOutlineWithLines(content) {
    /** @type {{ heading: string; line: number; depth: number }[]} */
    const headings = [];
    for (const { text, line } of iterateTextLines(content)) {
        const m = /^(#{1,4})\s+(.+)$/.exec(text);
        if (m) {
            const marker = m[1] ?? '';
            headings.push({
                heading: `${marker} ${(m[2] ?? '').trim()}`,
                line,
                depth: marker.length,
            });
        }
    }
    return headings;
}
