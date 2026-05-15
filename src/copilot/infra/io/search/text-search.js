// @ts-check
/**
 * Busca textual e simbólica para workspace local.
 *
 * Extraído de `io-engine` para reduzir acoplamento e manter a facade pública estável.
 *
 * @module copilot/infra/io/search/text-search
 */

import { buildIoMeta, createIoTraceId } from '../../../core/io-contracts.js';
import { sanitizeIoTextOutput } from '../../../core/io-policy.js';
import { findIoIndexSymbol, getIoIndexStats, searchIoIndex } from '../../io-index-registry.js';
import { nowIoMs, publishIoOperation } from '../../io-observability.js';
import { resolveIoSearchBudget } from '../../policy/budgets.js';
import { hasNullByte } from '../../policy/path-resource.js';
import { utf8ByteLength } from '../../shared/buffer.js';
import { buildGrepArgs } from './grep-adapter.js';
import { canUseIndexSearch, formatIndexSearchRows } from './index-search.js';
import { normalizeSearchWindow, paginateSearchItems, paginateSearchText } from './result-paginator.js';
import { execSearchFile, isRipgrepAvailable } from './subprocess.js';
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

/**
 * @param {string} stdout
 * @returns {{ text: string; sanitized: boolean; redactions: number; policyVersion: string }}
 */
