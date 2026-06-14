// @ts-check
/**
 * Busca textual e simbólica para workspace local.
 *
 * Extraído de `io-engine` para reduzir acoplamento e manter a facade pública estável.
 *
 * @module copilot/infra/io/search/text-search
 */

import { buildIoMeta, createIoTraceId, sanitizeIoTextOutput } from '#copilot/core';
import { findIoIndexSymbol, getIoIndexStats, searchIoIndex } from '../../io-index-registry.js';
import { nowIoMs, publishIoOperation } from '../../io-observability.js';
import { resolveIoSearchBudget } from '../../policy/budgets.js';
import { hasNullByte } from '../../policy/path-resource.js';
import { utf8ByteLength } from '../../shared/buffer.js';
import { buildGrepArgs } from './grep-adapter.js';
import { canUseIndexSearch, filterIndexRowsByGlob, formatIndexSearchRows } from './index-search.js';
import { normalizeSearchWindow, paginateSearchText } from './result-paginator.js';
import { isRipgrepAvailable, streamSearchFile } from './subprocess.js';
import { buildSymbolPattern, formatIndexSymbolRows, kindToGlobs } from './symbol-search.js';

/** @type {ReturnType<typeof resolveIoSearchBudget> | null} */
let _ioSearchBudget = null;

/**
 * @returns {ReturnType<typeof resolveIoSearchBudget>}
 */
function getIoSearchBudget() {
    return (_ioSearchBudget ??= resolveIoSearchBudget());
}

/**
 * @param {number} startedAt
 * @returns {number}
 */
function elapsedMs(startedAt) {
    return Math.max(0, Math.round(nowIoMs() - startedAt));
}

/**
 * @param {unknown} targetPath
 * @returns {asserts targetPath is string}
 */
function assertValidTargetPath(targetPath) {
    if (typeof targetPath !== 'string' || hasNullByte(targetPath)) {
        const error = /** @type {TypeError & { code?: string }} */ (
            new TypeError(`Path inválido: ${String(targetPath)}`)
        );
        error.code = 'ERR_INVALID_ARG_VALUE';
        throw error;
    }
}

