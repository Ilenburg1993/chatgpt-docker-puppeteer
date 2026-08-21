// @ts-check
/** Workspace symbol search via registry index with ripgrep fallback. */

import { buildIoMeta, createIoTraceId } from '#copilot/core';
import { utf8ByteLength } from '#copilot/infra/internal/platform';
import { hasNullByte } from '#copilot/infra/internal/policy';
import { elapsedIoMs, nowIoMs, publishIoOperationResult } from '#copilot/infra/internal/telemetry';
import { buildSymbolPattern, formatIndexSymbolRows, kindToGlobs } from '../projection/index.js';
import {
    assertValidTargetPath,
    countSearchOutputLines,
    createStreamingSearchCollector,
    getIoSearchBudget,
    normalizeSearchWindow,
    paginateSearchText,
    sanitizeSearchOutput,
} from '../shared/index.js';
import { isRipgrepAvailable, streamSearchFile } from '../subprocess/index.js';

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
 * @param {{ indexRegistry?: ReturnType<typeof import('../../registry/instance/index.js').createIoIndexRegistryRuntime> }} [context]
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
export async function searchWorkspaceSymbols(targetPath, options, context = {}) {
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
            durationMs: elapsedIoMs(startedAt),
            engine,
            riskClass: 'low',
            traceId,
            advisoryLimits: { ...advisoryLimitsBase, ...extra },
        });

    try {
        if (!options.includePattern) {
            const rows =
                context.indexRegistry?.findSymbol(options.symbolName, {
                    pathPrefix: targetPath,
                    kind: resolvedKind,
                    exactMatch: options.exactMatch === true,
                    caseSensitive: options.caseSensitive === true,
                    ...(searchWindow.commandMaxCount === null ? {} : { maxResults: searchWindow.commandMaxCount }),
                }) ?? [];
            if (rows.length > 0) {
                const sanitized = sanitizeSearchOutput(formatIndexSymbolRows(rows));
                const windowedOutput = paginateSearchText(sanitized.text, searchWindow);
                const matchCount = countSearchOutputLines(windowedOutput.text);
                const io = publishIoOperationResult(
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
        const matchCount = countSearchOutputLines(output);
        const io = publishIoOperationResult(
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
            matchCount,
            ...(matchCount === 0
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
        publishIoOperationResult(buildSymbolIo('io-engine.symbol-search', 0), false, error);
        throw error;
    }
}
