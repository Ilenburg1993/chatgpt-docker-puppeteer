// @ts-check
/**
 * Engine canônica de I/O local para `src/copilot`.
 *
 * Limites de tamanho são informativos por desenho: a engine mede bytes e sinaliza advisory metadata, mas não bloqueia
 * operações por tamanho. Barreiras de segurança continuam pertencendo às policies de path/URL dos adapters.
 *
 * @module copilot/infra/io-engine
 */

import { isUtf8 } from 'node:buffer';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import * as fs from 'node:fs/promises';
import { dirname } from 'node:path';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import { buildIoMeta, createIoTraceId, withIoMeta } from '../core/io-contracts.js';
import { sanitizeIoTextOutput } from '../core/io-policy.js';
import { getIoL2Cache } from './io-cache-l2-registry.js';
import {
    getIoL1Cache,
    getVerifiedIoL1Entry,
    invalidateIoCachePath,
    invalidateIoCacheSubtree,
    makeBytesKey,
    makeTextKey,
    normalizeIoCacheKey,
} from './io-cache.js';
import { findIoIndexSymbol, getIoIndexStats, searchIoIndex } from './io-index-registry.js';
import { withIoResourceLock, withIoResourceLocks } from './io-locks.js';
import { nowIoMs, publishIoOperation } from './io-observability.js';

const execFileAsync = promisify(execFile);
const RG_SEARCH_TIMEOUT_MS = undefined;

/** @type {boolean | null} */
let _rgAvailable = null;

/** @param {string} filePath */
function invalidateIoCacheTiers(filePath) {
    try {
        invalidateIoCachePath(filePath);
    } catch {
        // best-effort: falha em cache não pode interromper mutação canônica
    }
    const l2 = getIoL2Cache();
    if (l2) {
        try {
            l2.invalidatePath(filePath);
        } catch {
            // best-effort: falha em L2 não pode interromper mutação canônica
        }
    }
}

/** @param {string} filePath */
function invalidateIoCacheTierSubtrees(filePath) {
    try {
        invalidateIoCacheSubtree(filePath);
    } catch {
        // best-effort: falha em cache não pode interromper mutação canônica
    }
    const l2 = getIoL2Cache();
    if (l2) {
        try {
            l2.invalidatePath(filePath);
        } catch {
            // best-effort: falha em L2 não pode interromper mutação canônica
        }
    }
}

/**
 * @param {string | Buffer} content
 * @param {BufferEncoding} [encoding]
 * @returns {Buffer}
 */
function toBuffer(content, encoding = 'utf8') {
    return Buffer.isBuffer(content) ? content : Buffer.from(content, encoding);
}

/**
 * @param {number} startedAt
 * @returns {number}
 */
function elapsedMs(startedAt) {
    return Math.max(0, Math.round(nowIoMs() - startedAt));
}

/**
 * @param {string} filePath
 * @param {string | Buffer} content
 * @param {BufferEncoding} encoding
 * @returns {{ payload: string | Buffer; bytes: number }}
 */
function normalizeWritePayload(filePath, content, encoding) {
    void filePath;
    const buf = toBuffer(content, encoding);
    return {
        payload: Buffer.isBuffer(content) ? content : String(content),
        bytes: buf.byteLength,
    };
}

/**
 * @returns {Promise<boolean>}
 */
