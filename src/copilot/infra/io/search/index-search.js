// @ts-check
/**
 * Helpers puros para busca via índice.
 *
 * @module copilot/infra/io/search/index-search
 */

/**
 * @param {{
 *     pattern: string;
 *     isRegex?: boolean;
 *     caseSensitive?: boolean;
 *     includePattern?: string;
 *     excludePattern?: string;
 * }} opts
 * @returns {boolean}
 */
export function canUseIndexSearch(opts) {
    return (
        opts.pattern.trim().length > 0 &&
        !opts.isRegex &&
        !opts.caseSensitive &&
        !opts.includePattern &&
        !opts.excludePattern
    );
}

/**
 * @param {{ filePath: string; relativePath: string; snippet: string }[]} rows
 * @returns {string}
 */
export function formatIndexSearchRows(rows) {
    return rows
        .map((row) => {
            const snippet = String(row.snippet ?? '')
                .replaceAll('[', '')
                .replaceAll(']', '')
                .replace(/\s+/gu, ' ')
                .trim();
            return `${row.relativePath || row.filePath}: ${snippet}`;
        })
        .join('\n');
}
