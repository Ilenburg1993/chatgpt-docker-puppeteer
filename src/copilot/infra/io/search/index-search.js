// @ts-check
/**
 * Helpers puros para busca via índice FTS5.
 *
 * @module copilot/infra/io/search/index-search
 */

import { minimatch } from 'minimatch';

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

    /**
     * Padrões sem barra e sem metacaracteres podem representar tanto basename quanto segmento de diretório. Ex.:
     * `node_modules` deve excluir `node_modules/lib.ts`, e não apenas arquivos chamados literalmente `node_modules`.
     *
     * @param {string} target
     * @param {string} pattern
     * @returns {boolean}
     */
    const matchesSegmentPattern = (target, pattern) => {
        const hasSlash = pattern.includes('/');
        const hasGlobMeta = /[*?[\]{}()!+@]/u.test(pattern);
        if (hasSlash || hasGlobMeta) return false;
        return target === pattern || target.startsWith(`${pattern}/`) || target.includes(`/${pattern}/`);
    };

    return rows.filter((row) => {
        const target = row.relativePath || row.filePath;

        if (includePattern) {
            const matchBase = !includePattern.includes('/');
            if (!minimatch(target, includePattern, { matchBase, dot: true })) return false;
        }

        if (excludePattern) {
            const matchBase = !excludePattern.includes('/');
            if (
                minimatch(target, excludePattern, { matchBase, dot: true }) ||
                matchesSegmentPattern(target, excludePattern)
            ) {
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
 * @param {{ filePath: string; relativePath: string; snippet: string }[]} rows
 * @returns {string}
 */
export function formatIndexSearchRows(rows) {
    return rows
        .map((row) => {
            const snippet = String(row.snippet ?? '')
                .replace(/\[([^\]]*)\]/gu, '**$1**')
                .replace(/\s+/gu, ' ')
                .trim();
            return `${row.relativePath || row.filePath}: ${snippet}`;
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
