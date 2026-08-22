// @ts-check
/** ripgrep/grep execution path for completeness-oriented text search. */

import { utf8ByteLength } from '#copilot/infra/internal/platform';
import { publishIoOperationResult } from '#copilot/infra/internal/telemetry';
import {
    countSearchMatchLines,
    countSearchOutputLines,
    createStreamingSearchCollector,
    paginateSearchText,
} from '../shared/index.js';
import { streamSearchFile } from '../subprocess/index.js';
import { buildGrepArgs } from './grep.js';

/** @typedef {import('./types.js').TextSearchOptions} TextSearchOptions */
/** @typedef {import('./types.js').TextSearchResult} TextSearchResult */
/** @typedef {import('./types.js').BuildSearchIo} BuildSearchIo */

/**
 * @param {string} targetPath
 * @param {TextSearchOptions} options
 * @param {{ timeoutMs: number; maxBufferBytes: number }} ioSearchBudget
 * @param {ReturnType<typeof import('../shared/index.js').normalizeSearchWindow>} searchWindow
 * @param {boolean} ripgrepAvailable
 * @param {Readonly<Record<string,string>>} subprocessEnvironment
 * @param {boolean} indexFallback
 * @param {string | null} indexFallbackReason
 * @param {BuildSearchIo} buildSearchIo
 * @returns {Promise<TextSearchResult>}
 */
export async function searchTextViaSubprocess(
    targetPath,
    options,
    ioSearchBudget,
    searchWindow,
    ripgrepAvailable,
    subprocessEnvironment,
    indexFallback,
    indexFallbackReason,
    buildSearchIo,
) {
    if (ripgrepAvailable) {
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
                    env: subprocessEnvironment,
                    collectStdout: false,
                    onStdoutLine: (line) => streamingCollector.accept(line),
                },
            );
            const sanitizedOutput = streamingCollector.snapshot();
            const windowedOutput = paginateSearchText(sanitizedOutput.text, searchWindow);
            const returnedMatchCount = countSearchMatchLines(windowedOutput.text);
            const totalMatchCount = countSearchMatchLines(sanitizedOutput.text);
            const io = publishIoOperationResult(
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
                const io = publishIoOperationResult(buildSearchIo('io-engine.rg.search', 0), true);
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
            env: subprocessEnvironment,
            collectStdout: false,
            onStdoutLine: (line) => streamingCollector.accept(line),
        });
        const sanitizedOutput = streamingCollector.snapshot();
        const windowedOutput = paginateSearchText(sanitizedOutput.text, searchWindow);
        const returnedMatchCount = countSearchMatchLines(windowedOutput.text);
        const totalMatchCount = countSearchMatchLines(sanitizedOutput.text);
        const io = publishIoOperationResult(
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
            const io = publishIoOperationResult(buildSearchIo('io-engine.grep.search', 0), true);
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
}
