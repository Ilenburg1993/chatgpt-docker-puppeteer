// @ts-check
/** Runtime-owned parser symbol/file-context caches. @module copilot/infra/indexing/parser/cache/runtime/service */

import { readEnvPositiveInt } from '#copilot/infra/internal/platform';
import { LRUCache } from 'lru-cache';
import * as nodePath from 'node:path';
import { DEFAULT_PARSER_PROCESS_CONFIG, normalizeParserPath } from '../../foundation/index.js';

/** @typedef {import('../../foundation/index.js').FileSymbols} FileSymbols */
/** @typedef {import('../../foundation/index.js').FileContext} FileContext */
/** @typedef {import('../../foundation/index.js').SymbolCacheEntry} SymbolCacheEntry */

const FILE_CONTEXT_DISABLED_VALUES = new Set(['0', 'false', 'off', 'disabled']);

/** @param {NodeJS.ProcessEnv | Record<string,string|undefined>} env */
export function readParserCacheRuntimeConfig(env) {
    const enabledValue = String(env['IO_PARSER_FILE_CONTEXT_CACHE_ENABLED'] ?? '1')
        .trim()
        .toLowerCase();
    return Object.freeze({
        symbolMaxEntries: readEnvPositiveInt(
            'IO_PARSER_SYMBOL_CACHE_MAX_ENTRIES',
            500,
            /** @type {NodeJS.ProcessEnv} */ (env),
        ),
        symbolMaxBytes: readEnvPositiveInt(
            'IO_PARSER_SYMBOL_CACHE_MAX_BYTES',
            64 * 1024 * 1024,
            /** @type {NodeJS.ProcessEnv} */ (env),
        ),
        fileContextEnabled: !FILE_CONTEXT_DISABLED_VALUES.has(enabledValue),
        fileContextMaxEntries: readEnvPositiveInt(
            'IO_PARSER_FILE_CONTEXT_CACHE_MAX_ENTRIES',
            256,
            /** @type {NodeJS.ProcessEnv} */ (env),
        ),
        fileContextMaxBytes: readEnvPositiveInt(
            'IO_PARSER_FILE_CONTEXT_CACHE_MAX_BYTES',
            64 * 1024 * 1024,
            /** @type {NodeJS.ProcessEnv} */ (env),
        ),
        fileContextTtlMs: readEnvPositiveInt(
            'IO_PARSER_FILE_CONTEXT_CACHE_TTL_MS',
            5 * 60_000,
            /** @type {NodeJS.ProcessEnv} */ (env),
        ),
    });
}

const DEFAULT_PARSER_CACHE_RUNTIME_CONFIG = readParserCacheRuntimeConfig(Object.freeze({}));

/** @param {FileSymbols} value */
function estimateFileSymbolsSize(value) {
    let size = Math.max(1, value.parsedBytes);
    for (const symbol of value.symbols) size += 96 + symbol.name.length * 2 + (symbol.docComment?.length ?? 0) * 2;
    for (const entry of value.imports) {
        size += 96 + entry.source.length * 2;
        for (const specifier of entry.specifiers) size += 16 + specifier.length * 2;
    }
    for (const entry of value.exports) size += 16 + entry.length * 2;
    return size;
}

/** @param {SymbolCacheEntry} value */
function estimateFileSymbolsCacheSize(value) {
    return estimateFileSymbolsSize(value.symbols);
}
/** @param {FileContext} value */
function estimateFileContextCacheSize(value) {
    let size = estimateFileSymbolsSize(value.symbols);
    for (const line of value.outline) size += 16 + line.length * 2;
    for (const comment of value.topComments) size += 16 + comment.length * 2;
    return size;
}

/**
 * @param {{
 *   invalidationBus:{registerHook:(hook:(filePath:string,event:{recursive:boolean;source:string})=>void)=>()=>void};
 *   runtimeId?:string;
 *   config?:ReturnType<typeof readParserCacheRuntimeConfig>;
 *   parserConfig?:ReturnType<typeof import('../../foundation/index.js').readParserProcessConfig>;
 *   workerRuntime?:ReturnType<typeof import('../../worker/index.js').createParserWorkerRuntime>;
 * }} options
 */
