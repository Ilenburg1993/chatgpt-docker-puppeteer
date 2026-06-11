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
import * as nodePath from 'node:path';
import { performance } from 'node:perf_hooks';
import { Worker } from 'node:worker_threads';
import { registerInvalidationHook } from './io-cache.js';
import { readTextFileSnapshot } from './io/fs/read-text.js';
import {
    buildOutline,
    extractJsonSchema,
    extractMarkdownOutline,
    extractMarkdownOutlineWithLines,
    extractTopComments,
} from './parse/index.js';
import { utf8ByteLength } from './shared/buffer.js';

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
/** Tamanho do pool leve de worker threads para parsing. */
const PARSER_WORKER_POOL_SIZE = Math.max(1, Number(process.env['IO_PARSER_WORKER_POOL_SIZE'] ?? 2));
const FILE_CONTEXT_CACHE_DISABLED_VALUES = new Set(['0', 'false', 'off', 'disabled']);
/** Timeout máximo por request no worker (ms). */
const PARSER_WORKER_REQUEST_TIMEOUT_MS = Math.max(
    MAX_PARSE_DURATION_MS,
    Number(process.env['IO_PARSER_WORKER_REQUEST_TIMEOUT_MS'] ?? 500),
);

/** Cache de símbolos parseados: max 500 entradas, TTL 5 min. */
const _symbolCache = new LRUCache(
    /** @type {any} */ ({
        max: 500,
        ttl: 5 * 60_000,
        updateAgeOnGet: true,
    }),
);