const sensitiveLineRe = /-----BEGIN [A-Z ]+-----|ey[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/;

/**
 * @param {string} line
 * @returns {{ text: string; sanitized: boolean; redactions: number; filtered: boolean; policyVersion: string }}
 */
function sanitizeSearchLine(line) {
    if (sensitiveLineRe.test(line)) {
        const sanitized = sanitizeIoTextOutput({ text: '' });
        return { ...sanitized, filtered: true, sanitized: true, redactions: sanitized.redactions + 1 };
    }
    return { ...sanitizeIoTextOutput({ text: line }), filtered: false };
}

/**
 * @param {string} stdout
 * @returns {{
 *     text: string;
 *     sanitized: boolean;
 *     redactions: number;
 *     filteredLines: number;
 *     policyVersion: string;
 * }}
 */
function sanitizeSearchOutput(stdout) {
    let filteredLines = 0;
    const sanitizedLines = stdout
        .split('\n')
        .map((line) => sanitizeSearchLine(line))
        .filter((line) => {
            if (!line.filtered) return true;
            filteredLines += 1;
            return false;
        })
        .map((line) => line.text)
        .join('\n');
    const sanitized = sanitizeIoTextOutput({ text: sanitizedLines });
    return {
        ...sanitized,
        sanitized: filteredLines > 0 || sanitized.sanitized,
        redactions: filteredLines + sanitized.redactions,
        filteredLines,
    };
}

/**
 * @param {import('./result-paginator.js').SearchWindow} searchWindow
 */
function createStreamingSearchCollector(searchWindow) {
    /** @type {string[]} */
    const lines = [];
    const stopAfter = searchWindow.maxResults === null ? null : searchWindow.cursorOffset + searchWindow.maxResults + 1;
    let sanitized = false;
    let redactions = 0;
    let filteredLines = 0;
    let policyVersion = 'unknown';

    return {
        /**
         * @param {string} line
         * @returns {boolean}
         */
        accept(line) {
            const result = sanitizeSearchLine(line);
            policyVersion = result.policyVersion;
            if (result.filtered) {
                sanitized = true;
                redactions += result.redactions;
                filteredLines += 1;
                return true;
            }
            sanitized = sanitized || result.sanitized;
            redactions += result.redactions;
            lines.push(result.text);
            return stopAfter === null || lines.length < stopAfter;
        },
        snapshot() {
            return {
                text: lines.join('\n'),
                sanitized,
                redactions,
                filteredLines,
                policyVersion,
            };
        },
    };
}

/**
 * Conta apenas linhas de match real (`path:linenum:text`), excluindo contexto (`path-linenum-text`) e separadores.
 *
 * @param {string} text
 * @returns {number}
 */
function countSearchMatchLines(text) {
    return text.split('\n').filter((line) => /^(?:.+:)?\d+:/.test(line)).length;
}

/**
 * @param {string} text
 * @returns {number}
 */
function countSearchOutputLines(text) {
    if (!text) return 0;
    const lines = text.split('\n');
    return lines[lines.length - 1] === '' ? lines.length - 1 : lines.length;
}

/**
 * @param {string} pattern
 * @returns {string[] | null}
 */
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

/**
 * @param {import('#copilot/core/io-contracts').IoMeta} io
 * @param {boolean} success
 * @param {unknown} [error]
 * @returns {import('#copilot/core/io-contracts').IoMeta}
 */
function publishAndReturn(io, success, error) {
    publishIoOperation(io, { success, ...(error !== undefined ? { error } : {}) });
    return io;
}

/**
 * Busca texto/regex em arquivos já validados pelo adapter da tool.
 *
 * @param {string} targetPath
 * @param {{
 *     workspaceRoot?: string;
 *     pattern: string;
 *     isRegex?: boolean;
 *     caseSensitive?: boolean;
 *     includePattern?: string;
 *     excludePattern?: string;
 *     contextLines?: number;
 *     withLineNumbers?: boolean;
 *     maxResults?: number;
 *     cursor?: string | number | null;
 *     traceId?: string;
 * }} options
 * @returns {Promise<{
 *     targetPath: string;
 *     pattern: string;
 *     output: string;
 *     matchCount: number;
 *     returnedMatchCount?: number;
 *     returnedLineCount?: number;
 *     engine: string;
 *     sanitized: boolean;
 *     redactions: number;
 *     truncated?: boolean;
 *     nextCursor?: string | null;
 *     cursorOffset?: number;
 *     totalMatches?: number;
 *     totalMatchCount?: number;
 *     totalLineCount?: number;
 *     countsPostSanitization: true;
 *     indexFallback?: boolean;
 *     indexFallbackReason?: string | null;
 *     io: import('#copilot/core/io-contracts').IoMeta;
 * }>}
 */
export async function searchText(targetPath, options) {
    assertValidTargetPath(targetPath);
    if (typeof options.pattern !== 'string' || options.pattern.trim().length === 0) {
        const error = /** @type {TypeError & { code?: string }} */ (new TypeError('pattern inválido para searchText'));
        error.code = 'ERR_INVALID_ARG_VALUE';
        throw error;
    }
    if (options.includePattern !== undefined && hasNullByte(String(options.includePattern))) {
        const error = /** @type {TypeError & { code?: string }} */ (
            new TypeError('includePattern inválido para searchText')
        );
        error.code = 'ERR_INVALID_ARG_VALUE';
        throw error;
    }
    if (options.excludePattern !== undefined && hasNullByte(String(options.excludePattern))) {
        const error = /** @type {TypeError & { code?: string }} */ (
            new TypeError('excludePattern inválido para searchText')
        );
        error.code = 'ERR_INVALID_ARG_VALUE';
        throw error;
    }

    const startedAt = nowIoMs();
    const traceId = options.traceId ?? createIoTraceId();
    const searchWindow = normalizeSearchWindow(options);
    const ioSearchBudget = getIoSearchBudget();
    const advisoryLimitsBase = {
        requestedMaxResults: searchWindow.maxResults,
        cursorOffset: searchWindow.cursorOffset,
        limitMode: 'enforced-output-window',
        patternLength: options.pattern.length,
        timeoutMs: ioSearchBudget.timeoutMs,
        maxBufferBytes: ioSearchBudget.maxBufferBytes,
    };

    /**
     * @param {string} engine
     * @param {number} bytesRead
     * @param {Record<string, unknown>} [extra]
     */
    const buildSearchIo = (engine, bytesRead, extra = {}) =>
        buildIoMeta({
            operation: 'search',
            target: targetPath,
            targetKind: 'workspace',
            bytesRead,
            durationMs: elapsedMs(startedAt),
            engine,
            riskClass: 'low',
            traceId,
            advisoryLimits: { ...advisoryLimitsBase, ...extra },
        });

    /** @type {boolean} */
    let indexFallback;
    /** @type {string | null} */
    let indexFallbackReason;

    try {
        const indexStats = getIoIndexStats();
        const indexSearchOptions = {
            pattern: options.pattern,
            ...(options.isRegex !== undefined ? { isRegex: options.isRegex } : {}),
            ...(options.caseSensitive !== undefined ? { caseSensitive: options.caseSensitive } : {}),
            ...(options.includePattern ? { includePattern: options.includePattern } : {}),
            ...(options.excludePattern ? { excludePattern: options.excludePattern } : {}),
        };

        if (canUseIndexSearch(indexSearchOptions)) {
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
                const io = publishAndReturn(
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
        } else if (options.isRegex === true && options.caseSensitive !== true && (options.contextLines ?? 0) === 0) {
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
                const io = publishAndReturn(
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
            indexFallback = true;
            indexFallbackReason = 'query-not-index-compatible';
        }

        if (await isRipgrepAvailable()) {
            try {
                const streamingCollector = createStreamingSearchCollector(searchWindow);
                const streamResult = await streamSearchFile(
                    'rg',
                    [
                        '--color=never',
                        '--no-heading',
                        '--line-number',
                        ...(options.isRegex ? [] : ['--fixed-strings']),
                        ...(options.caseSensitive ? [] : ['--ignore-case']),
                        `--context=${options.contextLines ?? 2}`,
                        ...(searchWindow.commandMaxCount === null
                            ? []
                            : ['--max-count', String(searchWindow.commandMaxCount)]),
                        ...(options.includePattern ? [`--glob=${options.includePattern}`] : []),
                        ...(options.excludePattern ? [`--glob=!${options.excludePattern}`] : []),
                        '--glob=!node_modules',
                        '--glob=!.git',
                        '--glob=!dist',
                        '-e',
                        options.pattern,
                        targetPath,
                    ],
                    {
                        cwd: options.workspaceRoot,
                        timeout: ioSearchBudget.timeoutMs,
                        maxBuffer: ioSearchBudget.maxBufferBytes,
                        collectStdout: false,
                        onStdoutLine: (line) => streamingCollector.accept(line),
                    },
                );
                const sanitizedOutput = streamingCollector.snapshot();
                const windowedOutput = paginateSearchText(sanitizedOutput.text, searchWindow);
                const returnedMatchCount = countSearchMatchLines(windowedOutput.text);
                const totalMatchCount = countSearchMatchLines(sanitizedOutput.text);
                const io = publishAndReturn(
                    buildSearchIo('io-engine.rg.search', utf8ByteLength(windowedOutput.text, 'search output'), {
                        redactions: sanitizedOutput.redactions,
                        countsPostSanitization: true,
                        truncated: windowedOutput.truncated,
                        originalLineCount: windowedOutput.originalLineCount,
                        nextCursor: windowedOutput.nextCursor,
                        streamStoppedEarly: streamResult.stoppedEarly,
                    }),
                    true,
                );
                return {
                    targetPath,
                    pattern: options.pattern,
                    output: windowedOutput.text,
                    matchCount: returnedMatchCount,
                    returnedMatchCount,
                    returnedLineCount: countSearchOutputLines(windowedOutput.text),
                    engine: 'rg',
                    sanitized: sanitizedOutput.sanitized,
                    redactions: sanitizedOutput.redactions,
                    truncated: windowedOutput.truncated,
                    nextCursor: windowedOutput.nextCursor,
                    cursorOffset: windowedOutput.cursorOffset,
                    totalMatches: totalMatchCount,
                    totalMatchCount,
                    totalLineCount: windowedOutput.originalLineCount,
                    countsPostSanitization: true,
                    indexFallback,
                    indexFallbackReason,
                    io: { ...io, truncated: windowedOutput.truncated, policyVersion: sanitizedOutput.policyVersion },
                };
            } catch (error) {
                const execError = /** @type {{ code?: unknown; status?: unknown; stderr?: unknown }} */ (error);
                if ((execError.code === 1 || execError.status === 1) && !execError.stderr) {
                    const io = publishAndReturn(buildSearchIo('io-engine.rg.search', 0), true);
                    return {
                        targetPath,
                        pattern: options.pattern,
                        output: '',
                        matchCount: 0,
                        returnedMatchCount: 0,
                        returnedLineCount: 0,
                        engine: 'rg',
                        sanitized: false,
                        redactions: 0,
                        countsPostSanitization: true,
                        indexFallback,
                        indexFallbackReason,
                        io,
                    };
                }
                throw error;
            }
        }

        try {
            const grepOptions = {
                pattern: options.pattern,
                resolved: targetPath,
                ...(options.isRegex !== undefined ? { isRegex: options.isRegex } : {}),
                ...(options.caseSensitive !== undefined ? { caseSensitive: options.caseSensitive } : {}),
                ...(options.includePattern ? { includePattern: options.includePattern } : {}),
                ...(options.excludePattern ? { excludePattern: options.excludePattern } : {}),
                ...(options.contextLines !== undefined ? { contextLines: options.contextLines } : {}),
            };
            const streamingCollector = createStreamingSearchCollector(searchWindow);
            const streamResult = await streamSearchFile('grep', buildGrepArgs(grepOptions), {
                cwd: options.workspaceRoot,
                timeout: ioSearchBudget.timeoutMs,
                maxBuffer: ioSearchBudget.maxBufferBytes,
                collectStdout: false,
                onStdoutLine: (line) => streamingCollector.accept(line),
            });
            const sanitizedOutput = streamingCollector.snapshot();
            const windowedOutput = paginateSearchText(sanitizedOutput.text, searchWindow);
            const returnedMatchCount = countSearchMatchLines(windowedOutput.text);
            const totalMatchCount = countSearchMatchLines(sanitizedOutput.text);
            const io = publishAndReturn(
                buildSearchIo('io-engine.grep.search', utf8ByteLength(windowedOutput.text, 'search output'), {
                    redactions: sanitizedOutput.redactions,
                    countsPostSanitization: true,
                    truncated: windowedOutput.truncated,
                    originalLineCount: windowedOutput.originalLineCount,
                    nextCursor: windowedOutput.nextCursor,
                    streamStoppedEarly: streamResult.stoppedEarly,
                }),
                true,
            );
            return {
                targetPath,
                pattern: options.pattern,
                output: windowedOutput.text,
                matchCount: returnedMatchCount,
                returnedMatchCount,
                returnedLineCount: countSearchOutputLines(windowedOutput.text),
                engine: 'grep',
                sanitized: sanitizedOutput.sanitized,
                redactions: sanitizedOutput.redactions,
                truncated: windowedOutput.truncated,
                nextCursor: windowedOutput.nextCursor,
                cursorOffset: windowedOutput.cursorOffset,
                totalMatches: totalMatchCount,
                totalMatchCount,
                totalLineCount: windowedOutput.originalLineCount,
                countsPostSanitization: true,
                indexFallback,
                indexFallbackReason,
                io: { ...io, truncated: windowedOutput.truncated, policyVersion: sanitizedOutput.policyVersion },
            };
        } catch (error) {
            const execError = /** @type {{ code?: unknown; status?: unknown; stderr?: unknown; message?: unknown }} */ (
                error
            );
            if ((execError.code === 1 || execError.status === 1) && !execError.stderr) {
                const io = publishAndReturn(buildSearchIo('io-engine.grep.search', 0), true);
                return {
                    targetPath,
                    pattern: options.pattern,
                    output: '',
                    matchCount: 0,
                    returnedMatchCount: 0,
                    returnedLineCount: 0,
                    engine: 'grep',
                    sanitized: false,
                    redactions: 0,
                    countsPostSanitization: true,
                    indexFallback,
                    indexFallbackReason,
                    io,
                };
            }
            if (execError.code === 'ENOENT' || String(execError.message ?? '').includes('ENOENT')) {
                throw new Error(
                    'Nem ripgrep (rg) nem grep estão disponíveis para search_in_files. Instale `ripgrep` (recomendado) ou `grep` no ambiente.',
                    {
                        cause: error,
                    },
                );
            }
            throw error;
        }
    } catch (error) {
        publishAndReturn(buildSearchIo('io-engine.search', 0), false, error);
        throw error;
    }
}

/** @typedef {'function' | 'class' | 'variable' | 'export' | 'type' | 'all'} IoSymbolKind */

/**
 * Busca símbolos em arquivos já validados pelo adapter da tool.
 *
 * @param {string} targetPath
 * @param {{
 *     workspaceRoot?: string;
 *     symbolName: string;
 *     kind?: IoSymbolKind;
 *     exactMatch?: boolean;
 *     includePattern?: string;
 *     caseSensitive?: boolean;
 *     maxResults?: number;
 *     cursor?: string | number | null;
 *     traceId?: string;
 * }} options
 * @returns {Promise<{
 *     targetPath: string;
 *     symbol: string;
 *     kind: IoSymbolKind;
 *     output: string;
 *     matchCount: number;
 *     message?: string;
 *     engine: string;
 *     sanitized: boolean;
 *     redactions: number;
 *     truncated?: boolean;
 *     nextCursor?: string | null;
 *     cursorOffset?: number;
 *     totalMatches?: number;
 *     countsPostSanitization: true;
 *     scopedIndex?: boolean;
 *     caseSensitiveEffective?: boolean;
 *     io: import('#copilot/core/io-contracts').IoMeta;
 * }>}
 */
export async function searchWorkspaceSymbols(targetPath, options) {
    assertValidTargetPath(targetPath);
    if (typeof options.symbolName !== 'string' || options.symbolName.trim().length === 0) {
        const error = /** @type {TypeError & { code?: string }} */ (
            new TypeError('symbolName inválido para searchWorkspaceSymbols')
        );
        error.code = 'ERR_INVALID_ARG_VALUE';
        throw error;
    }
    if (options.includePattern !== undefined && hasNullByte(String(options.includePattern))) {
        const error = /** @type {TypeError & { code?: string }} */ (
            new TypeError('includePattern inválido para searchWorkspaceSymbols')
        );
        error.code = 'ERR_INVALID_ARG_VALUE';
        throw error;
    }
    const startedAt = nowIoMs();
    const traceId = options.traceId ?? createIoTraceId();
    const resolvedKind = options.kind ?? 'all';
    const searchWindow = normalizeSearchWindow(options);
    const ioSearchBudget = getIoSearchBudget();
    const advisoryLimitsBase = {
        requestedMaxResults: searchWindow.maxResults,
        cursorOffset: searchWindow.cursorOffset,
        limitMode: 'enforced-output-window',
        symbolLength: options.symbolName.length,
        timeoutMs: ioSearchBudget.timeoutMs,
        maxBufferBytes: ioSearchBudget.maxBufferBytes,
    };

    /**
     * @param {string} engine
     * @param {number} bytesRead
     * @param {Record<string, unknown>} [extra]
     */
    const buildSymbolIo = (engine, bytesRead, extra = {}) =>
        buildIoMeta({
            operation: 'search',
            target: targetPath,
            targetKind: 'workspace',
            bytesRead,
            durationMs: elapsedMs(startedAt),
            engine,
            riskClass: 'low',
            traceId,
            advisoryLimits: { ...advisoryLimitsBase, ...extra },
        });

    try {
        if (!options.includePattern) {
            const rows = findIoIndexSymbol(options.symbolName, {
                pathPrefix: targetPath,
                kind: resolvedKind,
                exactMatch: options.exactMatch === true,
                caseSensitive: options.caseSensitive === true,
                ...(searchWindow.commandMaxCount === null ? {} : { maxResults: searchWindow.commandMaxCount }),
            });
            if (rows.length > 0) {
                const sanitized = sanitizeSearchOutput(formatIndexSymbolRows(rows));
                const windowedOutput = paginateSearchText(sanitized.text, searchWindow);
                const matchCount = countSearchOutputLines(windowedOutput.text);
                const io = publishAndReturn(
                    buildSymbolIo(
                        'io-engine.index.symbol-search',
                        utf8ByteLength(windowedOutput.text, 'symbol output'),
                        {
                            redactions: sanitized.redactions,
                            countsPostSanitization: true,
                            truncated: windowedOutput.truncated,
                            originalResultCount: windowedOutput.originalLineCount,
                            nextCursor: windowedOutput.nextCursor,
                            scopedIndex: true,
                            caseSensitiveEffective: options.caseSensitive === true,
                        },
                    ),
                    true,
                );
                return {
                    targetPath,
                    symbol: options.symbolName,
                    kind: resolvedKind,
                    output: windowedOutput.text,
                    matchCount,
                    engine: 'fts5-index',
                    sanitized: sanitized.sanitized,
                    redactions: sanitized.redactions,
                    truncated: windowedOutput.truncated,
                    nextCursor: windowedOutput.nextCursor,
                    cursorOffset: windowedOutput.cursorOffset,
                    totalMatches: windowedOutput.originalLineCount,
                    countsPostSanitization: true,
                    scopedIndex: true,
                    caseSensitiveEffective: options.caseSensitive === true,
                    io: { ...io, truncated: windowedOutput.truncated, policyVersion: sanitized.policyVersion },
                };
            }
        }

        if (!(await isRipgrepAvailable())) {
            throw new Error('ripgrep (rg) não está disponível neste ambiente. workspace_symbol_search requer rg.');
        }

        const streamingCollector = createStreamingSearchCollector(searchWindow);
        const streamResult = await streamSearchFile(
            'rg',
            [
                '--color=never',
                '--no-heading',
                '--line-number',
                '--with-filename',
                '-e',
                buildSymbolPattern(options.symbolName, resolvedKind),
                ...(options.caseSensitive ? [] : ['--ignore-case']),
                ...(searchWindow.commandMaxCount === null ? [] : ['--max-count', String(searchWindow.commandMaxCount)]),
                ...(options.includePattern
                    ? ['--glob', options.includePattern]
                    : kindToGlobs(resolvedKind).flatMap((glob) => ['--glob', glob])),
                '--glob=!node_modules',
                '--glob=!.git',
                '--glob=!dist',
                '--glob=!coverage',
                '--glob=!*.min.js',
                targetPath,
            ],
            {
                cwd: options.workspaceRoot,
                timeout: ioSearchBudget.timeoutMs,
                maxBuffer: ioSearchBudget.maxBufferBytes,
                collectStdout: false,
                onStdoutLine: (line) => streamingCollector.accept(line),
            },
        ).catch((error) => {
            const execError = /** @type {{ code?: unknown; status?: unknown; stderr?: unknown }} */ (error);
            if ((execError.code === 1 || execError.status === 1) && !execError.stderr) {
                return { stoppedEarly: false };
            }
            throw error;
        });

        const sanitized = streamingCollector.snapshot();
        const windowedOutput = paginateSearchText(sanitized.text, searchWindow);
        const output = windowedOutput.text;
        const lines = output.split('\n').filter(Boolean);
        const io = publishAndReturn(
            buildSymbolIo('io-engine.rg.symbol-search', utf8ByteLength(output, 'symbol output'), {
                redactions: sanitized.redactions,
                countsPostSanitization: true,
                truncated: windowedOutput.truncated,
                originalLineCount: windowedOutput.originalLineCount,
                nextCursor: windowedOutput.nextCursor,
                streamStoppedEarly: streamResult.stoppedEarly,
            }),
            true,
        );
        return {
            targetPath,
            symbol: options.symbolName,
            kind: resolvedKind,
            output,
            matchCount: lines.length,
            ...(lines.length === 0
                ? {
                      message: `Nenhuma declaração de "${options.symbolName}" (${resolvedKind}) encontrada em ${targetPath}`,
                  }
                : {}),
            engine: 'rg',
            sanitized: sanitized.sanitized,
            redactions: sanitized.redactions,
            truncated: windowedOutput.truncated,
            nextCursor: windowedOutput.nextCursor,
            cursorOffset: windowedOutput.cursorOffset,
            totalMatches: windowedOutput.originalLineCount,
            countsPostSanitization: true,
            io: { ...io, truncated: windowedOutput.truncated, policyVersion: sanitized.policyVersion },
        };
    } catch (error) {
        publishAndReturn(buildSymbolIo('io-engine.symbol-search', 0), false, error);
        throw error;
    }
}
