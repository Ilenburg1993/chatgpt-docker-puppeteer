// @ts-check
/**
 * Parser puro de outline Markdown.
 *
 * @module copilot/infra/parse/markdown-outline
 */

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
    const lines = content.split('\n');
    for (let index = 0; index < lines.length; index++) {
        const line = lines[index] ?? '';
        const m = /^(#{1,4})\s+(.+)$/.exec(line);
        if (m) {
            const marker = m[1] ?? '';
            headings.push({
                heading: `${marker} ${(m[2] ?? '').trim()}`,
                line: index + 1,
                depth: marker.length,
            });
        }
    }
    return headings;
}