export function createParserCacheRuntime(options) {
    if (!options?.invalidationBus) throw new TypeError('createParserCacheRuntime requires { invalidationBus }.');
    const runtimeId = options.runtimeId ?? 'parser-cache-runtime';
    const config = options.config ?? DEFAULT_PARSER_CACHE_RUNTIME_CONFIG;
    const workerRuntime = options.workerRuntime ?? null;
    const parserConfig = options.parserConfig ?? workerRuntime?.config ?? DEFAULT_PARSER_PROCESS_CONFIG;
    const symbolCache = new LRUCache({
        max: config.symbolMaxEntries,
        maxSize: config.symbolMaxBytes,
        sizeCalculation: estimateFileSymbolsCacheSize,
        ttl: 5 * 60_000,
        updateAgeOnGet: true,
    });
    const fileContextCache = new LRUCache({
        max: config.fileContextMaxEntries,
        maxSize: config.fileContextMaxBytes,
        sizeCalculation: estimateFileContextCacheSize,
        ttl: config.fileContextTtlMs,
        updateAgeOnGet: true,
    });
    const symbolStats = {
        symbolCacheHits: 0,
        symbolCacheMisses: 0,
        symbolCacheStale: 0,
        symbolSnapshotReads: 0,
        symbolSuppliedSnapshots: 0,
        symbolFreshnessChecks: 0,
        symbolSnapshotPrechecksAvoided: 0,
        symbolSnapshotConflicts: 0,
    };
    const fileContextStats = {
        hits: 0,
        misses: 0,
        sets: 0,
        clears: 0,
        bypasses: 0,
        rejected: 0,
        hashComputations: 0,
        hashReuses: 0,
    };
    /** @type {(() => void) | null} */ let invalidationUnregister = null;
    let disposed = false;

    /** @param {string} normalizedPath @param {boolean} recursive */
    function clearFileContextForNormalizedPath(normalizedPath, recursive) {
        let removed = 0;
        const exactPrefix = `${normalizedPath}\u0000`;
        const recursivePrefix = `${normalizedPath}${nodePath.sep}`;
        for (const key of [...fileContextCache.keys()]) {
            const textKey = String(key);
            if (!textKey.startsWith(exactPrefix) && !(recursive && textKey.startsWith(recursivePrefix))) continue;
            fileContextCache.delete(key);
            removed += 1;
        }
        fileContextStats.clears += removed;
        return removed;
    }
    function ensureInvalidationHook() {
        if (invalidationUnregister || disposed) return;
        invalidationUnregister = options.invalidationBus.registerHook((filePath, event) => {
            const normalized = normalizeParserPath(filePath);
            symbolCache.delete(normalized);
            clearFileContextForNormalizedPath(normalized, event.recursive === true);
            if (event.recursive === true) {
                const prefix = `${normalized}${nodePath.sep}`;
                for (const key of symbolCache.keys()) if (String(key).startsWith(prefix)) symbolCache.delete(key);
            }
        });
    }
    /** @param {string} filePath */
    function invalidate(filePath) {
        const normalized = normalizeParserPath(filePath);
        symbolCache.delete(normalized);
        clearFileContextForNormalizedPath(normalized, false);
    }
    function isFileContextEnabled() {
        return config.fileContextEnabled;
    }
    function snapshot() {
        return Object.freeze({
            runtimeId,
            disposed,
            parserConfig,
            symbol: Object.freeze({
                size: symbolCache.size,
                maxSize: config.symbolMaxEntries,
                calculatedSize: symbolCache.calculatedSize,
                maxBytes: config.symbolMaxBytes,
                ...symbolStats,
            }),
            fileContext: Object.freeze({
                enabled: isFileContextEnabled(),
                size: fileContextCache.size,
                maxSize: config.fileContextMaxEntries,
                calculatedSize: fileContextCache.calculatedSize,
                maxBytes: config.fileContextMaxBytes,
                ...fileContextStats,
            }),
        });
    }
    function reset() {
        symbolCache.clear();
        fileContextCache.clear();
        for (const key of Object.keys(symbolStats)) symbolStats[/** @type {keyof typeof symbolStats} */ (key)] = 0;
        for (const key of Object.keys(fileContextStats))
            fileContextStats[/** @type {keyof typeof fileContextStats} */ (key)] = 0;
        invalidationUnregister?.();
        invalidationUnregister = null;
    }
    return Object.freeze({
        runtimeId,
        parserConfig,
        workerRuntime,
        symbolCache,
        fileContextCache,
        symbolStats,
        fileContextStats,
        ensureInvalidationHook,
        clearFileContextForNormalizedPath,
        invalidate,
        isFileContextEnabled,
        snapshot,
        reset,
        dispose() {
            if (disposed) return;
            reset();
            disposed = true;
        },
    });
}