/** Cache de contexto completo de arquivo: symbols + outline + top comments, keyado por path+hash de conteúdo. */
const _fileContextCache = new LRUCache(
    /** @type {any} */ ({
        max: Number(process.env['IO_PARSER_FILE_CONTEXT_CACHE_MAX_ENTRIES'] ?? 256),
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
};

const _fileContextCacheStats = {
    hits: 0,
    misses: 0,
    sets: 0,
    clears: 0,
    bypasses: 0,
};

/** @type {number} */
let _workerRequestSeq = 0;

/**
 * @typedef {{
 *     id: number;
 *     payload: { source: string; lang: 'js' | 'ts'; maxParseDurationMs: number };
 *     timeoutMs: number;
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
 * @property {number} parseDurationMs - Duração de parse no runtime atual.
 */

/**
 * @typedef {object} FileContext
 * @property {FileSymbols} symbols - Resultado do parse de símbolos.
 * @property {string[]} outline - Outline simbólico resumido (strings legíveis por LLM).
 * @property {string[]} topComments - Primeiros comentários de bloco/JSDoc do arquivo.
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
 * @param {_WorkerSlot} slot
 * @returns {void}
 */
function dispatchQueuedWorkerTask(slot) {
    if (slot.busy) return;
    const task = _workerQueue.shift();
    if (!task) return;

    slot.busy = true;
    slot.currentTaskId = task.id;

    const timeout = setTimeout(() => {
        _parserRuntimeStats.workerTimeouts += 1;
        _workerInFlight.delete(task.id);
        task.reject(new Error(`parser worker timeout (${task.timeoutMs}ms)`));
        void restartWorkerSlot(slot);
    }, task.timeoutMs);
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
    /** @type {_WorkerSlot} */
    const slot = {
        index,
        worker,
        busy: false,
        currentTaskId: null,
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
    try {
        await slot.worker.terminate();
    } catch {
        // best effort
    }

    slot.busy = false;
    slot.currentTaskId = null;

    try {
        const replacement = createWorkerSlot(slot.index);
        _workerPool[slot.index] = replacement;
        dispatchQueuedWorkerTask(replacement);
    } catch {
        _workerPoolDisabledByError = true;
        while (_workerQueue.length > 0) {
            const queued = _workerQueue.shift();
            queued?.reject(new Error('parser worker pool unavailable'));
        }
    }
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
 * @param {{ source: string; lang: 'js' | 'ts'; maxParseDurationMs: number }} payload
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
        const task = {
            id,
            payload,
            timeoutMs: PARSER_WORKER_REQUEST_TIMEOUT_MS,
            resolve,
            reject,
        };
        _workerQueue.push(task);

        const freeSlot = _workerPool.find((slot) => !slot.busy);
        if (freeSlot) dispatchQueuedWorkerTask(freeSlot);
    });
}

async function teardownWorkerPoolForTest() {
    _workerPoolShuttingDown = true;
    while (_workerQueue.length > 0) {
        const queued = _workerQueue.shift();
        queued?.reject(new Error('parser worker pool reset'));
    }

    for (const inFlight of _workerInFlight.values()) {
        clearTimeout(inFlight.timeout);
        inFlight.task.reject(new Error('parser worker pool reset'));
    }
    _workerInFlight.clear();

    await Promise.allSettled(_workerPool.map((slot) => slot.worker.terminate()));
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
 * @param {'js' | 'ts'} lang
 * @returns {any | null} AST ou null se falhou
 */
function tryBabelParse(code, lang) {
    const parser = _babelParse;
    if (!parser || parser === 'unavailable') return null;
    try {
        return parser(code, {
            sourceType: 'unambiguous',
            allowImportExportEverywhere: true,
            allowReturnOutsideFunction: true,
            plugins: lang === 'ts' ? ['typescript', 'jsx', 'decorators-legacy'] : ['jsx', 'decorators-legacy'],
            errorRecovery: true,
        });
    } catch {
        return null;
    }
}

/**
 * Extrai o nome de um nó de binding (Identifier, ObjectPattern, etc.).
 *
 * @param {any} node
 * @returns {string}
 */
function extractName(node) {
    if (!node) return '<unknown>';
    if (node.type === 'Identifier') return node.name;
    if (node.type === 'RestElement') return `...${extractName(node.argument)}`;
    return `<${node.type}>`;
}

/**
 * Tenta extrair o comentário JSDoc/bloco imediatamente antes de um nó.
 *
 * @param {any} node
 * @returns {string | null}
 */
function extractLeadingComment(node) {
    const comments = node.leadingComments;
    if (!Array.isArray(comments) || comments.length === 0) return null;
    const last = comments[comments.length - 1];
    if (last.type === 'CommentBlock') return `/*${last.value}*/`.trim();
    return null;
}

/**
 * Extrai símbolos de um AST Babel.
 *
 * @param {any} ast
 * @returns {{ symbols: SymbolEntry[]; imports: ImportEntry[]; exports: string[] }}
 */
function extractSymbolsFromAst(ast) {
    /** @type {SymbolEntry[]} */
    const symbols = [];
    /** @type {ImportEntry[]} */
    const imports = [];
    /** @type {string[]} */
    const exports = [];

    if (!ast?.program?.body) return { symbols, imports, exports };

    for (const node of ast.program.body) {
        const line = node.loc?.start?.line ?? 0;

        // ── Import declarations ──────────────────────────────────────────
        if (node.type === 'ImportDeclaration') {
            imports.push({
                source: String(node.source.value),
                specifiers: (node.specifiers ?? []).map(
                    (/** @type {any} */ s) => s.local?.name ?? s.imported?.name ?? '*',
                ),
                isDynamic: false,
                line,
            });
            continue;
        }

        // ── Export named ─────────────────────────────────────────────────
        if (node.type === 'ExportNamedDeclaration') {
            const decl = node.declaration;
            if (decl) {
                const declaredSymbols = _extractDeclSymbols(decl, true, node);
                declaredSymbols.forEach((s) => symbols.push(s));
                declaredSymbols.forEach((s) => exports.push(s.name));
            }
            for (const spec of node.specifiers ?? []) {
                const name = spec.exported?.name ?? spec.exported?.value ?? '<unknown>';
                exports.push(name);
            }
            continue;
        }

        // ── Export default ───────────────────────────────────────────────
        if (node.type === 'ExportDefaultDeclaration') {
            const decl = node.declaration;
            const name =
                decl?.id?.name ??
                (decl?.type === 'FunctionDeclaration'
                    ? '<default fn>'
                    : decl?.type === 'ClassDeclaration'
                      ? '<default class>'
                      : '<default>');
            symbols.push({
                kind: 'export',
                name,
                exported: true,
                line,
                docComment: extractLeadingComment(node),
            });
            exports.push('default');
            continue;
        }

        // ── Export all ───────────────────────────────────────────────────
        if (node.type === 'ExportAllDeclaration') {
            exports.push(`* from ${node.source?.value ?? '?'}`);
            continue;
        }

        // ── Top-level declarations (non-exported) ─────────────────────────
        _extractDeclSymbols(node, false, node).forEach((s) => symbols.push(s));
    }

    return { symbols, imports, exports };
}

/**
 * @param {any} decl - Declaration node
 * @param {boolean} exported
 * @param {any} parentNode - For leading comment lookup
 * @returns {SymbolEntry[]}
 */
function _extractDeclSymbols(decl, exported, parentNode) {
    if (!decl) return [];
    const line = decl.loc?.start?.line ?? parentNode?.loc?.start?.line ?? 0;
    const comment = extractLeadingComment(parentNode ?? decl);

    if (decl.type === 'FunctionDeclaration' || decl.type === 'FunctionExpression') {
        const name = decl.id?.name ?? '<anonymous>';
        return [{ kind: 'function', name, exported, line, docComment: comment }];
    }
    if (decl.type === 'ClassDeclaration' || decl.type === 'ClassExpression') {
        const name = decl.id?.name ?? '<anonymous class>';
        return [{ kind: 'class', name, exported, line, docComment: comment }];
    }
    if (decl.type === 'TSTypeAliasDeclaration') {
        return [{ kind: 'type', name: decl.id?.name ?? '<type>', exported, line, docComment: comment }];
    }
    if (decl.type === 'TSInterfaceDeclaration') {
        return [{ kind: 'interface', name: decl.id?.name ?? '<interface>', exported, line, docComment: comment }];
    }
    if (decl.type === 'TSEnumDeclaration') {
        return [{ kind: 'enum', name: decl.id?.name ?? '<enum>', exported, line, docComment: comment }];
    }
    if (decl.type === 'VariableDeclaration') {
        return (decl.declarations ?? []).map((/** @type {any} */ d) => ({
            kind: /** @type {'variable'} */ ('variable'),
            name: extractName(d.id),
            exported,
            line: d.loc?.start?.line ?? line,
            docComment: comment,
        }));
    }
    return [];
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
    const bytes = utf8ByteLength(content, 'parser content');
    const lines = content.split('\n').length;
    const truncated = bytes > MAX_PARSE_BYTES;

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
        parseDurationMs: 0,
    };

    const source = truncated ? content.slice(0, MAX_PARSE_BYTES) : content;

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
                    lang,
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
            } catch {
                _parserRuntimeStats.workerFallbacks += 1;
            }
        }

        await getBabelParse();
        const parseStart = performance.now();
        const ast = tryBabelParse(source, lang);
        const parseDurationMs = Math.max(0, Math.round(performance.now() - parseStart));
        base.parseDurationMs = parseDurationMs;
        _parserRuntimeStats.lastParseDurationMs = parseDurationMs;

        if (parseDurationMs > MAX_PARSE_DURATION_MS) {
            _parserRuntimeStats.budgetExceeded += 1;
            base.parseError = `parser budget exceeded (${parseDurationMs}ms > ${MAX_PARSE_DURATION_MS}ms)`;
            return base;
        }

        if (!ast) {
            base.parseError = 'babel parse returned null';
            return base;
        }
        if (ast.errors?.length) {
            base.parseError = ast.errors.map((/** @type {any} */ e) => e.reasonCode ?? String(e)).join('; ');
        }
        const extracted = extractSymbolsFromAst(ast);
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
 * Lê o arquivo do disco (via io-engine + L1 cache) e parseia símbolos. Cacheia o resultado no `_symbolCache` por TTL de
 * 5 min.
 *
 * @param {string} filePath
 * @returns {Promise<FileSymbols>}
 */
