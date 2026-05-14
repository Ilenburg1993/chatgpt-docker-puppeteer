// @ts-check
/**
 * Paginação estruturada para resultados de busca.
 *
 * @module copilot/infra/io/search/result-paginator
 */

import { normalizeCursorOffset, normalizeMaxResults, windowItems, windowTextLines } from '../../policy/output-window.js';

/**
 * @typedef {{
 *     maxResults: number | null;
 *     cursor?: string | number | null;
 *     cursorOffset: number;
 *     commandMaxCount: number | null;
 * }} SearchWindow
 */

/**
 * @param {{ maxResults?: number; cursor?: string | number | null }} [options]
 * @returns {SearchWindow}
 */
export function normalizeSearchWindow(options = {}) {
    const maxResults = normalizeMaxResults(options.maxResults);
    const cursorOffset = normalizeCursorOffset(options.cursor);
    return {
        maxResults,
        ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
        cursorOffset,
        commandMaxCount: maxResults === null ? null : cursorOffset + maxResults + 1,
    };
}

/**
 * @template T
 * @param {readonly T[]} items
 * @param {SearchWindow} window
 * @returns {{ items: T[]; truncated: boolean; totalItems: number; cursorOffset: number; nextCursor: string | null }}
 */
export function paginateSearchItems(items, window) {
    return windowItems(items, {
        maxResults: window.maxResults,
        ...(window.cursor === undefined ? {} : { cursor: window.cursor }),
    });
}

/**
 * @param {string} text
 * @param {SearchWindow} window
 * @returns {{
 *     text: string;
 *     truncated: boolean;
 *     originalLineCount: number;
 *     cursorOffset: number;
 *     nextCursor: string | null;
 * }}
 */
export function paginateSearchText(text, window) {
    return windowTextLines(text, {
        maxResults: window.maxResults,
        ...(window.cursor === undefined ? {} : { cursor: window.cursor }),
    });
}
