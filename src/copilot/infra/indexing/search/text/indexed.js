// @ts-check
/** Derived-index acceleration/fallback decision for completeness-oriented text search. */

import { getIoIndexStats, searchIoIndex, searchIoIndexLiteral } from '#copilot/infra/internal/indexing/registry';
import { utf8ByteLength } from '#copilot/infra/internal/platform';
import { publishIoOperationResult } from '#copilot/infra/internal/telemetry';
import { countSearchOutputLines, paginateSearchText, sanitizeSearchOutput } from '../shared/index.js';
import {
    canUseIndexSearch,
    filterIndexRowsByGlob,
    formatIndexSearchRows,
    formatLiteralIndexSearchRows,
} from './indexed-format.js';

/** @typedef {import('./types.js').TextSearchOptions} TextSearchOptions */
/** @typedef {import('./types.js').TextSearchResult} TextSearchResult */
/** @typedef {import('./types.js').BuildSearchIo} BuildSearchIo */

/** @param {string} pattern @returns {string[] | null} */
function parseSimpleRegexAlternation(pattern) {
    const trimmed = pattern.trim();
    if (!trimmed.includes('|')) return null;
    if (!/^[A-Za-z0-9_./:-]+(?:\|[A-Za-z0-9_./:-]+)+$/u.test(trimmed)) return null;
    const terms = [
        ...new Set(
            trimmed
                .split('|')
                .map((part) => part.trim())
                .filter(Boolean),
        ),
    ];
    return terms.length >= 2 && terms.length <= 12 ? terms : null;
}

/** @param {string} value */
function isAsciiLiteral(value) {
    for (let index = 0; index < value.length; index += 1) if (value.charCodeAt(index) > 0x7f) return false;
    return true;
}

/**
 * @param {string} targetPath
 * @param {TextSearchOptions} options
 * @param {ReturnType<typeof import('../shared/index.js').normalizeSearchWindow>} searchWindow
 * @param {boolean} ripgrepAvailable
 * @param {BuildSearchIo} buildSearchIo
 * @returns {{ result: TextSearchResult | null; indexFallback: boolean; indexFallbackReason: string | null }}
 */