export async function parseAndCacheSymbols(filePath) {
    ensureInvalidationHook();
    const cacheKey = normalizeParserPath(filePath);
    const cached = /** @type {FileSymbols | undefined} */ (_symbolCache.get(cacheKey));
    if (cached) return cached;

    const snapshot = await readTextFileSnapshot(filePath);
    const symbols = await parseFileSymbols(filePath, snapshot.content);
    _symbolCache.set(cacheKey, symbols);
    return symbols;
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
        _fileContextCacheStats.sets += 1;
    }
    return context;
}

/**
 * Retorna estatísticas do cache de símbolos.
 *
 * @returns {{
 *     size: number;
 *     maxSize: number;
 *     maxParseDurationMs: number;
 *     maxParseLines: number;
 *     workerEnabled: boolean;
 *     workerPoolSize: number;
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
        maxSize: 500,
        fileContext: {
            enabled: isFileContextCacheEnabled(),
            size: _fileContextCache.size,
            maxSize: Number(process.env['IO_PARSER_FILE_CONTEXT_CACHE_MAX_ENTRIES'] ?? 256),
            hits: _fileContextCacheStats.hits,
            misses: _fileContextCacheStats.misses,
            sets: _fileContextCacheStats.sets,
            clears: _fileContextCacheStats.clears,
            bypasses: _fileContextCacheStats.bypasses,
        },
        maxParseDurationMs: MAX_PARSE_DURATION_MS,
        maxParseLines: MAX_PARSE_LINE_GUARD,
        workerEnabled: PARSER_WORKER_ENABLED,
        workerPoolSize: PARSER_WORKER_POOL_SIZE,
        workerRequestTimeoutMs: PARSER_WORKER_REQUEST_TIMEOUT_MS,
        workerPoolInitialized: _workerPoolInitialized,
        workerPoolDisabledByError: _workerPoolDisabledByError,
        workerPoolShuttingDown: _workerPoolShuttingDown,
        budgetExceeded: _parserRuntimeStats.budgetExceeded,
        skippedByLineGuard: _parserRuntimeStats.skippedByLineGuard,
        lastParseDurationMs: _parserRuntimeStats.lastParseDurationMs,
        workerRequests: _parserRuntimeStats.workerRequests,
        workerTimeouts: _parserRuntimeStats.workerTimeouts,
        workerFailures: _parserRuntimeStats.workerFailures,
        workerFallbacks: _parserRuntimeStats.workerFallbacks,
    };
}

/**
 * Limpa cache do parser e desmonta o hook de invalidação. Útil para isolamento em testes.
 *
 * @returns {void}
 */
export function resetParserCacheForTest() {
    _symbolCache.clear();
    _fileContextCache.clear();
    _fileContextCacheStats.hits = 0;
    _fileContextCacheStats.misses = 0;
    _fileContextCacheStats.sets = 0;
    _fileContextCacheStats.clears = 0;
    _fileContextCacheStats.bypasses = 0;
    _parserRuntimeStats.budgetExceeded = 0;
    _parserRuntimeStats.skippedByLineGuard = 0;
    _parserRuntimeStats.lastParseDurationMs = 0;
    _parserRuntimeStats.workerRequests = 0;
    _parserRuntimeStats.workerTimeouts = 0;
    _parserRuntimeStats.workerFailures = 0;
    _parserRuntimeStats.workerFallbacks = 0;
    _parserInvalidationUnregister?.();
    _parserInvalidationUnregister = null;
    void teardownWorkerPoolForTest();
}
