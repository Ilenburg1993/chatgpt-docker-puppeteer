// @ts-check
/** Completeness-oriented text/regex search orchestration. */

import { buildIoMeta, createIoTraceId } from '#copilot/core';
import { hasNullByte } from '#copilot/infra/internal/policy';
import { elapsedIoMs, nowIoMs, publishIoOperationResult } from '#copilot/infra/internal/telemetry';
import { assertValidTargetPath, getIoSearchBudget, normalizeSearchWindow } from '../shared/index.js';
import { isRipgrepAvailable } from '../subprocess/index.js';
import { trySearchTextViaIndex } from './indexed.js';
import { searchTextViaSubprocess } from './process.js';

/** @typedef {import('./types.js').TextSearchOptions} TextSearchOptions */
/** @typedef {import('./types.js').TextSearchResult} TextSearchResult */

/**
 * Search text/regex in files already authorized by the workspace adapter.
 * Completeness wins over derived-index latency: rg is preferred whenever available.
 *
 * @param {string} targetPath
 * @param {TextSearchOptions} options
 * @returns {Promise<TextSearchResult>}
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
    /** @type {import('./types.js').BuildSearchIo} */
    const buildSearchIo = (engine, bytesRead, extra = {}) =>
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
        const ripgrepAvailable = await isRipgrepAvailable();
        const indexAttempt = trySearchTextViaIndex(targetPath, options, searchWindow, ripgrepAvailable, buildSearchIo);
        if (indexAttempt.result) return indexAttempt.result;
        return await searchTextViaSubprocess(
            targetPath,
            options,
            ioSearchBudget,
            searchWindow,
            ripgrepAvailable,
            indexAttempt.indexFallback,
            indexAttempt.indexFallbackReason,
            buildSearchIo,
        );
    } catch (error) {
        publishIoOperationResult(buildSearchIo('io-engine.search', 0), false, error);
        throw error;
    }
}
