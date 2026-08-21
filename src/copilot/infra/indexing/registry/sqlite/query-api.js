// @ts-check
/**
 * Read/query projection over the persistent index registry.
 *
 * This module owns query semantics only. It receives already prepared statements and the connection for the one
 * dynamic symbol query; it does not own schema lifecycle, index builds, mutations or filesystem access.
 *
 * @module copilot/infra/indexing/registry/sqlite/query-api
 */

import { buildIndexPathTreeRange, normalizeIndexPath } from './paths.js';
import { normalizeIndexMaxResults, sanitizeFtsQuery } from './query.js';

/** @typedef {ReturnType<typeof import('./statements.js').createIoIndexStatements>} IoIndexStatements */
/**
 * @typedef {{
 *     filePath: string;
 *     relativePath: string;
 *     chunkIndex: number;
 *     startLine: number;
 *     endLine: number;
 *     snippet: string;
 *     rank: number;
 *     content?: string;
 * }} IoIndexSearchResult
 * @typedef {{
 *     filePath: string;
 *     relativePath: string;
 *     symbolName: string;
 *     symbolKind: string;
 *     exported: number;
 *     line: number;
 *     docComment: string | null;
 * }} IoIndexSymbolResult
 * @typedef {{
 *     filePath: string;
 *     relativePath: string;
 *     source: string;
 *     specifiersJson: string;
 *     isDynamic: number;
 *     line: number;
 * }} IoIndexImportResult
 */

/**
 * @param {{
 *     db: { prepare: Function };
 *     statements: IoIndexStatements;
 *     stats: { searches: number };
 * }} context
 */
export function createIoIndexQueryApi({ db, statements, stats }) {
    const {
        stmtImportSearch,
        stmtImportSearchByPath,
        stmtLiteralSearch,
        stmtLiteralSearchInsensitive,
        stmtLiteralSearchInsensitiveScoped,
        stmtLiteralSearchScoped,
        stmtSearch,
        stmtSearchScoped,
    } = statements;

    return Object.freeze({
        /** @param {string} query @param {{ pathPrefix?: string; maxResults?: number }} [options] */
        search(query, options = {}) {
            stats.searches += 1;
            const safe = sanitizeFtsQuery(query);
            const maxResults = normalizeIndexMaxResults(options.maxResults);
            if (!options.pathPrefix) return /** @type {IoIndexSearchResult[]} */ (stmtSearch.all(safe, maxResults));
            const range = buildIndexPathTreeRange(normalizeIndexPath(options.pathPrefix));
            return /** @type {IoIndexSearchResult[]} */ (
                stmtSearchScoped.all(range.exact, range.descendantStart, range.descendantEnd, safe, maxResults)
            );
        },

        /** @param {string} query @param {{ pathPrefix?: string; maxResults?: number; caseSensitive?: boolean }} [options] */
        searchLiteral(query, options = {}) {
            stats.searches += 1;
            const literal = String(query ?? '');
            if (!literal) return /** @type {IoIndexSearchResult[]} */ ([]);
            const maxResults = normalizeIndexMaxResults(options.maxResults);
            const caseSensitive = options.caseSensitive === true;
            if (!options.pathPrefix) {
                const statement = caseSensitive ? stmtLiteralSearch : stmtLiteralSearchInsensitive;
                return /** @type {IoIndexSearchResult[]} */ (statement.all(literal, literal, maxResults));
            }
            const range = buildIndexPathTreeRange(normalizeIndexPath(options.pathPrefix));
            const statement = caseSensitive ? stmtLiteralSearchScoped : stmtLiteralSearchInsensitiveScoped;
            return /** @type {IoIndexSearchResult[]} */ (
                statement.all(literal, range.exact, range.descendantStart, range.descendantEnd, literal, maxResults)
            );
        },

        /**
         * @param {string} name
         * @param {{ maxResults?: number; pathPrefix?: string; kind?: string; exactMatch?: boolean; caseSensitive?: boolean }} [options]
         */
        findSymbol(name, options = {}) {
            stats.searches += 1;
            const safe = String(name ?? '').trim();
            if (!safe) return /** @type {IoIndexSymbolResult[]} */ ([]);
            /** @type {string[]} */
            const where = [];
            /** @type {unknown[]} */
            const params = [];
            if (options.exactMatch === true) {
                where.push(options.caseSensitive === true ? 's.symbol_name = ?' : 'lower(s.symbol_name) = lower(?)');
                params.push(safe);
            } else if (options.caseSensitive === true) {
                where.push('instr(s.symbol_name, ?) > 0');
                params.push(safe);
            } else {
                where.push('lower(s.symbol_name) LIKE lower(?)');
                params.push(`%${safe}%`);
            }
            if (options.kind && options.kind !== 'all') {
                where.push('s.symbol_kind = ?');
                params.push(options.kind);
            }
            if (options.pathPrefix) {
                const range = buildIndexPathTreeRange(options.pathPrefix);
                where.push('(s.file_path = ? OR (s.file_path >= ? AND s.file_path < ?))');
                params.push(range.exact, range.descendantStart, range.descendantEnd);
            }
            params.push(normalizeIndexMaxResults(options.maxResults));
            const sql = `
                SELECT
                    s.file_path as filePath,
                    f.relative_path as relativePath,
                    s.symbol_name as symbolName,
                    s.symbol_kind as symbolKind,
                    s.exported as exported,
                    s.line as line,
                    s.doc_comment as docComment
                FROM copilot_io_index_symbols s
                JOIN copilot_io_index_files f ON f.file_path = s.file_path
                WHERE ${where.join(' AND ')}
                ORDER BY s.symbol_name ASC, f.relative_path ASC
                LIMIT ?
            `;
            return /** @type {IoIndexSymbolResult[]} */ (db.prepare(sql).all(...params));
        },

        /** @param {string} source @param {{ maxResults?: number; exactSource?: boolean }} [options] */
        findImports(source, options = {}) {
            stats.searches += 1;
            const safe = String(source ?? '').trim();
            if (!safe) return /** @type {IoIndexImportResult[]} */ ([]);
            const rows = /** @type {IoIndexImportResult[]} */ (
                stmtImportSearch.all(safe, `%${safe}%`, normalizeIndexMaxResults(options.maxResults))
            );
            return options.exactSource ? rows.filter((row) => row.source === source) : rows;
        },

        /** @param {string} pathPrefix @returns {IoIndexImportResult[]} */
        findImportsByPath(pathPrefix) {
            stats.searches += 1;
            const range = buildIndexPathTreeRange(pathPrefix);
            return /** @type {IoIndexImportResult[]} */ (
                stmtImportSearchByPath.all(range.exact, range.descendantStart, range.descendantEnd)
            );
        },
    });
}