async function isRgAvailable() {
    if (_rgAvailable !== null) return _rgAvailable;
    try {
        await execFileAsync('rg', ['--version'], { timeout: 3000 });
        _rgAvailable = true;
    } catch {
        _rgAvailable = false;
    }
    return _rgAvailable;
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
 * @param {{
 *     pattern: string;
 *     isRegex?: boolean;
 *     caseSensitive?: boolean;
 *     includePattern?: string;
 *     excludePattern?: string;
 * }} opts
 * @returns {boolean}
 */
function canUseIndexSearch(opts) {
    return (
        opts.pattern.trim().length > 0 &&
        !opts.isRegex &&
        !opts.caseSensitive &&
        !opts.includePattern &&
        !opts.excludePattern
    );
}

/**
 * @param {{ filePath: string; relativePath: string; snippet: string }[]} rows
 * @returns {string}
 */
function formatIndexSearchRows(rows) {
    return rows
        .map((row) => {
            const snippet = String(row.snippet ?? '')
                .replaceAll('[', '')
                .replaceAll(']', '')
                .replace(/\s+/gu, ' ')
                .trim();
            return `${row.relativePath || row.filePath}: ${snippet}`;
        })
        .join('\n');
}

/**
 * @param {{
 *     pattern: string;
 *     resolved: string;
 *     isRegex?: boolean;
 *     caseSensitive?: boolean;
 *     includePattern?: string;
 *     excludePattern?: string;
 *     contextLines?: number;
 * }} opts
 * @returns {string[]}
 */
function buildGrepArgs(opts) {
    return [
        '-R',
        '-n',
        ...(opts.isRegex ? ['-E'] : ['-F']),
        ...(opts.caseSensitive ? [] : ['-i']),
        ...(opts.contextLines ? ['-C', String(opts.contextLines)] : []),
        '--exclude-dir=.git',
        '--exclude-dir=node_modules',
        '--exclude-dir=dist',
        ...(opts.includePattern ? [`--include=${opts.includePattern}`] : []),
        ...(opts.excludePattern ? [`--exclude=${opts.excludePattern}`] : []),
        opts.pattern,
        opts.resolved,
    ];
}

/**
 * @param {string} name
 * @returns {string}
 */
function escapeRegex(name) {
    return name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * @typedef {'function' | 'class' | 'variable' | 'export' | 'type' | 'all'} IoSymbolKind
 */

/**
 * @param {string} symbolName
 * @param {IoSymbolKind} kind
 * @returns {string}
 */
function buildSymbolPattern(symbolName, kind) {
    const n = escapeRegex(symbolName);

    /** @type {Record<IoSymbolKind, string>} */
    const patterns = {
        function: [
            `(?:async\\s+)?function\\s+${n}\\b`,
            `${n}\\s*[:=]\\s*(?:async\\s+)?(?:\\([^)]*\\)|\\w+)\\s*=>`,
            `${n}\\s*[:=]\\s*(?:async\\s+)?function`,
            `def\\s+${n}\\b`,
            `fn\\s+${n}\\b`,
            `func\\s+${n}\\b`,
        ].join('|'),
        class: [`class\\s+${n}\\b`, `${n}\\s*=\\s*class\\b`].join('|'),
        variable: [`(?:const|let|var)\\s+${n}\\b`, `${n}\\s*:?=\\s*(?!>)`].join('|'),
        export: [
            `export\\s+(?:default\\s+)?(?:(?:async\\s+)?function|class|const|let|var|type|interface)\\s+${n}\\b`,
            `export\\s*\\{[^}]*\\b${n}\\b`,
            `module\\.exports[\\[.].*\\b${n}\\b`,
        ].join('|'),
        type: [
            `(?:interface|type)\\s+${n}\\b`,
            `@typedef\\s+\\{[^}]+\\}\\s+${n}\\b`,
            `${n}\\s*=\\s*(?:TypeVar|NewType)\\(`,
        ].join('|'),
        all: [
            `(?:(?:async\\s+)?function|class|(?:const|let|var)|interface|type|def\\s|fn\\s|func\\s)\\s*${n}\\b`,
            `${n}\\s*[:=]\\s*(?:async\\s+)?(?:\\([^)]*\\)|\\w+)\\s*=>`,
        ].join('|'),
    };

    return patterns[kind] ?? patterns.all;
}

/**
 * @param {IoSymbolKind} kind
 * @returns {string[]}
 */
function kindToGlobs(kind) {
    if (kind === 'type') return ['*.ts', '*.tsx', '*.d.ts'];
    return ['*.js', '*.mjs', '*.cjs', '*.ts', '*.tsx', '*.py', '*.rs', '*.go'];
}

/**
 * @param {{
 *     relativePath?: string | null;
 *     filePath: string;
 *     symbolName: string;
 *     symbolKind: string;
 *     line: number;
 *     exported?: number | boolean | null;
 *     docComment?: string | null;
 * }[]} rows
 * @returns {string}
 */
function formatIndexSymbolRows(rows) {
    return rows
        .map((row) => {
            const location = `${row.relativePath || row.filePath}:${row.line}`;
            const exported = row.exported ? ' export' : '';
            const doc = String(row.docComment ?? '')
                .replace(/\s+/gu, ' ')
                .trim();
            const suffix = doc ? ` — ${doc}` : '';
            return `${location}: ${row.symbolKind} ${row.symbolName}${exported}${suffix}`;
        })
        .join('\n');
}

/**
 * Escrita atômica sem lock. O caller deve segurar o lock correto.
 *
 * @param {string} filePath
 * @param {string | Buffer} payload
 * @param {{ mode?: number }} [options]
 * @returns {Promise<void>}
 */
async function writeAtomicUnlocked(filePath, payload, options = {}) {
    const tmpPath = `${filePath}.${randomBytes(4).toString('hex')}.tmp`;
    try {
        await fs.writeFile(tmpPath, payload, options.mode === undefined ? undefined : { mode: options.mode });
        await fs.rename(tmpPath, filePath);
    } catch (error) {
        try {
            await fs.unlink(tmpPath);
        } catch {
            // best-effort cleanup
        }
        throw error;
    }
}

/**
 * Falha se o destino já existir quando a operação não autoriza overwrite.
 *
 * @param {string} destination
 * @param {boolean | undefined} overwrite
 * @returns {Promise<void>}
 */
async function assertDestinationWritable(destination, overwrite) {
    if (overwrite) return;
    try {
        await fs.access(destination);
    } catch (error) {
        const err = /** @type {{ code?: unknown; message?: unknown }} */ (error);
        if (err.code === 'ENOENT' || err.code === 'ENOTDIR' || String(err.message ?? '').includes('ENOENT')) return;
        throw error;
    }
    const error = new Error(`Destino já existe: ${destination}`);
    /** @type {{ code?: string }} */ (error).code = 'EEXIST';
    throw error;
}

/**
 * @param {import('../core/io-contracts.js').IoMeta} io
 * @param {boolean} success
 * @param {unknown} [error]
 * @returns {import('../core/io-contracts.js').IoMeta}
 */
function publishAndReturn(io, success, error) {
    publishIoOperation(io, { success, ...(error !== undefined ? { error } : {}) });
    return io;
}

/**
 * Lê bytes completos de um arquivo.
 *
 * @param {string} filePath
 * @param {{ traceId?: string; advisoryLimits?: Record<string, unknown> }} [options]
 * @returns {Promise<{
 *     path: string;
 *     content: Buffer;
 *     bytesRead: number;
 *     io: import('../core/io-contracts.js').IoMeta;
 * }>}
 */
export async function readBytes(filePath, options = {}) {
    const traceId = options.traceId ?? createIoTraceId();
    const startedAt = nowIoMs();
    try {
        const _l1 = getIoL1Cache();
        const _normalizedPath = normalizeIoCacheKey(filePath);
        const _cacheKey = makeBytesKey(_normalizedPath);
        const _cached = await getVerifiedIoL1Entry(_cacheKey, filePath);
        if (_cached) {
            const content = /** @type {Buffer} */ (
                Buffer.isBuffer(_cached.content) ? _cached.content : Buffer.from(String(_cached.content))
            );
            const io = publishAndReturn(
                buildIoMeta({
                    operation: 'read',
                    target: filePath,
                    targetKind: 'file',
                    bytesRead: content.byteLength,
                    durationMs: elapsedMs(startedAt),
                    engine: 'io-engine.fs.readFile.bytes',
                    riskClass: 'low',
                    traceId,
                    cache: 'l1-hit',
                    ...(options.advisoryLimits !== undefined ? { advisoryLimits: options.advisoryLimits } : {}),
                }),
                true,
            );
            return { path: filePath, content, bytesRead: content.byteLength, io };
        }
        const l2Cache = getIoL2Cache();
        if (l2Cache) {
            const l2Entry = l2Cache.get(_cacheKey);
            if (l2Entry?.kind === 'bytes' && Buffer.isBuffer(l2Entry.payload)) {
                const metadata = await fs.stat(filePath).catch(() => null);
                const mtimeMatches =
                    Number.isFinite(l2Entry.mtimeMs) &&
                    Number.isFinite(metadata?.mtimeMs) &&
                    Number(l2Entry.mtimeMs) === Number(metadata?.mtimeMs);
                const sizeMatches =
                    Number.isFinite(l2Entry.sizeBytes) &&
                    Number.isFinite(metadata?.size) &&
                    Number(l2Entry.sizeBytes) === Number(metadata?.size);

                if (mtimeMatches && sizeMatches) {
                    const _now = Date.now();
                    _l1.set(_cacheKey, {
                        content: l2Entry.payload,
                        bytes: l2Entry.payload.byteLength,
                        cachedAt: _now,
                        lastValidatedAt: _now,
                        accessCount: 1,
                        mtime: Number(metadata?.mtimeMs),
                        size: Number(metadata?.size),
                    });
                    const io = publishAndReturn(
                        buildIoMeta({
                            operation: 'read',
                            target: filePath,
                            targetKind: 'file',
                            bytesRead: l2Entry.payload.byteLength,
                            durationMs: elapsedMs(startedAt),
                            engine: 'io-engine.cache.l2.readBytes',
                            riskClass: 'low',
                            traceId,
                            cache: 'l2-hit',
                            ...(options.advisoryLimits !== undefined ? { advisoryLimits: options.advisoryLimits } : {}),
                        }),
                        true,
                    );
                    return {
                        path: filePath,
                        content: l2Entry.payload,
                        bytesRead: l2Entry.payload.byteLength,
                        io,
                    };
                }

                l2Cache.invalidatePath(filePath);
            }
        }
        const content = await fs.readFile(filePath);
        const _stat = await fs.stat(filePath).catch(() => null);
        const _now = Date.now();
        /** @type {import('./io-cache.js').IoCacheEntry} */
        const _entry = { content, bytes: content.byteLength, cachedAt: _now, lastValidatedAt: _now, accessCount: 1 };
        if (_stat !== null) {
            _entry.mtime = _stat.mtimeMs;
            _entry.size = _stat.size;
        }
        _l1.set(_cacheKey, _entry);
        if (l2Cache) {
            l2Cache.set({
                key: _cacheKey,
                path: filePath,
                kind: 'bytes',
                payload: content,
                sizeBytes: content.byteLength,
                mtimeMs: Number.isFinite(_entry.mtime) ? Number(_entry.mtime) : null,
            });
        }
        const io = publishAndReturn(
            buildIoMeta({
                operation: 'read',
                target: filePath,
                targetKind: 'file',
                bytesRead: content.byteLength,
                durationMs: elapsedMs(startedAt),
                engine: 'io-engine.fs.readFile.bytes',
                riskClass: 'low',
                traceId,
                cache: 'l1-miss',
                ...(options.advisoryLimits !== undefined ? { advisoryLimits: options.advisoryLimits } : {}),
            }),
            true,
        );
        return { path: filePath, content, bytesRead: content.byteLength, io };
    } catch (error) {
        publishAndReturn(
            buildIoMeta({
                operation: 'read',
                target: filePath,
                targetKind: 'file',
                durationMs: elapsedMs(startedAt),
                engine: 'io-engine.fs.readFile.bytes',
                riskClass: 'low',
                traceId,
            }),
            false,
            error,
        );
        throw error;
    }
}

/**
 * Lê texto UTF-8 completo ou um range de linhas.
 *
 * @param {string} filePath
 * @param {{
 *     startLine?: number;
 *     endLine?: number;
 *     traceId?: string;
 *     advisoryLimits?: Record<string, unknown>;
 * }} [options]
 * @returns {Promise<{
 *     path: string;
 *     content: string;
 *     bytesRead: number;
 *     totalLines: number;
 *     returnedLines: { start: number; end: number };
 *     io: import('../core/io-contracts.js').IoMeta;
 * }>}
 */
export async function readText(filePath, options = {}) {
    const traceId = options.traceId ?? createIoTraceId();
    const startedAt = nowIoMs();
    let failurePublished = false;
    try {
        const _l1 = getIoL1Cache();
        const l2Cache = getIoL2Cache();
        const _normalizedPath = normalizeIoCacheKey(filePath);
        const _textKey = makeTextKey(_normalizedPath, undefined, undefined);
        const _cachedText = await getVerifiedIoL1Entry(_textKey, filePath);
        /** @type {'l1-hit' | 'l1-miss'} */
        let _cacheState = 'l1-miss';
        /** @type {Buffer | null} */
        let raw = null;
        /** @type {string | null} */
        let text = null;
        /** @type {number} */
        let totalLines = 0;
        /** @type {number} */
        let sliceStart = 1;
        /** @type {number} */
        let sliceEnd = 1;
        /** @type {string} */
        let content = '';

        if (_cachedText !== null && typeof _cachedText.content === 'string') {
            // Cache hit: reconstituir resultado sem I/O
            _cacheState = 'l1-hit';
            const cachedContent = _cachedText.content;
            const cachedLines = cachedContent.split('\n');
            totalLines = cachedLines.length;
            const requestedStart = Math.max(1, options.startLine ?? 1);
            sliceStart = Math.min(requestedStart, totalLines + 1);
            sliceEnd = sliceStart > totalLines ? totalLines : Math.min(options.endLine ?? totalLines, totalLines);
            content = sliceStart > totalLines ? '' : cachedLines.slice(sliceStart - 1, sliceEnd).join('\n');
            const io = publishAndReturn(
                buildIoMeta({
                    operation: 'read',
                    target: filePath,
                    targetKind: 'file',
                    bytesRead: _cachedText.bytes,
                    durationMs: elapsedMs(startedAt),
                    engine: 'io-engine.fs.readFile.text',
                    riskClass: 'low',
                    traceId,
                    cache: _cacheState,
                    advisoryLimits: {
                        ...(options.advisoryLimits ?? {}),
                        ...(options.startLine !== undefined ? { startLine: options.startLine } : {}),
                        ...(options.endLine !== undefined ? { endLine: options.endLine } : {}),
                    },
                }),
                true,
            );
            return {
                path: filePath,
                content,
                bytesRead: _cachedText.bytes,
                totalLines,
                returnedLines: { start: sliceStart, end: sliceEnd },
                io,
            };
        }

        if (l2Cache) {
            const l2Entry = l2Cache.get(_textKey);
            if (l2Entry?.kind === 'text' && Buffer.isBuffer(l2Entry.payload)) {
                const metadata = await fs.stat(filePath).catch(() => null);
                const mtimeMatches =
                    Number.isFinite(l2Entry.mtimeMs) &&
                    Number.isFinite(metadata?.mtimeMs) &&
                    Number(l2Entry.mtimeMs) === Number(metadata?.mtimeMs);
                const sizeMatches =
                    Number.isFinite(l2Entry.sizeBytes) &&
                    Number.isFinite(metadata?.size) &&
                    Number(l2Entry.sizeBytes) === Number(metadata?.size);

                if (mtimeMatches && sizeMatches) {
                    const text = l2Entry.payload.toString('utf8');
                    const lines = text.split('\n');
                    const totalLines = lines.length;
                    const requestedStart = Math.max(1, options.startLine ?? 1);
                    const sliceStart = Math.min(requestedStart, totalLines + 1);
                    const sliceEnd =
                        sliceStart > totalLines ? totalLines : Math.min(options.endLine ?? totalLines, totalLines);
                    const content = sliceStart > totalLines ? '' : lines.slice(sliceStart - 1, sliceEnd).join('\n');

                    const _now = Date.now();
                    _l1.set(_textKey, {
                        content: text,
                        bytes: l2Entry.payload.byteLength,
                        cachedAt: _now,
                        lastValidatedAt: _now,
                        accessCount: 1,
                        mtime: Number(metadata?.mtimeMs),
                        size: Number(metadata?.size),
                    });

                    const io = publishAndReturn(
                        buildIoMeta({
                            operation: 'read',
                            target: filePath,
                            targetKind: 'file',
                            bytesRead: l2Entry.payload.byteLength,
                            durationMs: elapsedMs(startedAt),
                            engine: 'io-engine.cache.l2.readText',
                            riskClass: 'low',
                            traceId,
                            cache: 'l2-hit',
                            advisoryLimits: {
                                ...(options.advisoryLimits ?? {}),
                                ...(options.startLine !== undefined ? { startLine: options.startLine } : {}),
                                ...(options.endLine !== undefined ? { endLine: options.endLine } : {}),
                            },
                        }),
                        true,
                    );
                    return {
                        path: filePath,
                        content,
                        bytesRead: l2Entry.payload.byteLength,
                        totalLines,
                        returnedLines: { start: sliceStart, end: sliceEnd },
                        io,
                    };
                }

                l2Cache.invalidatePath(filePath);
            }
        }

        raw = await fs.readFile(filePath);
        const baseMeta = {
            operation: /** @type {const} */ ('read'),
            target: filePath,
            targetKind: /** @type {const} */ ('file'),
            bytesRead: raw.byteLength,
            durationMs: elapsedMs(startedAt),
            engine: 'io-engine.fs.readFile.text',
            riskClass: /** @type {const} */ ('low'),
            traceId,
            cache: _cacheState,
            advisoryLimits: {
                ...(options.advisoryLimits ?? {}),
                ...(options.startLine !== undefined ? { startLine: options.startLine } : {}),
                ...(options.endLine !== undefined ? { endLine: options.endLine } : {}),
            },
        };
        if (!isUtf8(raw)) {
            const error = new Error('Arquivo binário detectado (bytes inválidos para UTF-8).');
            publishAndReturn(buildIoMeta(baseMeta), false, error);
            failurePublished = true;
            throw error;
        }
        text = raw.toString('utf8');
        const lines = text.split('\n');
        totalLines = lines.length;
        const requestedStart = Math.max(1, options.startLine ?? 1);
        sliceStart = Math.min(requestedStart, totalLines + 1);
        sliceEnd = sliceStart > totalLines ? totalLines : Math.min(options.endLine ?? totalLines, totalLines);
        content = sliceStart > totalLines ? '' : lines.slice(sliceStart - 1, sliceEnd).join('\n');
        // Armazenar conteúdo completo para reutilização (texto é sempre o arquivo inteiro pré-slice)
        const _textStat = await fs.stat(filePath).catch(() => null);
        const _textNow = Date.now();
        /** @type {import('./io-cache.js').IoCacheEntry} */
        const _textEntry = {
            content: text,
            bytes: raw.byteLength,
            cachedAt: _textNow,
            lastValidatedAt: _textNow,
            accessCount: 1,
        };
        if (_textStat !== null) {
            _textEntry.mtime = _textStat.mtimeMs;
            _textEntry.size = _textStat.size;
        }
        _l1.set(_textKey, _textEntry);
        if (l2Cache) {
            l2Cache.set({
                key: _textKey,
                path: filePath,
                kind: 'text',
                payload: text,
                sizeBytes: raw.byteLength,
                mtimeMs: Number.isFinite(_textEntry.mtime) ? Number(_textEntry.mtime) : null,
            });
        }
        const io = publishAndReturn(buildIoMeta(baseMeta), true);
        return {
            path: filePath,
            content,
            bytesRead: raw.byteLength,
            totalLines,
            returnedLines: { start: sliceStart, end: sliceEnd },
            io,
        };
    } catch (error) {
        if (!failurePublished) {
            publishAndReturn(
                buildIoMeta({
                    operation: 'read',
                    target: filePath,
                    targetKind: 'file',
                    durationMs: elapsedMs(startedAt),
                    engine: 'io-engine.fs.readFile.text',
                    riskClass: 'low',
                    traceId,
                }),
                false,
                error,
            );
        }
        throw error;
    }
}

/**
 * Lê linhas UTF-8.
 *
 * @param {string} filePath
 * @param {Parameters<typeof readText>[1]} [options]
 */
export async function readLines(filePath, options = {}) {
    const result = await readText(filePath, options);
    return { ...result, lines: result.content.split('\n') };
}

/**
 * Lê texto UTF-8 em chunks de linhas para callers que precisam paginar payloads grandes sem montar uma resposta
 * monolítica para a LLM-B. A API é observável e informativa; não impõe limite operacional.
 *
 * @param {string} filePath
 * @param {{
 *     chunkLines?: number;
 *     startLine?: number;
 *     endLine?: number;
 *     traceId?: string;
 *     advisoryLimits?: Record<string, unknown>;
 * }} [options]
 * @returns {Promise<{
 *     path: string;
 *     chunks: { index: number; startLine: number; endLine: number; content: string; bytes: number }[];
 *     totalLines: number;
 *     bytesRead: number;
 *     io: import('../core/io-contracts.js').IoMeta;
 * }>}
 */
export async function readTextChunks(filePath, options = {}) {
    const traceId = options.traceId ?? createIoTraceId();
    const startedAt = nowIoMs();
    const chunkLines =
        Number.isFinite(options.chunkLines) && Number(options.chunkLines) > 0
            ? Math.floor(Number(options.chunkLines))
            : 200;
    const startLine = Math.max(1, options.startLine ?? 1);
    const endLine = Number.isFinite(options.endLine)
        ? Math.max(startLine, Number(options.endLine))
        : Number.POSITIVE_INFINITY;
    /** @type {{ index: number; startLine: number; endLine: number; content: string; bytes: number }[]} */
    const chunks = [];
    /** @type {string[]} */
    let current = [];
    let currentStartLine = startLine;
    let totalLines = 0;
    let bytesRead = 0;

    try {
        const stream = createReadStream(filePath, { encoding: 'utf8' });
        const rl = createInterface({ input: stream, crlfDelay: Infinity });
        for await (const line of rl) {
            totalLines += 1;
            if (totalLines < startLine) continue;
            if (totalLines > endLine) break;
            if (current.length === 0) currentStartLine = totalLines;
            current.push(line);
            if (current.length >= chunkLines) {
                const content = current.join('\n');
                const bytes = Buffer.byteLength(content, 'utf8');
                bytesRead += bytes;
                chunks.push({
                    index: chunks.length,
                    startLine: currentStartLine,
                    endLine: totalLines,
                    content,
                    bytes,
                });
                current = [];
            }
        }
        if (current.length > 0) {
            const content = current.join('\n');
            const bytes = Buffer.byteLength(content, 'utf8');
            bytesRead += bytes;
            chunks.push({
                index: chunks.length,
                startLine: currentStartLine,
                endLine: currentStartLine + current.length - 1,
                content,
                bytes,
            });
        }
        const io = publishAndReturn(
            buildIoMeta({
                operation: 'read',
                target: filePath,
                targetKind: 'file',
                bytesRead,
                durationMs: elapsedMs(startedAt),
                engine: 'io-engine.fs.createReadStream.textChunks',
                riskClass: 'low',
                traceId,
                advisoryLimits: {
                    ...(options.advisoryLimits ?? {}),
                    chunkLines,
                    startLine,
                    endLine: Number.isFinite(endLine) ? endLine : null,
                    chunkCount: chunks.length,
                    limitMode: 'informative',
                },
            }),
            true,
        );
        return { path: filePath, chunks, totalLines, bytesRead, io };
    } catch (error) {
        publishAndReturn(
            buildIoMeta({
                operation: 'read',
                target: filePath,
                targetKind: 'file',
                durationMs: elapsedMs(startedAt),
                engine: 'io-engine.fs.createReadStream.textChunks',
                riskClass: 'low',
                traceId,
            }),
            false,
            error,
        );
        throw error;
    }
}

/**
 * Escrita atômica central: tmp no mesmo diretório + rename. Usa lock por path real para evitar corrida intra-processo.
 *
 * @param {string} filePath
 * @param {string | Buffer} content
 * @param {{
 *     encoding?: BufferEncoding;
 *     riskClass?: import('../core/io-contracts.js').IoRiskClass;
 *     traceId?: string;
 *     mode?: number;
 *     requireExists?: boolean;
 *     failIfExists?: boolean;
 *     lockTimeoutMs?: number;
 *     signal?: AbortSignal;
 *     advisoryLimits?: Record<string, unknown>;
 * }} [options]
 * @returns {Promise<{
 *     path: string;
 *     bytesWritten: number;
 *     io: import('../core/io-contracts.js').IoMeta;
 *     lockWaitMs: number;
 * }>}
 */
export async function writeFileAtomic(filePath, content, options = {}) {
    const traceId = options.traceId ?? createIoTraceId();
    const startedAt = nowIoMs();
    const { payload, bytes } = normalizeWritePayload(filePath, content, options.encoding ?? 'utf8');
    try {
        const { value, waitMs } = await withIoResourceLock(
            filePath,
            async () => {
                if (options.requireExists) {
                    try {
                        await fs.access(filePath);
                    } catch {
                        const err = new Error(`Arquivo não encontrado: ${filePath}`);
                        /** @type {{ code?: string }} */ (err).code = 'ENOENT';
                        throw err;
                    }
                }

                if (options.failIfExists) {
                    try {
                        await fs.access(filePath);
                        const err = new Error(`Destino já existe: ${filePath}`);
                        /** @type {{ code?: string }} */ (err).code = 'EEXIST';
                        throw err;
                    } catch (accessError) {
                        const code = /** @type {{ code?: unknown }} */ (accessError)?.code;
                        if (code !== 'ENOENT') {
                            throw accessError;
                        }
                    }
                }

                await writeAtomicUnlocked(filePath, payload, options.mode === undefined ? {} : { mode: options.mode });
                return { path: filePath, bytesWritten: bytes };
            },
            {
                ...(options.lockTimeoutMs === undefined ? {} : { timeoutMs: options.lockTimeoutMs }),
                ...(options.signal === undefined ? {} : { signal: options.signal }),
            },
        );
        invalidateIoCacheTiers(filePath);
        const io = publishAndReturn(
            buildIoMeta({
                operation: 'write',
                target: filePath,
                targetKind: 'file',
                bytesWritten: value.bytesWritten,
                durationMs: elapsedMs(startedAt),
                engine: 'io-engine.atomic-write',
                riskClass: options.riskClass ?? 'medium',
                traceId,
                advisoryLimits: { ...(options.advisoryLimits ?? {}), lockWaitMs: waitMs },
            }),
            true,
        );
        return { ...value, lockWaitMs: waitMs, io };
    } catch (error) {
        publishAndReturn(
            buildIoMeta({
                operation: 'write',
                target: filePath,
                targetKind: 'file',
                durationMs: elapsedMs(startedAt),
                engine: 'io-engine.atomic-write',
                riskClass: options.riskClass ?? 'medium',
                traceId,
            }),
            false,
            error,
        );
        throw error;
    }
}

/**
 * Garante diretório pai e escreve de forma atômica.
 *
 * @param {string} filePath
 * @param {string | Buffer} content
 * @param {Parameters<typeof writeFileAtomic>[2] & { createParentDirs?: boolean }} [options]
 */
export async function createOrReplaceFileAtomic(filePath, content, options = {}) {
    if (options.createParentDirs !== false) {
        await mkdirPathLocked(dirname(filePath), {
            recursive: true,
            advisoryLimits: {
                operation: 'createOrReplaceFileAtomic.parentMkdir',
            },
        });
    }
    return writeFileAtomic(filePath, content, options);
}

/**
 * Append com lock por path. Mantém append separado de write para observabilidade e política de risco.
 *
 * @param {string} filePath
 * @param {string | Buffer} content
 * @param {{
 *     encoding?: BufferEncoding;
 *     mode?: number;
 *     traceId?: string;
 *     lockTimeoutMs?: number;
 *     signal?: AbortSignal;
 *     advisoryLimits?: Record<string, unknown>;
 * }} [options]
 */
export async function appendTextLocked(filePath, content, options = {}) {
    const traceId = options.traceId ?? createIoTraceId();
    const startedAt = nowIoMs();
    const { payload, bytes } = normalizeWritePayload(filePath, content, options.encoding ?? 'utf8');
    try {
        const { waitMs } = await withIoResourceLock(
            filePath,
            async () =>
                fs.appendFile(filePath, payload, options.mode === undefined ? undefined : { mode: options.mode }),
            {
                ...(options.lockTimeoutMs === undefined ? {} : { timeoutMs: options.lockTimeoutMs }),
                ...(options.signal === undefined ? {} : { signal: options.signal }),
            },
        );
        invalidateIoCacheTiers(filePath);
        const io = publishAndReturn(
            buildIoMeta({
                operation: 'append',
                target: filePath,
                targetKind: 'file',
                bytesWritten: bytes,
                durationMs: elapsedMs(startedAt),
                engine: 'io-engine.fs.appendFile',
                riskClass: 'medium',
                traceId,
                advisoryLimits: { ...(options.advisoryLimits ?? {}), lockWaitMs: waitMs },
            }),
            true,
        );
        return { path: filePath, bytesWritten: bytes, lockWaitMs: waitMs, io };
    } catch (error) {
        publishAndReturn(
            buildIoMeta({
                operation: 'append',
                target: filePath,
                targetKind: 'file',
                durationMs: elapsedMs(startedAt),
                engine: 'io-engine.fs.appendFile',
                riskClass: 'medium',
                traceId,
            }),
            false,
            error,
        );
        throw error;
    }
}

/**
 * Stat canônico com observabilidade. Leitura metadata-only, sem bloqueio por tamanho.
 *
 * @param {string} filePath
 * @param {{ traceId?: string; advisoryLimits?: Record<string, unknown> }} [options]
 * @returns {Promise<{
 *     path: string;
 *     stats: import('node:fs').Stats;
 *     io: import('../core/io-contracts.js').IoMeta;
 * }>}
 */
export async function statPath(filePath, options = {}) {
    const traceId = options.traceId ?? createIoTraceId();
    const startedAt = nowIoMs();
    try {
        const stats = await fs.stat(filePath);
        const io = publishAndReturn(
            buildIoMeta({
                operation: 'stat',
                target: filePath,
                targetKind: stats.isDirectory() ? 'directory' : 'file',
                durationMs: elapsedMs(startedAt),
                engine: 'io-engine.fs.stat',
                riskClass: 'low',
                traceId,
                ...(options.advisoryLimits !== undefined ? { advisoryLimits: options.advisoryLimits } : {}),
            }),
            true,
        );
        return { path: filePath, stats, io };
    } catch (error) {
        publishAndReturn(
            buildIoMeta({
                operation: 'stat',
                target: filePath,
                targetKind: 'unknown',
                durationMs: elapsedMs(startedAt),
                engine: 'io-engine.fs.stat',
                riskClass: 'low',
                traceId,
            }),
            false,
            error,
        );
        throw error;
    }
}

/**
 * Cria diretório com lock por path, preservando a semântica do SDK SessionFsProvider.mkdir().
 *
 * @param {string} dirPath
 * @param {{ recursive?: boolean; mode?: number; traceId?: string; advisoryLimits?: Record<string, unknown> }} [options]
 * @returns {Promise<{
 *     path: string;
 *     created: true;
 *     io: import('../core/io-contracts.js').IoMeta;
 *     lockWaitMs: number;
 * }>}
 */
export async function mkdirPathLocked(dirPath, options = {}) {
    const traceId = options.traceId ?? createIoTraceId();
    const startedAt = nowIoMs();
    try {
        const { waitMs } = await withIoResourceLock(dirPath, async () =>
            fs.mkdir(
                dirPath,
                options.mode === undefined
                    ? { recursive: Boolean(options.recursive) }
                    : { recursive: Boolean(options.recursive), mode: options.mode },
            ),
        );
        const io = publishAndReturn(
            buildIoMeta({
                operation: 'mkdir',
                target: dirPath,
                targetKind: 'directory',
                durationMs: elapsedMs(startedAt),
                engine: 'io-engine.fs.mkdir',
                riskClass: 'medium',
                traceId,
                advisoryLimits: {
                    ...(options.advisoryLimits ?? {}),
                    lockWaitMs: waitMs,
                    recursive: Boolean(options.recursive),
                },
            }),
            true,
        );
        return withIoMeta({ path: dirPath, created: /** @type {const} */ (true), lockWaitMs: waitMs }, io);
    } catch (error) {
        publishAndReturn(
            buildIoMeta({
                operation: 'mkdir',
                target: dirPath,
                targetKind: 'directory',
                durationMs: elapsedMs(startedAt),
                engine: 'io-engine.fs.mkdir',
                riskClass: 'medium',
                traceId,
            }),
            false,
            error,
        );
        throw error;
    }
}

/**
 * Remove arquivo com lock por path.
 *
 * @param {string} filePath
 * @returns {Promise<{
 *     path: string;
 *     deleted: true;
 *     io: import('../core/io-contracts.js').IoMeta;
 *     lockWaitMs: number;
 * }>}
 */
export async function deleteFileLocked(filePath) {
    const traceId = createIoTraceId();
    const startedAt = nowIoMs();
    try {
        const { waitMs } = await withIoResourceLock(filePath, async () => fs.unlink(filePath));
        invalidateIoCacheTiers(filePath);
        const io = publishAndReturn(
            buildIoMeta({
                operation: 'delete',
                target: filePath,
                targetKind: 'file',
                durationMs: elapsedMs(startedAt),
                engine: 'io-engine.fs.unlink',
                riskClass: 'high',
                traceId,
                advisoryLimits: { lockWaitMs: waitMs },
            }),
            true,
        );
        return withIoMeta({ path: filePath, deleted: /** @type {const} */ (true), lockWaitMs: waitMs }, io);
    } catch (error) {
        publishAndReturn(
            buildIoMeta({
                operation: 'delete',
                target: filePath,
                targetKind: 'file',
                durationMs: elapsedMs(startedAt),
                engine: 'io-engine.fs.unlink',
                riskClass: 'high',
                traceId,
            }),
            false,
            error,
        );
        throw error;
    }
}

/**
 * Remove arquivo ou diretório com lock por path. Usado por Session FS para cobrir `rm` recursivo sem bypass.
 *
 * @param {string} filePath
 * @param {{ recursive?: boolean; force?: boolean; traceId?: string }} [options]
 * @returns {Promise<{
 *     path: string;
 *     deleted: true;
 *     io: import('../core/io-contracts.js').IoMeta;
 *     lockWaitMs: number;
 * }>}
 */
export async function removePathLocked(filePath, options = {}) {
    const traceId = options.traceId ?? createIoTraceId();
    const startedAt = nowIoMs();
    try {
        const { waitMs } = await withIoResourceLock(filePath, async () =>
            fs.rm(filePath, { recursive: Boolean(options.recursive), force: Boolean(options.force) }),
        );
        invalidateIoCacheTierSubtrees(filePath);
        const io = publishAndReturn(
            buildIoMeta({
                operation: 'delete',
                target: filePath,
                targetKind: 'unknown',
                durationMs: elapsedMs(startedAt),
                engine: 'io-engine.fs.rm',
                riskClass: 'high',
                traceId,
                advisoryLimits: {
                    lockWaitMs: waitMs,
                    recursive: Boolean(options.recursive),
                    force: Boolean(options.force),
                },
            }),
            true,
        );
        return withIoMeta({ path: filePath, deleted: /** @type {const} */ (true), lockWaitMs: waitMs }, io);
    } catch (error) {
        publishAndReturn(
            buildIoMeta({
                operation: 'delete',
                target: filePath,
                targetKind: 'unknown',
                durationMs: elapsedMs(startedAt),
                engine: 'io-engine.fs.rm',
                riskClass: 'high',
                traceId,
            }),
            false,
            error,
        );
        throw error;
    }
}

/**
 * Copia arquivo com lock no destino.
 *
 * @param {string} source
 * @param {string} destination
 * @param {{ overwrite?: boolean; traceId?: string }} [options]
 */
export async function copyFileLocked(source, destination, options = {}) {
    const traceId = options.traceId ?? createIoTraceId();
    const startedAt = nowIoMs();
    try {
        const { value, waitMs } = await withIoResourceLocks([source, destination], async () => {
            await assertDestinationWritable(destination, options.overwrite);
            await fs.mkdir(dirname(destination), { recursive: true });
            await fs.copyFile(source, destination);
            const stats = await fs.stat(destination);
            return { bytesWritten: stats.size };
        });
        invalidateIoCacheTiers(destination);
        const io = publishAndReturn(
            buildIoMeta({
                operation: 'copy',
                target: `${source} -> ${destination}`,
                targetKind: 'file',
                bytesWritten: value.bytesWritten,
                durationMs: elapsedMs(startedAt),
                engine: 'io-engine.fs.copyFile',
                riskClass: options.overwrite ? 'high' : 'medium',
                traceId,
                advisoryLimits: { lockWaitMs: waitMs },
            }),
            true,
        );
        return { source, destination, bytesWritten: value.bytesWritten, lockWaitMs: waitMs, io };
    } catch (error) {
        publishAndReturn(
            buildIoMeta({
                operation: 'copy',
                target: `${source} -> ${destination}`,
                targetKind: 'file',
                durationMs: elapsedMs(startedAt),
                engine: 'io-engine.fs.copyFile',
                riskClass: options.overwrite ? 'high' : 'medium',
                traceId,
            }),
            false,
            error,
        );
        throw error;
    }
}

/**
 * Move/rename com locks no source e destination.
 *
 * @param {string} source
 * @param {string} destination
 * @param {{ overwrite?: boolean; traceId?: string }} [options]
 */
export async function moveFileLocked(source, destination, options = {}) {
    const traceId = options.traceId ?? createIoTraceId();
    const startedAt = nowIoMs();
    try {
        const { waitMs } = await withIoResourceLocks([source, destination], async () => {
            await assertDestinationWritable(destination, options.overwrite);
            await fs.mkdir(dirname(destination), { recursive: true });
            try {
                await fs.rename(source, destination);
            } catch (error) {
                const errCode = /** @type {{ code?: unknown }} */ (error)?.code;
                if (errCode !== 'EXDEV') throw error;
                await fs.copyFile(source, destination);
                await fs.unlink(source);
            }
        });
        invalidateIoCacheTiers(source);
        invalidateIoCacheTiers(destination);
        const io = publishAndReturn(
            buildIoMeta({
                operation: 'move',
                target: `${source} -> ${destination}`,
                targetKind: 'file',
                durationMs: elapsedMs(startedAt),
                engine: 'io-engine.fs.rename',
                riskClass: 'high',
                traceId,
                advisoryLimits: { lockWaitMs: waitMs },
            }),
            true,
        );
        return { source, destination, lockWaitMs: waitMs, io };
    } catch (error) {
        publishAndReturn(
            buildIoMeta({
                operation: 'move',
                target: `${source} -> ${destination}`,
                targetKind: 'file',
                durationMs: elapsedMs(startedAt),
                engine: 'io-engine.fs.rename',
                riskClass: 'high',
                traceId,
            }),
            false,
            error,
        );
        throw error;
    }
}

/**
 * Patch textual com read + write dentro do mesmo lock.
 *
 * @param {string} filePath
 * @param {{
 *     oldString: string;
 *     newString: string;
 *     replaceAll?: boolean;
 *     expectedOccurrences?: number;
 *     advisoryLimits?: Record<string, unknown>;
 * }} options
 */
export async function patchTextLocked(filePath, options) {
    const traceId = createIoTraceId();
    const startedAt = nowIoMs();
    try {
        const { value, waitMs } = await withIoResourceLock(filePath, async () => {
            const content = await fs.readFile(filePath, 'utf8');
            const occurrences = content.split(options.oldString).length - 1;
            if (occurrences === 0) throw new Error('old_string não encontrado no arquivo.');
            if (options.expectedOccurrences !== undefined && options.expectedOccurrences !== occurrences) {
                throw new Error(`expected_occurrences=${options.expectedOccurrences}, mas encontrado=${occurrences}.`);
            }
            if (!options.replaceAll && options.expectedOccurrences === undefined && occurrences > 1) {
                throw new Error(
                    `old_string encontrado ${occurrences} vezes. Inclua mais contexto para identificar unicamente.`,
                );
            }

            const updated = options.replaceAll
                ? content.split(options.oldString).join(options.newString)
                : content.replace(options.oldString, () => options.newString);
            await writeAtomicUnlocked(filePath, updated);
            return {
                replacedOccurrences: options.replaceAll ? occurrences : 1,
                bytesWritten: Buffer.byteLength(updated, 'utf8'),
            };
        });
        invalidateIoCacheTiers(filePath);
        const io = publishAndReturn(
            buildIoMeta({
                operation: 'patch',
                target: filePath,
                targetKind: 'file',
                bytesWritten: value.bytesWritten,
                durationMs: elapsedMs(startedAt),
                engine: 'io-engine.patchTextLocked',
                riskClass: 'high',
                traceId,
                advisoryLimits: { ...(options.advisoryLimits ?? {}), lockWaitMs: waitMs },
            }),
            true,
        );
        return { path: filePath, ...value, lockWaitMs: waitMs, io };
    } catch (error) {
        publishAndReturn(
            buildIoMeta({
                operation: 'patch',
                target: filePath,
                targetKind: 'file',
                durationMs: elapsedMs(startedAt),
                engine: 'io-engine.patchTextLocked',
                riskClass: 'high',
                traceId,
            }),
            false,
            error,
        );
        throw error;
    }
}

/**
 * Diff textual simples, sem invocar processo externo.
 *
 * @param {string} pathA
 * @param {string} pathB
 * @param {{ contextLines?: number }} [options]
 */
export async function diffText(pathA, pathB, options = {}) {
    const startedAt = nowIoMs();
    const traceId = createIoTraceId();
    try {
        const [a, b] = await Promise.all([readText(pathA), readText(pathB)]);
        const aLines = a.content.split('\n');
        const bLines = b.content.split('\n');
        const max = Math.max(aLines.length, bLines.length);
        const contextLines = Math.max(0, options.contextLines ?? 3);
        /** @type {string[]} */
        const out = [];
        for (let i = 0; i < max; i++) {
            if (aLines[i] === bLines[i]) continue;
            const start = Math.max(0, i - contextLines);
            const end = Math.min(max, i + contextLines + 1);
            out.push(`@@ ${start + 1},${end - start} @@`);
            for (let j = start; j < end; j++) {
                if (aLines[j] === bLines[j]) {
                    if (aLines[j] !== undefined) out.push(` ${aLines[j]}`);
                } else {
                    if (aLines[j] !== undefined) out.push(`-${aLines[j]}`);
                    if (bLines[j] !== undefined) out.push(`+${bLines[j]}`);
                }
            }
            i = end - 1;
        }
        const diff = out.join('\n');
        const io = publishAndReturn(
            buildIoMeta({
                operation: 'diff',
                target: `${pathA} <-> ${pathB}`,
                targetKind: 'file',
                bytesRead: a.bytesRead + b.bytesRead,
                durationMs: elapsedMs(startedAt),
                engine: 'io-engine.diffText',
                riskClass: 'low',
                traceId,
                advisoryLimits: { contextLines },
            }),
            true,
        );
        return { pathA, pathB, diff, identical: diff.trim() === '', io };
    } catch (error) {
        publishAndReturn(
            buildIoMeta({
                operation: 'diff',
                target: `${pathA} <-> ${pathB}`,
                targetKind: 'file',
                durationMs: elapsedMs(startedAt),
                engine: 'io-engine.diffText',
                riskClass: 'low',
                traceId,
            }),
            false,
            error,
        );
        throw error;
    }
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
 *     io: import('../core/io-contracts.js').IoMeta;
 * }>}
 */
export async function searchText(targetPath, options) {
    const startedAt = nowIoMs();
    const traceId = options.traceId ?? createIoTraceId();
    const advisoryLimitsBase = {
        requestedMaxResults: options.maxResults ?? null,
        limitMode: 'informative',
        patternLength: options.pattern.length,
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
                    ? searchIoIndex(options.pattern, { pathPrefix: targetPath })
                    : [];
            if (indexRows.length > 0) {
                const filteredOutput = sanitizeSearchOutput(formatIndexSearchRows(indexRows));
                const io = publishAndReturn(
                    buildSearchIo('io-engine.index.search', Buffer.byteLength(filteredOutput.text, 'utf8'), {
                        redactions: filteredOutput.redactions,
                        fallback: 'rg-on-index-miss-or-complex-query',
                    }),
                    true,
                );
                return {
                    targetPath,
                    pattern: options.pattern,
                    output: filteredOutput.text,
                    matchCount: indexRows.length,
                    engine: 'fts5-index',
                    sanitized: filteredOutput.sanitized,
                    redactions: filteredOutput.redactions,
                    io: { ...io, policyVersion: filteredOutput.policyVersion },
                };
            }
        }

        if (await isRgAvailable()) {
            try {
                const { stdout } = await execFileAsync(
                    'rg',
                    [
                        '--color=never',
                        '--no-heading',
                        ...(options.isRegex ? [] : ['--fixed-strings']),
                        ...(options.caseSensitive ? [] : ['--ignore-case']),
                        `--context=${options.contextLines ?? 2}`,
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
                        timeout: RG_SEARCH_TIMEOUT_MS,
                        maxBuffer: 1024 * 1024 * 1024,
                    },
                );
                const filteredOutput = sanitizeSearchOutput(stdout);
                const io = publishAndReturn(
                    buildSearchIo('io-engine.rg.search', Buffer.byteLength(filteredOutput.text, 'utf8'), {
                        redactions: filteredOutput.redactions,
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
                    io: { ...io, policyVersion: filteredOutput.policyVersion },
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
            const { stdout } = await execFileAsync('grep', buildGrepArgs(grepOptions), {
                cwd: options.workspaceRoot,
                timeout: RG_SEARCH_TIMEOUT_MS,
                maxBuffer: 1024 * 1024 * 1024,
            });
            const filteredOutput = sanitizeSearchOutput(stdout);
            const io = publishAndReturn(
                buildSearchIo('io-engine.grep.search', Buffer.byteLength(filteredOutput.text, 'utf8'), {
                    redactions: filteredOutput.redactions,
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
                io: { ...io, policyVersion: filteredOutput.policyVersion },
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
 *     io: import('../core/io-contracts.js').IoMeta;
 * }>}
 */
export async function searchWorkspaceSymbols(targetPath, options) {
    const startedAt = nowIoMs();
    const traceId = options.traceId ?? createIoTraceId();
    const resolvedKind = options.kind ?? 'all';
    const advisoryLimitsBase = {
        requestedMaxResults: options.maxResults ?? null,
        limitMode: 'informative',
        symbolLength: options.symbolName.length,
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
            const rows = findIoIndexSymbol(options.symbolName).filter(
                /**
                 * @param {{ filePath: string; symbolKind: string }} row
                 */
                (row) => {
                    const samePath = row.filePath === targetPath || row.filePath.startsWith(`${targetPath}/`);
                    const sameKind = resolvedKind === 'all' ? true : row.symbolKind === resolvedKind;
                    return samePath && sameKind;
                },
            );
            if (rows.length > 0) {
                const sanitized = sanitizeIoTextOutput({ text: formatIndexSymbolRows(rows) });
                const io = publishAndReturn(
                    buildSymbolIo('io-engine.index.symbol-search', Buffer.byteLength(sanitized.text, 'utf8'), {
                        redactions: sanitized.redactions,
                    }),
                    true,
                );
                return {
                    targetPath,
                    symbol: options.symbolName,
                    kind: resolvedKind,
                    output: sanitized.text,
                    matchCount: rows.length,
                    engine: 'fts5-index',
                    sanitized: sanitized.sanitized,
                    redactions: sanitized.redactions,
                    io: { ...io, policyVersion: sanitized.policyVersion },
                };
            }
        }

        if (!(await isRgAvailable())) {
            throw new Error('ripgrep (rg) não está disponível neste ambiente. workspace_symbol_search requer rg.');
        }

        const { stdout } = await execFileAsync(
            'rg',
            [
                '--color=never',
                '--no-heading',
                '--line-number',
                '--with-filename',
                '-e',
                buildSymbolPattern(options.symbolName, resolvedKind),
                ...(options.caseSensitive ? [] : ['--ignore-case']),
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
                timeout: RG_SEARCH_TIMEOUT_MS,
                maxBuffer: 1024 * 1024 * 1024,
            },
        ).catch((error) => {
            const execError = /** @type {{ code?: unknown; status?: unknown; stderr?: unknown }} */ (error);
            if ((execError.code === 1 || execError.status === 1) && !execError.stderr) {
                return { stdout: '' };
            }
            throw error;
        });

        const sanitized = sanitizeIoTextOutput({ text: stdout });
        const output = sanitized.text;
        const lines = output.split('\n').filter(Boolean);
        const io = publishAndReturn(
            buildSymbolIo('io-engine.rg.symbol-search', Buffer.byteLength(output, 'utf8'), {
                redactions: sanitized.redactions,
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
            io: { ...io, policyVersion: sanitized.policyVersion },
        };
    } catch (error) {
        publishAndReturn(buildSymbolIo('io-engine.symbol-search', 0), false, error);
        throw error;
    }
}

export { withIoResourceLock };
