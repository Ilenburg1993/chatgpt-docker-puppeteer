// @ts-check
/**
 * Small HTML table/text helpers for docs-based catalog importers.
 *
 * This is not a browser parser. It intentionally handles static provider docs pages and server-rendered table markup
 * well enough to produce catalog evidence, while runtime access remains validated elsewhere.
 *
 * @module copilot/model-gateway/catalog/importers/html-docs-parser
 */

/**
 * @param {string} value
 * @returns {string}
 */
export function decodeHtmlEntities(value) {
    return value
        .replace(/&nbsp;/giu, ' ')
        .replace(/&amp;/giu, '&')
        .replace(/&quot;/giu, '"')
        .replace(/&#x27;/giu, "'")
        .replace(/&#39;/giu, "'")
        .replace(/&le;/giu, '<=')
        .replace(/&ge;/giu, '>=')
        .replace(/&lt;/giu, '<')
        .replace(/&gt;/giu, '>');
}

/**
 * @param {unknown} value
 * @param {object} [options]
 * @param {boolean} [options.keepScripts]
 * @param {boolean} [options.decodeBeforeStrip]
 * @param {boolean} [options.unescapeJsStrings]
 * @returns {string}
 */
export function htmlText(value, options = {}) {
    let text = String(value ?? '').replace(/<!--[\s\S]*?-->/gu, '');
    if (!options.keepScripts) {
        text = text.replace(/<script\b[\s\S]*?<\/script>/giu, ' ').replace(/<style\b[\s\S]*?<\/style>/giu, ' ');
    }
    if (options.decodeBeforeStrip) text = decodeHtmlEntities(text);
    text = text.replace(/<[^>]*>/gu, ' ');
    if (!options.decodeBeforeStrip) text = decodeHtmlEntities(text);
    if (options.unescapeJsStrings) text = text.replace(/\\(["/])/gu, '$1');
    return text.replace(/\s+/gu, ' ').trim();
}

/**
 * @param {string} rowHtml
 * @returns {string[]}
 */
export function htmlTableCells(rowHtml) {
    return [...rowHtml.matchAll(/<t[dh]\b[\s\S]*?<\/t[dh]>/giu)].map((match) => htmlText(match[0]));
}

/**
 * @param {string} html
 * @returns {string[]}
 */
export function htmlTableRows(html) {
    return [...html.matchAll(/<tr\b[\s\S]*?<\/tr>/giu)].map((match) => match[0]);
}

/**
 * @param {string} html
 * @returns {string[][][]}
 */
export function htmlTables(html) {
    return [...html.matchAll(/<table\b[\s\S]*?<\/table>/giu)].map((table) =>
        htmlTableRows(table[0]).map(htmlTableCells).filter((cells) => cells.length > 0),
    );
}
