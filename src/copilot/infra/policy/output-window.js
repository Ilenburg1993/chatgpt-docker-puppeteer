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
 * Conta linhas LF comparáveis, excluindo a entrada vazia criada por newline terminal.
 *
 * @param {string} text
 * @returns {number}
 */
function countComparableTextLines(text) {
    if (text.length === 0) return 0;
    let lines = 1;
    for (let index = 0; index < text.length; index += 1) {
        if (text.charCodeAt(index) === 10) lines += 1;
    }
    return text.charCodeAt(text.length - 1) === 10 ? lines - 1 : lines;
}

/**
 * Recorta linhas LF em offsets zero-based sem materializar o texto completo em array.
 *
 * @param {string} text
 * @param {number} startLine
 * @param {number} endLine
 * @param {number} totalLines
 * @returns {string}
 */
function sliceComparableTextLines(text, startLine, endLine, totalLines) {
    if (startLine >= totalLines || endLine <= startLine) return '';
    let currentLine = 0;
    let startOffset = startLine === 0 ? 0 : -1;
    let endOffset = text.charCodeAt(text.length - 1) === 10 ? text.length - 1 : text.length;

    for (let index = 0; index < text.length; index += 1) {
        if (text.charCodeAt(index) !== 10) continue;
        currentLine += 1;
        if (currentLine === startLine) startOffset = index + 1;
        if (currentLine === endLine) {
            endOffset = index;
            break;
        }
    }
    return text.slice(startOffset, endOffset);
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
    const originalLineCount = countComparableTextLines(text);
    if (maxResults === null || originalLineCount <= maxResults) {
        return { text, truncated: false, originalLineCount };
    }
    return {
        text: sliceComparableTextLines(text, 0, maxResults, originalLineCount),
        truncated: true,
        originalLineCount,
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
    const originalLineCount = countComparableTextLines(text);
    const cursorOffset = normalizeCursorOffset(options.cursor, { strict: options.strictCursor === true });
    if (options.maxResults === null) {
        return {
            text: sliceComparableTextLines(text, cursorOffset, originalLineCount, originalLineCount),
            truncated: false,
            originalLineCount,
            cursorOffset,
            nextCursor: null,
        };
    }
    const endOffset = cursorOffset + options.maxResults;
    const nextCursor = originalLineCount > endOffset ? String(endOffset) : null;
    return {
        text: sliceComparableTextLines(text, cursorOffset, endOffset, originalLineCount),
        truncated: nextCursor !== null,
        originalLineCount,
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
