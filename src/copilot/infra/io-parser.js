// @ts-check
/**
 * src/copilot/infra/io-parser.js
 *
 * Parser de alta performance para JS/TS/JSON/Markdown orientado à LLM-B.
 *
 * Motivação: A LLM-B precisa extrair símbolos (funções, classes, exports, imports) de arquivos JS/TS sem ter que ler o
 * arquivo inteiro em contexto. Este módulo provê extração simbólica rápida e tipada via @babel/parser, com fallback
 * gracioso para arquivos binários/grandes.
 *
 * Capacidades:
 *
 * - `parseFileSymbols(filePath, content)` — extrai exports, classes, funções, imports.
 * - `parseFileForContext(filePath, content)` — snapshot de contexto para LLM-B: symbols + outline + top-level comments.
 * - `extractJsonSchema(content)` — extrai shape (top-level keys) de JSON.
 * - `extractMarkdownOutline(content)` — extrai headings H1-H4 de Markdown.
 * - `parseAndCacheSymbols(filePath)` — lê por porta baixa acíclica + parseia + cacheia resultado.
 *
 * Design:
 *
 * - Usa @babel/parser para JS/TS (ESM e CommonJS).
 * - Cache L1 dedicado para resultados de parse (evita re-parse de arquivos imutáveis).
 * - Threshold de tamanho: arquivos > `IO_PARSER_MAX_BYTES` (padrão: 2MB) são chunked.
 * - Erros de parse retornam resultado parcial com `parseError` descritivo.
 *
 * @module copilot/infra/io-parser
 */

import { LRUCache } from 'lru-cache';
import { createHash } from 'node:crypto';
import { availableParallelism } from 'node:os';
import * as nodePath from 'node:path';
import { performance } from 'node:perf_hooks';
import { Worker } from 'node:worker_threads';
import { registerInvalidationHook } from './io-cache.js';
import { createStaleSnapshotError } from './io/fs/read-bytes.js';
import { readTextFileSnapshot } from './io/fs/read-text.js';
import { statPathSnapshot } from './io/fs/stat.js';
import {
    buildOutline,
    extractBabelFileSymbols,
    extractJsonSchema,
    extractMarkdownOutline,
    extractMarkdownOutlineWithLines,
    extractTopComments,
    formatBabelParserError,
    resolveBabelParserOptions,
} from './parse/index.js';
import { truncateUtf8String, utf8ByteLength } from './shared/buffer.js';
import { richFingerprintMatches } from './shared/fingerprint-match.js';
import { countPhysicalTextLines } from './shared/text-lines.js';

export { buildOutline, extractJsonSchema, extractMarkdownOutline, extractTopComments };

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** Tamanho máximo de arquivo para parse completo em bytes (padrão: 2 MiB). */
const MAX_PARSE_BYTES = Number(process.env['IO_PARSER_MAX_BYTES'] ?? 2 * 1024 * 1024);
/** Orçamento defensivo de parse de um arquivo JS/TS (não interrompe parser síncrono; sinaliza excedente). */
const MAX_PARSE_DURATION_MS = Number(process.env['IO_PARSER_MAX_DURATION_MS'] ?? 150);
/** Guarda por número de linhas para evitar parse em arquivos muito extensos no event loop principal. */
const MAX_PARSE_LINE_GUARD = Number(process.env['IO_PARSER_MAX_LINES'] ?? 30_000);
/** Parsing off-main-thread habilitado por padrão. */
const PARSER_WORKER_ENABLED = String(process.env['IO_PARSER_WORKER_ENABLED'] ?? '1').trim() !== '0';
const PARSER_WORKER_POOL_POLICY = resolveParserWorkerPoolPolicy();
/** Tamanho do pool leve de worker threads para parsing. */
const PARSER_WORKER_POOL_SIZE = PARSER_WORKER_POOL_POLICY.size;
const PARSER_WORKER_QUEUE_POLICY = resolveParserWorkerQueuePolicy(process.env, PARSER_WORKER_POOL_SIZE);
/** Backpressure explícito para requests aguardando worker. */
const PARSER_WORKER_QUEUE_MAX = PARSER_WORKER_QUEUE_POLICY.max;
const FILE_CONTEXT_CACHE_DISABLED_VALUES = new Set(['0', 'false', 'off', 'disabled']);
/** Timeout máximo por request no worker (ms). */
const PARSER_WORKER_REQUEST_TIMEOUT_MS = Math.max(
    MAX_PARSE_DURATION_MS,
    Number(process.env['IO_PARSER_WORKER_REQUEST_TIMEOUT_MS'] ?? 500),
);
const PARSER_WORKER_RESTART_BACKOFF_MS = [100, 250, 500, 1_000, 2_000, 5_000];
const SYMBOL_CACHE_MAX_ENTRIES = readPositiveIntegerEnv('IO_PARSER_SYMBOL_CACHE_MAX_ENTRIES', 500);
const SYMBOL_CACHE_MAX_BYTES = readPositiveIntegerEnv('IO_PARSER_SYMBOL_CACHE_MAX_BYTES', 64 * 1024 * 1024);
const FILE_CONTEXT_CACHE_MAX_ENTRIES = readPositiveIntegerEnv('IO_PARSER_FILE_CONTEXT_CACHE_MAX_ENTRIES', 256);
const FILE_CONTEXT_CACHE_MAX_BYTES = readPositiveIntegerEnv('IO_PARSER_FILE_CONTEXT_CACHE_MAX_BYTES', 64 * 1024 * 1024);

/**
 * @param {string} name
 * @param {number} fallback
 * @returns {number}
 */
