// @ts-check
/**
 * Helpers puros para busca via índice FTS5.
 *
 * @module copilot/infra/io/search/index-search
 */

import { minimatch } from 'minimatch';

/**
 * Decide se a busca via índice FTS5 é viável para os parâmetros fornecidos.
 * `includePattern`/`excludePattern` são permitidos — o post-filter {@link filterIndexRowsByGlob}
 * é responsável por aplicar o filtro sobre os resultados do índice.
 *
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
    return opts.pattern.trim().length > 0 && !opts.isRegex && !opts.caseSensitive;
}

/**
 * Filtra linhas do índice FTS5 por glob de inclusão e/ou exclusão usando minimatch.
 *
 * Padrões sem barra (`/`) usam `matchBase: true` para corresponder apenas ao nome do arquivo.
 * Padrões com barra são testados contra o `relativePath` completo.
 *
 * @param {{ filePath: string; relativePath: string; snippet: string }[]} rows
 * @param {string | undefined} includePattern - Glob de inclusão (ex: "*.ts", "src/**\/*.js")
 * @param {string | undefined} excludePattern - Glob de exclusão (ex: "node_modules")
 * @returns {{ filePath: string; relativePath: string; snippet: string }[]}
 */
export function filterIndexRowsByGlob(rows, includePattern, excludePattern) {
    if (!includePattern && !excludePattern) return rows;

    return rows.filter((row) => {
        const target = row.relativePath || row.filePath;

        if (includePattern) {
            const matchBase = !includePattern.includes('/');
            if (!minimatch(target, includePattern, { matchBase, dot: true })) return false;
        }

        if (excludePattern) {
            const matchBase = !excludePattern.includes('/');
            if (minimatch(target, excludePattern, { matchBase, dot: true })) return false;
        }

        return true;
    });
}

/**
 * Formata linhas do índice FTS5 para string de saída legível.
 *
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
