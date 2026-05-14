// @ts-check
/**
 * Helpers de janela de saída para operações com retorno potencialmente grande.
 *
 * @module copilot/infra/policy/output-window
 */

/**
 * @param {number | undefined} value
 * @returns {number | null}
 */
export function normalizeMaxResults(value) {
    return Number.isFinite(value) && Number(value) > 0 ? Math.floor(Number(value)) : null;
}

/**
 * @param {string} text
 * @param {number | null} maxResults
 * @returns {{ text: string; truncated: boolean; originalLineCount: number }}
 */
export function limitTextLines(text, maxResults) {
    const lines = text.split('\n');
    const trailingEmpty = lines.length > 0 && lines[lines.length - 1] === '';
    const comparableLines = trailingEmpty ? lines.slice(0, -1) : lines;
    if (maxResults === null || comparableLines.length <= maxResults) {
        return { text, truncated: false, originalLineCount: comparableLines.length };
    }
    return {
        text: comparableLines.slice(0, maxResults).join('\n'),
        truncated: true,
        originalLineCount: comparableLines.length,
    };
}