function readPositiveIntegerEnv(name, fallback) {
    const value = Number(process.env[name] ?? fallback);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @param {number} [parallelism]
 * @returns {{ size: number; source: 'adaptive' | 'configured'; availableParallelism: number }}
 */
export function resolveParserWorkerPoolPolicy(env = process.env, parallelism = availableParallelism()) {
    const normalizedParallelism =
        Number.isFinite(parallelism) && parallelism >= 1 ? Math.floor(parallelism) : 1;
    const adaptiveSize = Math.max(1, Math.min(4, normalizedParallelism - 1));
    const configured = String(env['IO_PARSER_WORKER_POOL_SIZE'] ?? '').trim();
    if (!configured) {
        return {
            size: adaptiveSize,
            source: 'adaptive',
            availableParallelism: normalizedParallelism,
        };
    }
    const parsed = Number(configured);
    if (!Number.isFinite(parsed) || parsed < 1) {
        return {
            size: adaptiveSize,
            source: 'adaptive',
            availableParallelism: normalizedParallelism,
        };
    }
    return {
        size: Math.min(16, Math.floor(parsed)),
        source: 'configured',
        availableParallelism: normalizedParallelism,
    };
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @param {number} [poolSize]
 * @returns {{ max: number; source: 'adaptive' | 'configured' }}
 */
export function resolveParserWorkerQueuePolicy(env = process.env, poolSize = PARSER_WORKER_POOL_SIZE) {
    const normalizedPoolSize = Number.isFinite(poolSize) && poolSize >= 1 ? Math.floor(poolSize) : 1;
    const adaptiveMax = Math.max(16, normalizedPoolSize * 32);
    const configured = String(env['IO_PARSER_WORKER_QUEUE_MAX'] ?? '').trim();
    if (!configured) {
        return {
            max: adaptiveMax,
            source: 'adaptive',
        };
    }
    const parsed = Number(configured);
    if (!Number.isFinite(parsed) || parsed < 0) {
        return {
            max: adaptiveMax,
            source: 'adaptive',
        };
    }
    return {
        max: Math.min(10_000, Math.floor(parsed)),
        source: 'configured',
    };
}

/**
 * Estima retenção heap do resultado sem serializá-lo novamente.
 *
 * @param {FileSymbols} value
 * @returns {number}
 */
function estimateFileSymbolsSize(value) {
    let size = Math.max(1, value.parsedBytes);
    for (const symbol of value.symbols) {
        size += 96 + symbol.name.length * 2 + (symbol.docComment?.length ?? 0) * 2;
    }
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

/**
 * @param {FileContext} value
 * @returns {number}
 */
function estimateFileContextCacheSize(value) {
    let size = estimateFileSymbolsSize(value.symbols);
    for (const line of value.outline) size += 16 + line.length * 2;
    for (const comment of value.topComments) size += 16 + comment.length * 2;
    return size;
}

/** Cache de símbolos parseados: bounded por entradas e peso estimado, TTL 5 min. */
const _symbolCache = new LRUCache(
    /** @type {any} */ ({
        max: SYMBOL_CACHE_MAX_ENTRIES,
        maxSize: SYMBOL_CACHE_MAX_BYTES,
        sizeCalculation: estimateFileSymbolsCacheSize,
        ttl: 5 * 60_000,
        updateAgeOnGet: true,
    }),
);

/** Cache de contexto completo de arquivo: symbols + outline + top comments, keyado por path+hash de conteúdo. */
const _fileContextCache = new LRUCache(
    /** @type {any} */ ({
        max: FILE_CONTEXT_CACHE_MAX_ENTRIES,
        maxSize: FILE_CONTEXT_CACHE_MAX_BYTES,
        sizeCalculation: estimateFileContextCacheSize,
        ttl: Number(process.env['IO_PARSER_FILE_CONTEXT_CACHE_TTL_MS'] ?? 5 * 60_000),
        updateAgeOnGet: true,
    }),
);

/** @type {(() => void) | null} */
let _parserInvalidationUnregister = null;

/**
 * @type {{
 *     budgetExceeded: number;
 *     skippedByLineGuard: number;
 *     lastParseDurationMs: number;
 *     workerRequests: number;
 *     workerTimeouts: number;
 *     workerFailures: number;
 *     workerFallbacks: number;
 *     workerQueueRejected: number;
 *     workerQueueTimeouts: number;
 *     workerQueueHighWater: number;
 *     workerQueueWaitMsLast: number;
 *     workerQueueWaitMsMax: number;
 *     workerRestarts: number;
 *     workerRestartFailures: number;
 *     symbolCacheHits: number;
 *     symbolCacheMisses: number;
 *     symbolCacheStale: number;
 *     symbolSnapshotReads: number;
 *     symbolSuppliedSnapshots: number;
 *     symbolSnapshotConflicts: number;
 * }}
 */
const _parserRuntimeStats = {
    budgetExceeded: 0,
    skippedByLineGuard: 0,
    lastParseDurationMs: 0,
    workerRequests: 0,
    workerTimeouts: 0,
    workerFailures: 0,
    workerFallbacks: 0,
    workerQueueRejected: 0,
    workerQueueTimeouts: 0,
    workerQueueHighWater: 0,
    workerQueueWaitMsLast: 0,
    workerQueueWaitMsMax: 0,
    workerRestarts: 0,
    workerRestartFailures: 0,
    symbolCacheHits: 0,
    symbolCacheMisses: 0,
    symbolCacheStale: 0,
    symbolSnapshotReads: 0,
    symbolSuppliedSnapshots: 0,
    symbolSnapshotConflicts: 0,
};

const _fileContextCacheStats = {
    hits: 0,
    misses: 0,
    sets: 0,
    clears: 0,
    bypasses: 0,
    rejected: 0,
};

/** @type {number} */
let _workerRequestSeq = 0;

/**
 * @typedef {{
 *     id: number;
 *     payload: { source: string; parserOptions: Record<string, unknown>; maxParseDurationMs: number };
 *     timeoutMs: number;
 *     queuedAtMs: number;
 *     queueTimeout: NodeJS.Timeout | null;
 *     resolve: (value: any) => void;
 *     reject: (reason?: unknown) => void;
 * }} _WorkerTask
 */

/**
 * @typedef {{
 *     index: number;
 *     worker: Worker;
 *     busy: boolean;
 *     currentTaskId: number | null;
 *     restarting: boolean;
 *     restartPromise: Promise<void> | null;
 * }} _WorkerSlot
 */

/** @type {_WorkerSlot[]} */
const _workerPool = [];

/** @type {_WorkerTask[]} */
const _workerQueue = [];

/** @type {Map<number, { task: _WorkerTask; timeout: NodeJS.Timeout; slot: _WorkerSlot }>} */
const _workerInFlight = new Map();

let _workerPoolInitialized = false;
let _workerPoolDisabledByError = false;
let _workerPoolShuttingDown = false;
let _workerPoolGeneration = 0;

function ensureInvalidationHook() {
    if (_parserInvalidationUnregister) return;
    _parserInvalidationUnregister = registerInvalidationHook((filePath, event) => {
        const normalized = normalizeParserPath(filePath);
        _symbolCache.delete(normalized);
        clearFileContextCacheForNormalizedPath(normalized, event?.recursive === true);
        if (event?.recursive === true) {
            const prefix = `${normalized}${nodePath.sep}`;
            for (const key of _symbolCache.keys()) {
                if (String(key).startsWith(prefix)) _symbolCache.delete(key);
            }
        }
    });
}

// ---------------------------------------------------------------------------
// Typedefs
// ---------------------------------------------------------------------------

/**
 * @typedef {object} SymbolEntry
 * @property {'function' | 'class' | 'variable' | 'type' | 'interface' | 'enum' | 'import' | 'export'} kind
 * @property {string} name - Nome do símbolo.
 * @property {boolean} exported - Se o símbolo é exportado.
 * @property {number} line - Linha de declaração (1-based).
 * @property {string | null} [docComment] - JSDoc/comentário precedente se presente.
 */

/**
 * @typedef {object} ImportEntry
 * @property {string} source - Módulo importado (e.g., 'node:fs', './io-cache.js').
 * @property {string[]} specifiers - Nomes importados ([] para side-effect imports).
 * @property {boolean} isDynamic - Se é import() dinâmico.
 * @property {number} line - Linha do import.
 */

/**
 * @typedef {object} FileSymbols
 * @property {string} filePath - Path do arquivo.
 * @property {string} ext - Extensão (ex.: '.js', '.ts', '.json').
 * @property {SymbolEntry[]} symbols - Símbolos declarados/exportados.
 * @property {ImportEntry[]} imports - Imports do arquivo.
 * @property {string[]} exports - Nomes exportados (para ES module exports).
 * @property {string | null} parseError - Mensagem de erro se parse falhou.
 * @property {boolean} truncated - Se o arquivo foi truncado por ser grande demais.
 * @property {number} lines - Total de linhas do arquivo.
 * @property {number} bytes - Tamanho em bytes.
 * @property {number} parsedBytes - Tamanho em bytes efetivamente entregue ao parser.
 * @property {number} parseDurationMs - Duração de parse no runtime atual.
 */

/**
 * @typedef {object} FileContext
 * @property {FileSymbols} symbols - Resultado do parse de símbolos.
 * @property {string[]} outline - Outline simbólico resumido (strings legíveis por LLM).
 * @property {string[]} topComments - Primeiros comentários de bloco/JSDoc do arquivo.
 */

/**
 * @typedef {object} ParserFingerprint
 * @property {number} sizeBytes
 * @property {number} mtimeMs
 * @property {number} ctimeMs
 * @property {number} dev
 * @property {number} ino
 */

/**
 * @typedef {object} SymbolCacheEntry
 * @property {FileSymbols} symbols
 * @property {ParserFingerprint} fingerprint
 */

// ---------------------------------------------------------------------------
// Babel parser loader (lazy para não quebrar se não disponível)
// ---------------------------------------------------------------------------

/** @type {((code: string, opts: object) => any) | null | 'unavailable'} */
let _babelParse = null;

/** @returns {Promise<((code: string, opts: object) => any) | null>} */
async function getBabelParse() {
    if (_babelParse !== null) return _babelParse === 'unavailable' ? null : _babelParse;
    try {
        const m = await import('@babel/parser');
        _babelParse = m.parse ?? m.default?.parse ?? null;
        if (!_babelParse) _babelParse = 'unavailable';
    } catch {
        _babelParse = 'unavailable';
    }
    return _babelParse === 'unavailable' ? null : _babelParse;
}

// ---------------------------------------------------------------------------
// Extension → language map
// ---------------------------------------------------------------------------

const JS_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.jsx']);
const TS_EXTENSIONS = new Set(['.ts', '.mts', '.cts', '.tsx']);

/**
 * @param {string} filePath
 * @returns {string}
 */
function normalizeParserPath(filePath) {
    return nodePath.normalize(nodePath.resolve(filePath));
}

/**
 * @param {string} ext
 * @returns {'js' | 'ts' | 'json' | 'markdown' | 'unknown'}
 */
function classifyExtension(ext) {
    if (JS_EXTENSIONS.has(ext)) return 'js';
    if (TS_EXTENSIONS.has(ext)) return 'ts';
    if (ext === '.json' || ext === '.jsonl') return 'json';
    if (ext === '.md' || ext === '.mdx') return 'markdown';
    return 'unknown';
}

const PARSER_WORKER_URL = new URL('./io-parser-worker.js', import.meta.url);

/**
 * @param {string} message
 * @param {string} code
 * @returns {Error & { code: string }}
 */
function makeParserWorkerRuntimeError(message, code) {
    const error = /** @type {Error & { code: string }} */ (new Error(message));
    error.code = code;
    return error;
}

/**
 * @param {unknown} error
 * @returns {string | null}
 */
function getParserWorkerRuntimeErrorCode(error) {
    return typeof error === 'object' && error !== null && typeof /** @type {{ code?: unknown }} */ (error).code === 'string'
        ? /** @type {{ code: string }} */ (error).code
        : null;
}

/**
 * @param {_WorkerTask} task
 * @returns {boolean}
 */
function removeQueuedWorkerTask(task) {
    const index = _workerQueue.findIndex((queued) => queued.id === task.id);
    if (index < 0) return false;
    _workerQueue.splice(index, 1);
    return true;
}

/**
 * @param {_WorkerSlot} slot
 * @returns {void}
 */
function dispatchQueuedWorkerTask(slot) {
    if (slot.busy || slot.restarting) return;
    const task = _workerQueue.shift();
    if (!task) return;
    if (task.queueTimeout) {
        clearTimeout(task.queueTimeout);
        task.queueTimeout = null;
    }

    const queueWaitMs = Math.max(0, Math.round(performance.now() - task.queuedAtMs));
    _parserRuntimeStats.workerQueueWaitMsLast = queueWaitMs;
    _parserRuntimeStats.workerQueueWaitMsMax = Math.max(_parserRuntimeStats.workerQueueWaitMsMax, queueWaitMs);
    const remainingTimeoutMs = task.timeoutMs - queueWaitMs;
    if (remainingTimeoutMs <= 0) {
        _parserRuntimeStats.workerQueueTimeouts += 1;
        task.reject(
            makeParserWorkerRuntimeError(
                `parser worker queue timeout (${task.timeoutMs}ms)`,
                'ERR_IO_PARSER_WORKER_QUEUE_TIMEOUT',
            ),
        );
        dispatchQueuedWorkerTask(slot);
        return;
    }

    slot.busy = true;
    slot.currentTaskId = task.id;
    slot.worker.ref?.();

    const timeout = setTimeout(() => {
        _parserRuntimeStats.workerTimeouts += 1;
        _workerInFlight.delete(task.id);
        task.reject(
            makeParserWorkerRuntimeError(
                `parser worker timeout (${task.timeoutMs}ms)`,
                'ERR_IO_PARSER_WORKER_TIMEOUT',
            ),
        );
        void restartWorkerSlot(slot);
    }, remainingTimeoutMs);
    timeout.unref?.();

    _workerInFlight.set(task.id, { task, timeout, slot });
    slot.worker.postMessage({ id: task.id, payload: task.payload });
}

/**
 * @param {_WorkerSlot} slot
 * @param {{ id: number; ok: boolean; result?: unknown; error?: string }} message
 * @returns {void}
 */
function handleWorkerMessage(slot, message) {
    const inFlight = _workerInFlight.get(Number(message?.id ?? -1));
    if (!inFlight) return;

    clearTimeout(inFlight.timeout);
    _workerInFlight.delete(inFlight.task.id);
    slot.busy = false;
    slot.currentTaskId = null;
    slot.worker.unref?.();

    if (message.ok) {
        inFlight.task.resolve(message.result);
    } else {
        _parserRuntimeStats.workerFailures += 1;
        inFlight.task.reject(new Error(message.error ?? 'parser worker error'));
    }

    dispatchQueuedWorkerTask(slot);
}

/**
 * @param {number} index
 * @returns {_WorkerSlot}
 */
function createWorkerSlot(index) {
    const worker = new Worker(PARSER_WORKER_URL);
    worker.unref?.();
    /** @type {_WorkerSlot} */
    const slot = {
        index,
        worker,
        busy: false,
        currentTaskId: null,
        restarting: false,
        restartPromise: null,
    };

    worker.on('message', (message) => {
        handleWorkerMessage(
            slot,
            /** @type {{ id: number; ok: boolean; result?: unknown; error?: string }} */ (message),
        );
    });

    worker.on('error', () => {
        if (_workerPoolShuttingDown) return;
        _parserRuntimeStats.workerFailures += 1;
        if (slot.currentTaskId !== null) {
            const inFlight = _workerInFlight.get(slot.currentTaskId);
            if (inFlight) {
                clearTimeout(inFlight.timeout);
                _workerInFlight.delete(slot.currentTaskId);
                inFlight.task.reject(new Error('parser worker crashed'));
            }
        }
        void restartWorkerSlot(slot);
    });

    worker.on('exit', (code) => {
        if (code === 0) return;
        if (_workerPoolShuttingDown) return;
        _parserRuntimeStats.workerFailures += 1;
        if (slot.currentTaskId !== null) {
            const inFlight = _workerInFlight.get(slot.currentTaskId);
            if (inFlight) {
                clearTimeout(inFlight.timeout);
                _workerInFlight.delete(slot.currentTaskId);
                inFlight.task.reject(new Error(`parser worker exited with code ${code}`));
            }
        }
        void restartWorkerSlot(slot);
    });

    return slot;
}

/**
 * @param {_WorkerSlot} slot
 * @returns {Promise<void>}
 */
async function restartWorkerSlot(slot) {
    if (slot.restartPromise) return slot.restartPromise;
    const generation = _workerPoolGeneration;
    slot.restarting = true;
    slot.restartPromise = (async () => {
        const previousWorker = slot.worker;
        previousWorker.removeAllListeners();
        previousWorker.unref?.();
        try {
            await previousWorker.terminate();
        } catch {
            // best effort
        }

        slot.busy = false;
        slot.currentTaskId = null;

        let attempt = 0;
        while (!_workerPoolShuttingDown && generation === _workerPoolGeneration) {
            if (attempt > 0) {
                const delayMs =
                    PARSER_WORKER_RESTART_BACKOFF_MS[
                        Math.min(attempt - 1, PARSER_WORKER_RESTART_BACKOFF_MS.length - 1)
                    ] ?? 5_000;
                await new Promise((resolve) => {
                    const timer = setTimeout(resolve, delayMs);
                    timer.unref?.();
                });
            }
            if (_workerPoolShuttingDown || generation !== _workerPoolGeneration) return;
            try {
                const replacement = createWorkerSlot(slot.index);
                _workerPool[slot.index] = replacement;
                _workerPoolDisabledByError = false;
                _parserRuntimeStats.workerRestarts += 1;
                dispatchQueuedWorkerTask(replacement);
                return;
            } catch {
                _parserRuntimeStats.workerRestartFailures += 1;
                attempt += 1;
            }
        }
    })().finally(() => {
        slot.restarting = false;
        slot.restartPromise = null;
    });
    return slot.restartPromise;
}

function ensureWorkerPool() {
    if (!PARSER_WORKER_ENABLED || _workerPoolDisabledByError || _workerPoolInitialized) return;
    _workerPoolInitialized = true;
    try {
        for (let i = 0; i < PARSER_WORKER_POOL_SIZE; i += 1) {
            _workerPool.push(createWorkerSlot(i));
        }
    } catch {
        _workerPoolDisabledByError = true;
        _workerPool.length = 0;
    }
}

/**
 * @param {{ source: string; parserOptions: Record<string, unknown>; maxParseDurationMs: number }} payload
 * @returns {Promise<{
 *     symbols: SymbolEntry[];
 *     imports: ImportEntry[];
 *     exports: string[];
 *     parseError: string | null;
 *     parseDurationMs: number;
 * }>}
 */
async function parseSymbolsInWorker(payload) {
    ensureWorkerPool();
    if (_workerPoolDisabledByError || _workerPool.length === 0) {
        throw new Error('parser worker pool unavailable');
    }

    _parserRuntimeStats.workerRequests += 1;
    const id = ++_workerRequestSeq;

    return await new Promise((resolve, reject) => {
        const freeSlot = _workerPool.find((slot) => !slot.busy && !slot.restarting);
        if (!freeSlot && _workerQueue.length >= PARSER_WORKER_QUEUE_MAX) {
            _parserRuntimeStats.workerQueueRejected += 1;
            reject(
                makeParserWorkerRuntimeError(
                    `parser worker queue full (${_workerQueue.length}/${PARSER_WORKER_QUEUE_MAX})`,
                    'ERR_IO_PARSER_WORKER_QUEUE_FULL',
                ),
            );
            return;
        }
        /** @type {_WorkerTask} */
        const task = {
            id,
            payload,
            timeoutMs: PARSER_WORKER_REQUEST_TIMEOUT_MS,
            queuedAtMs: performance.now(),
            queueTimeout: null,
            resolve,
            reject,
        };
        _workerQueue.push(task);
        _parserRuntimeStats.workerQueueHighWater = Math.max(
            _parserRuntimeStats.workerQueueHighWater,
            _workerQueue.length,
        );
        task.queueTimeout = setTimeout(() => {
            if (!removeQueuedWorkerTask(task)) return;
            _parserRuntimeStats.workerQueueTimeouts += 1;
            reject(
                makeParserWorkerRuntimeError(
                    `parser worker queue timeout (${task.timeoutMs}ms)`,
                    'ERR_IO_PARSER_WORKER_QUEUE_TIMEOUT',
                ),
            );
        }, task.timeoutMs);
        task.queueTimeout.unref?.();

        if (freeSlot) dispatchQueuedWorkerTask(freeSlot);
    });
}

async function teardownWorkerPoolForTest() {
    _workerPoolShuttingDown = true;
    _workerPoolGeneration += 1;
    while (_workerQueue.length > 0) {
        const queued = _workerQueue.shift();
        if (queued?.queueTimeout) clearTimeout(queued.queueTimeout);
        queued?.reject(new Error('parser worker pool reset'));
    }

    for (const inFlight of _workerInFlight.values()) {
        clearTimeout(inFlight.timeout);
        inFlight.task.reject(new Error('parser worker pool reset'));
    }
    _workerInFlight.clear();

    await Promise.allSettled(
        _workerPool.map(async (slot) => {
            slot.worker.unref?.();
            try {
                await slot.worker.terminate();
            } finally {
                slot.worker.removeAllListeners();
            }
        }),
    );
    _workerPool.length = 0;
    _workerPoolInitialized = false;
    _workerPoolDisabledByError = false;
    _workerPoolShuttingDown = false;
    _workerRequestSeq = 0;
}

/**
 * Encerra o pool de workers do parser quando um processo de CLI/one-shot termina seu trabalho.
 *
 * Servidores long-lived deixam o pool vivo para amortizar custo de parse. CLIs como `copilot:index build`, por outro
 * lado, precisam liberar os workers explicitamente para que o processo Node encerre apos o resumo operacional.
 *
 * @returns {Promise<void>}
 */
export async function shutdownParserWorkerPool() {
    await teardownWorkerPoolForTest();
}

// ---------------------------------------------------------------------------
// JS/TS parsing via @babel/parser
// ---------------------------------------------------------------------------

/**
 * @param {string} code
 * @param {Record<string, unknown>} parserOptions
 * @returns {{ ast: any | null; parseError: string | null }}
 */
function tryBabelParse(code, parserOptions) {
    const parser = _babelParse;
    if (!parser || parser === 'unavailable') return { ast: null, parseError: 'babel parser unavailable' };
    try {
        return { ast: parser(code, parserOptions), parseError: null };
    } catch (error) {
        return { ast: null, parseError: formatBabelParserError(error) };
    }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parseia um arquivo JS/TS e extrai símbolos, imports e exports.
 *
 * @param {string} filePath - Path do arquivo.
 * @param {string} content - Conteúdo já lido (evita dupla leitura).
 * @returns {Promise<FileSymbols>}
 */
export async function parseFileSymbols(filePath, content) {
    const ext = nodePath.extname(filePath).toLowerCase();
    const lang = classifyExtension(ext);
    const parserOptions = lang === 'js' || lang === 'ts' ? resolveBabelParserOptions(filePath, lang) : null;
    const bytes = utf8ByteLength(content, 'parser content');
    const truncated = bytes > MAX_PARSE_BYTES;
    const source = truncated ? truncateUtf8String(content, MAX_PARSE_BYTES).text : content;
    const parsedBytes = truncated ? utf8ByteLength(source, 'parser truncated content') : bytes;
    const lines = countPhysicalTextLines(content);

    /** @type {FileSymbols} */
    const base = {
        filePath,
        ext,
        symbols: [],
        imports: [],
        exports: [],
        parseError: null,
        truncated,
        lines,
        bytes,
        parsedBytes,
        parseDurationMs: 0,
    };

    if (lang === 'js' || lang === 'ts') {
        if (lines > MAX_PARSE_LINE_GUARD) {
            _parserRuntimeStats.skippedByLineGuard += 1;
            base.parseError = `parser skipped: line guard exceeded (${lines} > ${MAX_PARSE_LINE_GUARD})`;
            return base;
        }

        if (PARSER_WORKER_ENABLED) {
            try {
                const workerResult = await parseSymbolsInWorker({
                    source,
                    parserOptions: /** @type {Record<string, unknown>} */ (parserOptions),
                    maxParseDurationMs: MAX_PARSE_DURATION_MS,
                });
                base.parseDurationMs = Number(workerResult.parseDurationMs ?? 0);
                _parserRuntimeStats.lastParseDurationMs = base.parseDurationMs;
                if (
                    typeof workerResult.parseError === 'string' &&
                    workerResult.parseError.includes('budget exceeded')
                ) {
                    _parserRuntimeStats.budgetExceeded += 1;
                }
                base.parseError = workerResult.parseError;
                base.symbols = workerResult.symbols;
                base.imports = workerResult.imports;
                base.exports = workerResult.exports;
                return base;
            } catch (error) {
                const errorCode = getParserWorkerRuntimeErrorCode(error);
                if (
                    errorCode === 'ERR_IO_PARSER_WORKER_QUEUE_FULL' ||
                    errorCode === 'ERR_IO_PARSER_WORKER_QUEUE_TIMEOUT' ||
                    errorCode === 'ERR_IO_PARSER_WORKER_TIMEOUT'
                ) {
                    base.parseError = error instanceof Error ? error.message : 'parser worker overloaded';
                    return base;
                }
                _parserRuntimeStats.workerFallbacks += 1;
            }
        }

        await getBabelParse();
        const parseStart = performance.now();
        const parsed = tryBabelParse(source, /** @type {Record<string, unknown>} */ (parserOptions));
        const parseDurationMs = Math.max(0, Math.round(performance.now() - parseStart));
        base.parseDurationMs = parseDurationMs;
        _parserRuntimeStats.lastParseDurationMs = parseDurationMs;

        if (!parsed.ast) {
            base.parseError = parsed.parseError ?? 'babel parse returned null';
            return base;
        }
        if (parseDurationMs > MAX_PARSE_DURATION_MS) {
            _parserRuntimeStats.budgetExceeded += 1;
            base.parseError = `parser budget exceeded (${parseDurationMs}ms > ${MAX_PARSE_DURATION_MS}ms)`;
        }
        if (parsed.ast.errors?.length) {
            const astError = parsed.ast.errors
                .map((/** @type {any} */ error) => formatBabelParserError(error))
                .join('; ');
            base.parseError = base.parseError ? `${base.parseError}; ${astError}` : astError;
        }
        const extracted = extractBabelFileSymbols(parsed.ast);
        base.symbols = extracted.symbols;
        base.imports = extracted.imports;
        base.exports = extracted.exports;
        return base;
    }

    if (lang === 'json') {
        return { ...base, ...extractJsonSchema(source) };
    }

    if (lang === 'markdown') {
        const outline = extractMarkdownOutlineWithLines(source);
        base.symbols = outline.map(({ heading, line }) => ({
            kind: /** @type {'variable'} */ ('variable'),
            name: heading,
            exported: false,
            line,
            docComment: null,
        }));
        return base;
    }

    return base;
}

/**
 * Valida a versão física, lê um snapshot textual quando necessário e cacheia o parse por path + fingerprint rico.
 *
 * @param {string} filePath
 * @param {{
 *     snapshot?: import('./io/fs/read-text.js').TextFileSnapshot;
 *     maxRetries?: number;
 * }} [options]
 * @returns {Promise<FileSymbols>}
 */
export async function parseAndCacheSymbols(filePath, options = {}) {
    ensureInvalidationHook();
    const cacheKey = normalizeParserPath(filePath);
    const maxRetries =
        Number.isInteger(options.maxRetries) && Number(options.maxRetries) >= 0
            ? Math.min(10, Number(options.maxRetries))
            : 2;
    let suppliedSnapshot = options.snapshot ?? null;

    for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
        const cached = /** @type {SymbolCacheEntry | undefined} */ (_symbolCache.get(cacheKey));
        let snapshot = suppliedSnapshot;
        suppliedSnapshot = null;

        if (snapshot) {
            _parserRuntimeStats.symbolSuppliedSnapshots += 1;
            const current = await statPathSnapshot(filePath);
            if (!parserFingerprintMatches(snapshot, current)) {
                _parserRuntimeStats.symbolSnapshotConflicts += 1;
                if (attempt <= maxRetries) continue;
                throw createStaleSnapshotError(filePath, attempt);
            }
            if (cached && parserFingerprintMatches(cached.fingerprint, snapshot)) {
                _parserRuntimeStats.symbolCacheHits += 1;
                return cached.symbols;
            }
            if (cached) {
                _parserRuntimeStats.symbolCacheStale += 1;
                _symbolCache.delete(cacheKey);
            }
        } else if (cached) {
            const current = await statPathSnapshot(filePath);
            if (parserFingerprintMatches(cached.fingerprint, current)) {
                _parserRuntimeStats.symbolCacheHits += 1;
                return cached.symbols;
            }
            _parserRuntimeStats.symbolCacheStale += 1;
            _symbolCache.delete(cacheKey);
        }

        if (!snapshot) {
            _parserRuntimeStats.symbolSnapshotReads += 1;
            snapshot = await readTextFileSnapshot(filePath);
        }
        _parserRuntimeStats.symbolCacheMisses += 1;
        const symbols = await parseFileSymbols(filePath, snapshot.content);
        const current = await statPathSnapshot(filePath);
        if (!parserFingerprintMatches(snapshot, current)) {
            _parserRuntimeStats.symbolSnapshotConflicts += 1;
            if (attempt <= maxRetries) continue;
            throw createStaleSnapshotError(filePath, attempt);
        }

        _symbolCache.set(cacheKey, {
            symbols,
            fingerprint: parserFingerprintFromSnapshot(snapshot),
        });
        return symbols;
    }

    throw createStaleSnapshotError(filePath, maxRetries + 1);
}

/**
 * @param {{ sizeBytes: number; mtimeMs: number; ctimeMs: number; dev: number | bigint; ino: number | bigint }} value
 * @returns {ParserFingerprint}
 */
function parserFingerprintFromSnapshot(value) {
    return {
        sizeBytes: value.sizeBytes,
        mtimeMs: value.mtimeMs,
        ctimeMs: value.ctimeMs,
        dev: Number(value.dev),
        ino: Number(value.ino),
    };
}

/**
 * @param {{ sizeBytes: number; mtimeMs: number; ctimeMs: number; dev: number | bigint; ino: number | bigint }} left
 * @param {{ sizeBytes?: number; size?: number; mtimeMs: number; ctimeMs: number; dev: number | bigint; ino: number | bigint }} right
 */
function parserFingerprintMatches(left, right) {
    return richFingerprintMatches(
        parserFingerprintFromSnapshot(left),
        {
            sizeBytes: Number(right.sizeBytes ?? right.size),
            mtimeMs: right.mtimeMs,
            ctimeMs: right.ctimeMs,
            dev: Number(right.dev),
            ino: Number(right.ino),
        },
        { mtimeToleranceMs: 0 },
    );
}

/**
 * Invalida o cache de símbolos para um arquivo (chamar após escrita).
 *
 * @param {string} filePath
 * @returns {void}
 */
export function invalidateParserCache(filePath) {
    const normalized = normalizeParserPath(filePath);
    _symbolCache.delete(normalized);
    clearFileContextCacheForNormalizedPath(normalized, false);
}

/**
 * Retorna snapshot de contexto para LLM-B: symbols + outline + top-level comments.
 *
 * @param {string} filePath
 * @param {string} content
 * @returns {Promise<FileContext>}
 */
export async function parseFileForContext(filePath, content) {
    ensureInvalidationHook();
    const cacheKey = buildFileContextCacheKey(filePath, content);
    if (cacheKey) {
        const cached = /** @type {FileContext | undefined} */ (_fileContextCache.get(cacheKey));
        if (cached) {
            _fileContextCacheStats.hits += 1;
            return cached;
        }
        _fileContextCacheStats.misses += 1;
    } else {
        _fileContextCacheStats.bypasses += 1;
    }
    const symbols = await parseFileSymbols(filePath, content);
    const outline = buildOutline(symbols);
    const topComments = extractTopComments(content);
    const context = { symbols, outline, topComments };
    if (cacheKey) {
        _fileContextCache.set(cacheKey, context);
        if (_fileContextCache.has(cacheKey)) _fileContextCacheStats.sets += 1;
        else _fileContextCacheStats.rejected += 1;
    }
    return context;
}

/**
 * Aplica um orçamento uniforme às coleções de contexto antes de expô-las para uma tool.
 *
 * @param {FileContext} context
 * @param {{
 *     maxItems?: number;
 *     maxBytes?: number;
 *     includeImports?: boolean;
 *     includeExports?: boolean;
 *     includeOutline?: boolean;
 *     includeTopComments?: boolean;
 * }} [options]
 */
export function windowFileContext(context, options = {}) {
    const maxItems =
        Number.isFinite(options.maxItems) && Number(options.maxItems) > 0
            ? Math.min(5_000, Math.floor(Number(options.maxItems)))
            : 500;
    const maxBytes =
        Number.isFinite(options.maxBytes) && Number(options.maxBytes) > 0
            ? Math.min(4 * 1024 * 1024, Math.floor(Number(options.maxBytes)))
            : 512 * 1024;
    let returnedContentBytes = 0;

    /**
     * @template T
     * @param {readonly T[]} items
     * @param {boolean} included
     * @returns {T[]}
     */
    const take = (items, included) => {
        if (!included) return [];
        /** @type {T[]} */
        const selected = [];
        for (const item of items) {
            if (selected.length >= maxItems) break;
            const serialized = typeof item === 'string' ? item : JSON.stringify(item);
            const itemBytes = utf8ByteLength(serialized, 'parser context output item');
            if (returnedContentBytes + itemBytes > maxBytes) break;
            selected.push(item);
            returnedContentBytes += itemBytes;
        }
        return selected;
    };

    const included = {
        symbols: true,
        imports: options.includeImports !== false,
        exports: options.includeExports !== false,
        outline: options.includeOutline !== false,
        topComments: options.includeTopComments === true,
    };
    const totalCounts = {
        symbols: context.symbols.symbols.length,
        imports: context.symbols.imports.length,
        exports: context.symbols.exports.length,
        outline: context.outline.length,
        topComments: context.topComments.length,
    };
    const symbols = take(context.symbols.symbols, included.symbols);
    const imports = take(context.symbols.imports, included.imports);
    const exports = take(context.symbols.exports, included.exports);
    const outline = take(context.outline, included.outline);
    const topComments = take(context.topComments, included.topComments);
    const returnedCounts = {
        symbols: symbols.length,
        imports: imports.length,
        exports: exports.length,
        outline: outline.length,
        topComments: topComments.length,
    };
    return {
        symbols,
        imports,
        exports,
        outline,
        topComments,
        maxItems,
        maxBytes,
        returnedContentBytes,
        totalCounts,
        returnedCounts,
        truncated: /** @type {(keyof typeof totalCounts)[]} */ (Object.keys(totalCounts)).some(
            (key) => included[key] && totalCounts[key] > returnedCounts[key],
        ),
    };
}

/**
 * Retorna estatísticas do cache de símbolos.
 *
 * @returns {{
 *     size: number;
 *     maxSize: number;
 *     calculatedSize: number;
 *     maxBytes: number;
 *     maxParseDurationMs: number;
 *     maxParseLines: number;
 *     workerEnabled: boolean;
 *     workerPoolSize: number;
 *     workerQueueMax: number;
 *     workerQueueMaxSource: string;
 *     workerQueueLength: number;
 *     workerQueueHighWater: number;
 *     workerRequestTimeoutMs: number;
 *     workerPoolInitialized: boolean;
 *     workerPoolDisabledByError: boolean;
 *     workerPoolShuttingDown: boolean;
 *     budgetExceeded: number;
 *     skippedByLineGuard: number;
 *     lastParseDurationMs: number;
 *     workerRequests: number;
 *     workerTimeouts: number;
 *     workerFailures: number;
 *     workerFallbacks: number;
 *     workerQueueRejected: number;
 *     workerQueueTimeouts: number;
 *     workerQueueWaitMsLast: number;
 *     workerQueueWaitMsMax: number;
 *     symbolCacheHits: number;
 *     symbolCacheMisses: number;
 *     symbolCacheStale: number;
 *     symbolSnapshotReads: number;
 *     symbolSuppliedSnapshots: number;
 *     symbolSnapshotConflicts: number;
 * }}
 */
/**
 * @param {string} normalizedPath
 * @param {boolean} recursive
 * @returns {number}
 */
function clearFileContextCacheForNormalizedPath(normalizedPath, recursive) {
    let removed = 0;
    const exactPrefix = `${normalizedPath}\u0000`;
    const recursivePrefix = `${normalizedPath}${nodePath.sep}`;
    for (const key of [..._fileContextCache.keys()]) {
        const textKey = String(key);
        if (!textKey.startsWith(exactPrefix) && !(recursive && textKey.startsWith(recursivePrefix))) continue;
        _fileContextCache.delete(key);
        removed += 1;
    }
    _fileContextCacheStats.clears += removed;
    return removed;
}

/**
 * @param {string} filePath
 * @param {string} content
 * @returns {string | null}
 */
function buildFileContextCacheKey(filePath, content) {
    if (!isFileContextCacheEnabled()) return null;
    const normalized = normalizeParserPath(filePath);
    const hash = createHash('sha256').update(content).digest('hex');
    return `${normalized}\u0000${content.length}\u0000${hash}`;
}

/**
 * @returns {boolean}
 */
function isFileContextCacheEnabled() {
    const value = String(process.env['IO_PARSER_FILE_CONTEXT_CACHE_ENABLED'] ?? '1').trim().toLowerCase();
    return !FILE_CONTEXT_CACHE_DISABLED_VALUES.has(value);
}

export function getParserCacheStats() {
    return {
        size: _symbolCache.size,
        maxSize: SYMBOL_CACHE_MAX_ENTRIES,
        calculatedSize: _symbolCache.calculatedSize,
        maxBytes: SYMBOL_CACHE_MAX_BYTES,
        fileContext: {
            enabled: isFileContextCacheEnabled(),
            size: _fileContextCache.size,
            maxSize: FILE_CONTEXT_CACHE_MAX_ENTRIES,
            calculatedSize: _fileContextCache.calculatedSize,
            maxBytes: FILE_CONTEXT_CACHE_MAX_BYTES,
            hits: _fileContextCacheStats.hits,
            misses: _fileContextCacheStats.misses,
            sets: _fileContextCacheStats.sets,
            clears: _fileContextCacheStats.clears,
            bypasses: _fileContextCacheStats.bypasses,
            rejected: _fileContextCacheStats.rejected,
        },
        maxParseDurationMs: MAX_PARSE_DURATION_MS,
        maxParseLines: MAX_PARSE_LINE_GUARD,
        workerEnabled: PARSER_WORKER_ENABLED,
        workerPoolSize: PARSER_WORKER_POOL_SIZE,
        workerPoolSizeSource: PARSER_WORKER_POOL_POLICY.source,
        availableParallelism: PARSER_WORKER_POOL_POLICY.availableParallelism,
        workerQueueMax: PARSER_WORKER_QUEUE_MAX,
        workerQueueMaxSource: PARSER_WORKER_QUEUE_POLICY.source,
        workerQueueLength: _workerQueue.length,
        workerQueueHighWater: _parserRuntimeStats.workerQueueHighWater,
        workerRequestTimeoutMs: PARSER_WORKER_REQUEST_TIMEOUT_MS,
        workerPoolInitialized: _workerPoolInitialized,
        workerPoolDisabledByError: _workerPoolDisabledByError,
        workerPoolShuttingDown: _workerPoolShuttingDown,
        workerPoolRestarting: _workerPool.filter((slot) => slot.restarting).length,
        budgetExceeded: _parserRuntimeStats.budgetExceeded,
        skippedByLineGuard: _parserRuntimeStats.skippedByLineGuard,
        lastParseDurationMs: _parserRuntimeStats.lastParseDurationMs,
        workerRequests: _parserRuntimeStats.workerRequests,
        workerTimeouts: _parserRuntimeStats.workerTimeouts,
        workerFailures: _parserRuntimeStats.workerFailures,
        workerFallbacks: _parserRuntimeStats.workerFallbacks,
        workerQueueRejected: _parserRuntimeStats.workerQueueRejected,
        workerQueueTimeouts: _parserRuntimeStats.workerQueueTimeouts,
        workerQueueWaitMsLast: _parserRuntimeStats.workerQueueWaitMsLast,
        workerQueueWaitMsMax: _parserRuntimeStats.workerQueueWaitMsMax,
        workerRestarts: _parserRuntimeStats.workerRestarts,
        workerRestartFailures: _parserRuntimeStats.workerRestartFailures,
        symbolCacheHits: _parserRuntimeStats.symbolCacheHits,
        symbolCacheMisses: _parserRuntimeStats.symbolCacheMisses,
        symbolCacheStale: _parserRuntimeStats.symbolCacheStale,
        symbolSnapshotReads: _parserRuntimeStats.symbolSnapshotReads,
        symbolSuppliedSnapshots: _parserRuntimeStats.symbolSuppliedSnapshots,
        symbolSnapshotConflicts: _parserRuntimeStats.symbolSnapshotConflicts,
    };
}

/**
 * Limpa cache do parser e desmonta o hook de invalidação. Útil para isolamento em testes.
 *
 * @param {{ teardownWorkers?: boolean }} [options]
 * @returns {Promise<void>}
 */
export async function resetParserCacheForTest(options = {}) {
    _symbolCache.clear();
    _fileContextCache.clear();
    _fileContextCacheStats.hits = 0;
    _fileContextCacheStats.misses = 0;
    _fileContextCacheStats.sets = 0;
    _fileContextCacheStats.clears = 0;
    _fileContextCacheStats.bypasses = 0;
    _fileContextCacheStats.rejected = 0;
    _parserRuntimeStats.budgetExceeded = 0;
    _parserRuntimeStats.skippedByLineGuard = 0;
    _parserRuntimeStats.lastParseDurationMs = 0;
    _parserRuntimeStats.workerRequests = 0;
    _parserRuntimeStats.workerTimeouts = 0;
    _parserRuntimeStats.workerFailures = 0;
    _parserRuntimeStats.workerFallbacks = 0;
    _parserRuntimeStats.workerQueueRejected = 0;
    _parserRuntimeStats.workerQueueTimeouts = 0;
    _parserRuntimeStats.workerQueueHighWater = 0;
    _parserRuntimeStats.workerQueueWaitMsLast = 0;
    _parserRuntimeStats.workerQueueWaitMsMax = 0;
    _parserRuntimeStats.workerRestarts = 0;
    _parserRuntimeStats.workerRestartFailures = 0;
    _parserRuntimeStats.symbolCacheHits = 0;
    _parserRuntimeStats.symbolCacheMisses = 0;
    _parserRuntimeStats.symbolCacheStale = 0;
    _parserRuntimeStats.symbolSnapshotReads = 0;
    _parserRuntimeStats.symbolSuppliedSnapshots = 0;
    _parserRuntimeStats.symbolSnapshotConflicts = 0;
    _parserInvalidationUnregister?.();
    _parserInvalidationUnregister = null;
    if (options.teardownWorkers === true) {
        await teardownWorkerPoolForTest();
    }
}