export function trySearchTextViaIndex(targetPath, options, searchWindow, ripgrepAvailable, buildSearchIo) {
    /** @type {boolean} */
    let indexFallback = false;
    /** @type {string | null} */
    let indexFallbackReason = null;
    /** @returns {TextSearchResult | null} */
    const run = () => {
        // Avoid the five aggregate SQLite queries in getIoIndexStats() on the normal rg path. The stats snapshot is
        // needed only when we actually have to use the index because rg is unavailable.
        const indexStats = ripgrepAvailable
            ? /** @type {ReturnType<typeof getIoIndexStats>} */ ({})
            : getIoIndexStats();
        const indexSearchOptions = {
            pattern: options.pattern,
            ...(options.isRegex !== undefined ? { isRegex: options.isRegex } : {}),
            ...(options.caseSensitive !== undefined ? { caseSensitive: options.caseSensitive } : {}),
            ...(options.includePattern ? { includePattern: options.includePattern } : {}),
            ...(options.excludePattern ? { excludePattern: options.excludePattern } : {}),
        };

        const freshFiles = 'freshFiles' in indexStats ? Number(indexStats.freshFiles ?? 0) : 0;
        const literalIndexEligible =
            !ripgrepAvailable &&
            options.isRegex !== true &&
            (options.contextLines ?? 0) === 0 &&
            Boolean(indexStats?.available) &&
            freshFiles > 0 &&
            (options.caseSensitive === true || isAsciiLiteral(options.pattern));
        if (literalIndexEligible) {
            const literalRows = searchIoIndexLiteral(options.pattern, {
                pathPrefix: targetPath,
                ...(searchWindow.commandMaxCount === null ? {} : { maxResults: searchWindow.commandMaxCount }),
                caseSensitive: options.caseSensitive === true,
            });
            const filteredLiteralRows = filterIndexRowsByGlob(
                literalRows,
                options.includePattern,
                options.excludePattern,
            );
            if (filteredLiteralRows.length > 0) {
                const literalOutput = formatLiteralIndexSearchRows(
                    filteredLiteralRows,
                    options.pattern,
                    options.caseSensitive === true,
                );
                const sanitizedOutput = sanitizeSearchOutput(literalOutput);
                const windowedOutput = paginateSearchText(sanitizedOutput.text, searchWindow);
                const returnedMatchCount = countSearchOutputLines(windowedOutput.text);
                const totalMatchCount = windowedOutput.originalLineCount;
                const io = publishIoOperationResult(
                    buildSearchIo(
                        'io-engine.index.literal-search',
                        utf8ByteLength(windowedOutput.text, 'search output'),
                        {
                            redactions: sanitizedOutput.redactions,
                            countsPostSanitization: true,
                            fallback: 'fts5-or-rg-on-index-literal-miss',
                            truncated: windowedOutput.truncated,
                            originalResultCount: totalMatchCount,
                            nextCursor: windowedOutput.nextCursor,
                        },
                    ),
                    true,
                );
                return {
                    targetPath,
                    pattern: options.pattern,
                    output: windowedOutput.text,
                    matchCount: returnedMatchCount,
                    returnedMatchCount,
                    returnedLineCount: returnedMatchCount,
                    engine: 'sqlite-index-literal',
                    sanitized: sanitizedOutput.sanitized,
                    redactions: sanitizedOutput.redactions,
                    truncated: windowedOutput.truncated,
                    nextCursor: windowedOutput.nextCursor,
                    cursorOffset: windowedOutput.cursorOffset,
                    totalMatches: totalMatchCount,
                    totalMatchCount,
                    totalLineCount: totalMatchCount,
                    countsPostSanitization: true,
                    indexFallback: false,
                    indexFallbackReason: null,
                    io: { ...io, truncated: windowedOutput.truncated, policyVersion: sanitizedOutput.policyVersion },
                };
            }
        }

        if (!ripgrepAvailable && canUseIndexSearch(indexSearchOptions)) {
            const freshFiles = 'freshFiles' in indexStats ? Number(indexStats.freshFiles ?? 0) : 0;
            const indexRows =
                Boolean(indexStats?.available) && freshFiles > 0
                    ? searchIoIndex(options.pattern, {
                          pathPrefix: targetPath,
                          ...(searchWindow.commandMaxCount === null
                              ? {}
                              : { maxResults: searchWindow.commandMaxCount }),
                      })
                    : [];
            const filteredRows = filterIndexRowsByGlob(indexRows, options.includePattern, options.excludePattern);
            if (filteredRows.length > 0) {
                const sanitizedOutput = sanitizeSearchOutput(formatIndexSearchRows(filteredRows));
                const windowedOutput = paginateSearchText(sanitizedOutput.text, searchWindow);
                const returnedMatchCount = countSearchOutputLines(windowedOutput.text);
                const totalMatchCount = windowedOutput.originalLineCount;
                const io = publishIoOperationResult(
                    buildSearchIo('io-engine.index.search', utf8ByteLength(windowedOutput.text, 'search output'), {
                        redactions: sanitizedOutput.redactions,
                        countsPostSanitization: true,
                        fallback: 'rg-on-index-miss-or-complex-query',
                        truncated: windowedOutput.truncated,
                        originalResultCount: totalMatchCount,
                        nextCursor: windowedOutput.nextCursor,
                    }),
                    true,
                );
                return {
                    targetPath,
                    pattern: options.pattern,
                    output: windowedOutput.text,
                    matchCount: returnedMatchCount,
                    returnedMatchCount,
                    returnedLineCount: returnedMatchCount,
                    engine: 'fts5-index',
                    sanitized: sanitizedOutput.sanitized,
                    redactions: sanitizedOutput.redactions,
                    truncated: windowedOutput.truncated,
                    nextCursor: windowedOutput.nextCursor,
                    cursorOffset: windowedOutput.cursorOffset,
                    totalMatches: totalMatchCount,
                    totalMatchCount,
                    totalLineCount: totalMatchCount,
                    countsPostSanitization: true,
                    indexFallback: false,
                    indexFallbackReason: null,
                    io: { ...io, truncated: windowedOutput.truncated, policyVersion: sanitizedOutput.policyVersion },
                };
            }
            indexFallback = true;
            indexFallbackReason =
                indexRows.length === 0
                    ? Boolean(indexStats?.available) && freshFiles > 0
                        ? 'index-no-matches'
                        : 'index-unavailable-or-stale'
                    : 'index-filtered-out-by-glob';
        } else if (
            !ripgrepAvailable &&
            options.isRegex === true &&
            options.caseSensitive !== true &&
            (options.contextLines ?? 0) === 0
        ) {
            const terms = parseSimpleRegexAlternation(options.pattern);
            const freshFiles = 'freshFiles' in indexStats ? Number(indexStats.freshFiles ?? 0) : 0;
            const perTermRows =
                terms && Boolean(indexStats?.available) && freshFiles > 0
                    ? terms.map((term) =>
                          searchIoIndex(term, {
                              pathPrefix: targetPath,
                              ...(searchWindow.commandMaxCount === null
                                  ? {}
                                  : { maxResults: Math.min(Math.max(searchWindow.commandMaxCount, 100), 500) }),
                          }),
                      )
                    : [];
            const hasCompleteTermCoverage =
                Array.isArray(terms) &&
                perTermRows.length === terms.length &&
                perTermRows.every((termRows) => termRows.length > 0);
            const rows = hasCompleteTermCoverage ? perTermRows.flat() : [];
            const seenRows = new Set();
            const uniqueRows = rows.filter((row) => {
                const key = `${row.relativePath || row.filePath}\u0000${row.snippet}`;
                if (seenRows.has(key)) return false;
                seenRows.add(key);
                return true;
            });
            const filteredRows = filterIndexRowsByGlob(uniqueRows, options.includePattern, options.excludePattern);
            if (filteredRows.length > 0) {
                const sanitizedOutput = sanitizeSearchOutput(formatIndexSearchRows(filteredRows));
                const windowedOutput = paginateSearchText(sanitizedOutput.text, searchWindow);
                const returnedMatchCount = countSearchOutputLines(windowedOutput.text);
                const totalMatchCount = windowedOutput.originalLineCount;
                const io = publishIoOperationResult(
                    buildSearchIo(
                        'io-engine.index.regex-alternation-search',
                        utf8ByteLength(windowedOutput.text, 'search output'),
                        {
                            redactions: sanitizedOutput.redactions,
                            countsPostSanitization: true,
                            fallback: 'rg-on-index-miss-or-complex-query',
                            truncated: windowedOutput.truncated,
                            originalResultCount: totalMatchCount,
                            nextCursor: windowedOutput.nextCursor,
                        },
                    ),
                    true,
                );
                return {
                    targetPath,
                    pattern: options.pattern,
                    output: windowedOutput.text,
                    matchCount: returnedMatchCount,
                    returnedMatchCount,
                    returnedLineCount: returnedMatchCount,
                    engine: 'fts5-index-regex-alternation',
                    sanitized: sanitizedOutput.sanitized,
                    redactions: sanitizedOutput.redactions,
                    truncated: windowedOutput.truncated,
                    nextCursor: windowedOutput.nextCursor,
                    cursorOffset: windowedOutput.cursorOffset,
                    totalMatches: totalMatchCount,
                    totalMatchCount,
                    totalLineCount: totalMatchCount,
                    countsPostSanitization: true,
                    indexFallback: false,
                    indexFallbackReason: null,
                    io: { ...io, truncated: windowedOutput.truncated, policyVersion: sanitizedOutput.policyVersion },
                };
            }
            indexFallback = true;
            indexFallbackReason = terms
                ? hasCompleteTermCoverage
                    ? 'index-no-matches-for-regex-alternation'
                    : 'index-incomplete-term-coverage-for-regex-alternation'
                : 'query-not-index-compatible';
        } else {
            indexFallback = !ripgrepAvailable;
            indexFallbackReason = ripgrepAvailable ? null : 'query-not-index-compatible';
        }

        return null;
    };
    const result = run();
    return { result: result ?? null, indexFallback, indexFallbackReason };
}
