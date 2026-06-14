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
 * @returns {Error & { code: string; cursor: string | number | null | undefined }}
 */
function createInvalidCursorError(value) {
    return Object.assign(new Error(`Cursor de paginação inválido: ${String(value)}`), {
        code: 'ERR_INVALID_CURSOR',
        cursor: value,
    });
}

/**
 * @param {string | number | null | undefined} value
 * @param {{ strict?: boolean }} [options]
 * @returns {number}
 */
export function normalizeCursorOffset(value, options = {}) {
    if (value === undefined || value === null || value === '') return 0;
    const parsed = Number(value);
    const valid = Number.isFinite(parsed) && parsed >= 0 && Number.isInteger(parsed);
    if (!valid) {
        if (options.strict === true) throw createInvalidCursorError(value);
        return 0;
    }
    return parsed;
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
 * @param {{ maxResults: number | null; cursor?: string | number | null; strictCursor?: boolean }} options
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
    const cursorOffset = normalizeCursorOffset(options.cursor, { strict: options.strictCursor === true });
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
 * @param {{ maxResults: number | null; cursor?: string | number | null; strictCursor?: boolean }} options
 * @returns {{ items: T[]; truncated: boolean; totalItems: number; cursorOffset: number; nextCursor: string | null }}
 */
export function windowItems(items, options) {
    const cursorOffset = normalizeCursorOffset(options.cursor, { strict: options.strictCursor === true });
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