function sanitizeSearchOutput(stdout) {
    const sensitiveLineRe = /-----BEGIN [A-Z ]+-----|ey[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/;
    const lineFiltered = stdout
        .split('\n')
        .filter((line) => !sensitiveLineRe.test(line))
        .join('\n');
    return sanitizeIoTextOutput({ text: lineFiltered });
}

/**
 * @param {import('../../../core/io-contracts.js').IoMeta} io
 * @param {boolean} success
 * @param {unknown} [error]
 * @returns {import('../../../core/io-contracts.js').IoMeta}
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
 *     maxResults?: number;
 *     cursor?: string | number | null;
 *     traceId?: string;
 * }} options
 * @returns {Promise<{
 *     targetPath: string;
 *     pattern: string;
 *     output: string;
 *     matchCount: number;
 *     engine: string;
 *     sanitized: boolean;
 *     redactions: number;
 *     truncated?: boolean;
 *     nextCursor?: string | null;
 *     cursorOffset?: number;
 *     totalMatches?: number;
 *     io: import('../../../core/io-contracts.js').IoMeta;
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
            if (indexRows.length > 0) {
                const windowed = paginateSearchItems(indexRows, searchWindow);
                const filteredOutput = sanitizeSearchOutput(formatIndexSearchRows(windowed.items));
                const io = publishAndReturn(
                    buildSearchIo('io-engine.index.search', utf8ByteLength(filteredOutput.text, 'search output'), {
                        redactions: filteredOutput.redactions,
                        fallback: 'rg-on-index-miss-or-complex-query',
                        truncated: windowed.truncated,
                        originalResultCount: windowed.totalItems,
                        nextCursor: windowed.nextCursor,
                    }),
                    true,
                );
                return {
                    targetPath,
                    pattern: options.pattern,
                    output: filteredOutput.text,
                    matchCount: windowed.items.length,
                    engine: 'fts5-index',
                    sanitized: filteredOutput.sanitized,
                    redactions: filteredOutput.redactions,
                    truncated: windowed.truncated,
                    nextCursor: windowed.nextCursor,
                    cursorOffset: windowed.cursorOffset,
                    totalMatches: windowed.totalItems,
                    io: { ...io, truncated: windowed.truncated, policyVersion: filteredOutput.policyVersion },
                };
            }
        }

        if (await isRipgrepAvailable()) {
            try {
                const { stdout } = await execSearchFile(
                    'rg',
                    [
                        '--color=never',
                        '--no-heading',
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
                    },
                );
                const windowedOutput = paginateSearchText(stdout, searchWindow);
                const filteredOutput = sanitizeSearchOutput(windowedOutput.text);
                const io = publishAndReturn(
                    buildSearchIo('io-engine.rg.search', utf8ByteLength(filteredOutput.text, 'search output'), {
                        redactions: filteredOutput.redactions,
                        truncated: windowedOutput.truncated,
                        originalLineCount: windowedOutput.originalLineCount,
                        nextCursor: windowedOutput.nextCursor,
                    }),
                    true,
                );
                return {
                    targetPath,
                    pattern: options.pattern,
                    output: filteredOutput.text,
                    matchCount: filteredOutput.text.split('\n').filter(Boolean).length,
                    engine: 'rg',
                    sanitized: filteredOutput.sanitized,
                    redactions: filteredOutput.redactions,
                    truncated: windowedOutput.truncated,
                    nextCursor: windowedOutput.nextCursor,
                    cursorOffset: windowedOutput.cursorOffset,
                    totalMatches: windowedOutput.originalLineCount,
                    io: { ...io, truncated: windowedOutput.truncated, policyVersion: filteredOutput.policyVersion },
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
                        engine: 'rg',
                        sanitized: false,
                        redactions: 0,
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
            const { stdout } = await execSearchFile('grep', buildGrepArgs(grepOptions), {
                cwd: options.workspaceRoot,
                timeout: ioSearchBudget.timeoutMs,
                maxBuffer: ioSearchBudget.maxBufferBytes,
            });
            const windowedOutput = paginateSearchText(stdout, searchWindow);
            const filteredOutput = sanitizeSearchOutput(windowedOutput.text);
            const io = publishAndReturn(
                buildSearchIo('io-engine.grep.search', utf8ByteLength(filteredOutput.text, 'search output'), {
                    redactions: filteredOutput.redactions,
                    truncated: windowedOutput.truncated,
                    originalLineCount: windowedOutput.originalLineCount,
                    nextCursor: windowedOutput.nextCursor,
                }),
                true,
            );
            return {
                targetPath,
                pattern: options.pattern,
                output: filteredOutput.text,
                matchCount: filteredOutput.text.split('\n').filter(Boolean).length,
                engine: 'grep',
                sanitized: filteredOutput.sanitized,
                redactions: filteredOutput.redactions,
                truncated: windowedOutput.truncated,
                nextCursor: windowedOutput.nextCursor,
                cursorOffset: windowedOutput.cursorOffset,
                totalMatches: windowedOutput.originalLineCount,
                io: { ...io, truncated: windowedOutput.truncated, policyVersion: filteredOutput.policyVersion },
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
                    engine: 'grep',
                    sanitized: false,
                    redactions: 0,
                    io,
                };
            }
            if (execError.code === 'ENOENT' || String(execError.message ?? '').includes('ENOENT')) {
                throw new Error('Nem ripgrep (rg) nem grep estão disponíveis neste ambiente para search_in_files.', {
                    cause: error,
                });
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
 *     io: import('../../../core/io-contracts.js').IoMeta;
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
        if (!options.includePattern && !options.caseSensitive) {
            const rows = findIoIndexSymbol(
                options.symbolName,
                searchWindow.commandMaxCount === null ? {} : { maxResults: searchWindow.commandMaxCount },
            ).filter(
                /** @param {{ filePath: string; symbolKind: string }} row */
                (row) => {
                    const samePath = row.filePath === targetPath || row.filePath.startsWith(`${targetPath}/`);
                    const sameKind = resolvedKind === 'all' ? true : row.symbolKind === resolvedKind;
                    return samePath && sameKind;
                },
            );
            if (rows.length > 0) {
                const windowed = paginateSearchItems(rows, searchWindow);
                const sanitized = sanitizeIoTextOutput({ text: formatIndexSymbolRows(windowed.items) });
                const io = publishAndReturn(
                    buildSymbolIo('io-engine.index.symbol-search', utf8ByteLength(sanitized.text, 'symbol output'), {
                        redactions: sanitized.redactions,
                        truncated: windowed.truncated,
                        originalResultCount: windowed.totalItems,
                        nextCursor: windowed.nextCursor,
                    }),
                    true,
                );
                return {
                    targetPath,
                    symbol: options.symbolName,
                    kind: resolvedKind,
                    output: sanitized.text,
                    matchCount: windowed.items.length,
                    engine: 'fts5-index',
                    sanitized: sanitized.sanitized,
                    redactions: sanitized.redactions,
                    truncated: windowed.truncated,
                    nextCursor: windowed.nextCursor,
                    cursorOffset: windowed.cursorOffset,
                    totalMatches: windowed.totalItems,
                    io: { ...io, truncated: windowed.truncated, policyVersion: sanitized.policyVersion },
                };
            }
        }

        if (!(await isRipgrepAvailable())) {
            throw new Error('ripgrep (rg) não está disponível neste ambiente. workspace_symbol_search requer rg.');
        }

        const { stdout } = await execSearchFile(
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
            },
        ).catch((error) => {
            const execError = /** @type {{ code?: unknown; status?: unknown; stderr?: unknown }} */ (error);
            if ((execError.code === 1 || execError.status === 1) && !execError.stderr) {
                return { stdout: '' };
            }
            throw error;
        });

        const windowedOutput = paginateSearchText(stdout, searchWindow);
        const sanitized = sanitizeIoTextOutput({ text: windowedOutput.text });
        const output = sanitized.text;
        const lines = output.split('\n').filter(Boolean);
        const io = publishAndReturn(
            buildSymbolIo('io-engine.rg.symbol-search', utf8ByteLength(output, 'symbol output'), {
                redactions: sanitized.redactions,
                truncated: windowedOutput.truncated,
                originalLineCount: windowedOutput.originalLineCount,
                nextCursor: windowedOutput.nextCursor,
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
            io: { ...io, truncated: windowedOutput.truncated, policyVersion: sanitized.policyVersion },
        };
    } catch (error) {
        publishAndReturn(buildSymbolIo('io-engine.symbol-search', 0), false, error);
        throw error;
    }
}
