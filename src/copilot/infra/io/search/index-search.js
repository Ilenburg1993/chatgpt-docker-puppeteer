// @ts-check
/**
 * Helpers puros para busca via índice FTS5.
 *
 * @module copilot/infra/io/search/index-search
 */

import { matchesGlobPattern } from '../../scan/glob.js';

/**
 * Decide se a busca via índice FTS5 é viável para os parâmetros fornecidos. `includePattern`/`excludePattern` são
 * permitidos — o post-filter {@link filterIndexRowsByGlob} é responsável por aplicar o filtro sobre os resultados do
 * índice.
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
 * Padrões sem barra (`/`) usam `matchBase: true` para corresponder apenas ao nome do arquivo. Padrões com barra são
 * testados contra o `relativePath` completo.
 *
 * @template {{ filePath: string; relativePath: string }} T
 * @param {T[]} rows
 * @param {string | undefined} includePattern - Glob de inclusão (ex: "_.ts", "src/(recursivo)/_.js")
 * @param {string | undefined} excludePattern - Glob de exclusão (ex: "node_modules")
 * @returns {T[]}
 */
export function filterIndexRowsByGlob(rows, includePattern, excludePattern) {
    if (!includePattern && !excludePattern) return rows;

    return rows.filter((row) => {
        const target = row.relativePath || row.filePath;

        if (includePattern) {
            if (!matchesGlobPattern(target, includePattern)) {
                return false;
            }
        }

        if (excludePattern) {
            if (matchesGlobPattern(target, excludePattern)) {
                return false;
            }
        }

        return true;
    });
}

/**
 * Formata linhas do índice FTS5 para string de saída legível. Highlights FTS5 `[match]` são convertidos para
 * `**match**` (markdown bold).
 *
 * @param {{
 *     filePath: string;
 *     relativePath: string;
 *     snippet: string;
 *     startLine?: number;
 *     endLine?: number;
 * }[]} rows
 * @returns {string}
 */
export function formatIndexSearchRows(rows) {
    return rows
        .map((row) => {
            const snippet = String(row.snippet ?? '')
                .replace(/\[([^\]]*)\]/gu, '**$1**')
                .replace(/\s+/gu, ' ')
                .trim();
            const path = row.relativePath || row.filePath;
            const startLine = Number(row.startLine ?? 0);
            const endLine = Number(row.endLine ?? startLine);
            const location =
                startLine > 0 ? `${path}:${startLine}${endLine > startLine ? `-${endLine}` : ''}` : path;
            return `${location}: ${snippet}`;
        })
        .join('\n');
}

/**
 * Formata linhas do índice de imports para string de saída legível.
 *
 * @param {{
 *     filePath: string;
 *     relativePath: string;
 *     source: string;
 *     specifiersJson: string;
 *     isDynamic: number | boolean;
 *     line: number;
 * }[]} rows
 * @returns {string}
 */
export function formatIndexImportRows(rows) {
    return rows
        .map((row) => {
            const location = `${row.relativePath || row.filePath}:${row.line}`;
            let specifiers = '';
            try {
                const parsed = JSON.parse(String(row.specifiersJson ?? '[]'));
                if (Array.isArray(parsed) && parsed.length > 0) {
                    specifiers = ` { ${parsed.join(', ')} }`;
                }
            } catch {
                // ignore malformed JSON — specifiers omitted
            }
            const dynamic = row.isDynamic ? ' (dynamic)' : '';
            return `${location}: import${specifiers}${dynamic} from '${row.source}'`;
        })
        .join('\n');
}
