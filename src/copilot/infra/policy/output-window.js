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
 * @param {string | number | null | undefined} value
 * @returns {number}
 */
export function normalizeCursorOffset(value) {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
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

/**
 * @param {string} text
 * @param {{ maxResults: number | null; cursor?: string | number | null }} options
 * @returns {{
 *     text: string;
 *     truncated: boolean;
 *     originalLineCount: number;
 *     cursorOffset: number;
 *     nextCursor: string | null;
 * }}
 */
export function windowTextLines(text, options) {
    const lines = text.split('\n');
    const trailingEmpty = lines.length > 0 && lines[lines.length - 1] === '';
    const comparableLines = trailingEmpty ? lines.slice(0, -1) : lines;
    const cursorOffset = normalizeCursorOffset(options.cursor);
    if (options.maxResults === null) {
        return {
            text: comparableLines.slice(cursorOffset).join('\n'),
            truncated: false,
            originalLineCount: comparableLines.length,
            cursorOffset,
            nextCursor: null,
        };
    }
    const endOffset = cursorOffset + options.maxResults;
    const nextCursor = comparableLines.length > endOffset ? String(endOffset) : null;
    return {
        text: comparableLines.slice(cursorOffset, endOffset).join('\n'),
        truncated: nextCursor !== null,
        originalLineCount: comparableLines.length,
        cursorOffset,
        nextCursor,
    };
}

/**
 * @template T
 * @param {readonly T[]} items
 * @param {{ maxResults: number | null; cursor?: string | number | null }} options
 * @returns {{ items: T[]; truncated: boolean; totalItems: number; cursorOffset: number; nextCursor: string | null }}
 */
export function windowItems(items, options) {
    const cursorOffset = normalizeCursorOffset(options.cursor);
    if (options.maxResults === null) {
        return {
            items: [...items.slice(cursorOffset)],
            truncated: false,
            totalItems: items.length,
            cursorOffset,
            nextCursor: null,
        };
    }
    const endOffset = cursorOffset + options.maxResults;
    const nextCursor = items.length > endOffset ? String(endOffset) : null;
    return {
        items: [...items.slice(cursorOffset, endOffset)],
        truncated: nextCursor !== null,
        totalItems: items.length,
        cursorOffset,
        nextCursor,
    };
}
