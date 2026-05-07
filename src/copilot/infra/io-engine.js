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
import { randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import * as fs from 'node:fs/promises';
import { dirname } from 'node:path';
import { createInterface } from 'node:readline';
import { buildIoMeta, createIoTraceId, withIoMeta } from '../core/io-contracts.js';
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
import { withIoResourceLock, withIoResourceLocks } from './io-locks.js';
import { nowIoMs, publishIoOperation } from './io-observability.js';

/** @param {string} filePath */
function invalidateIoCacheTiers(filePath) {
    invalidateIoCachePath(filePath);
    const l2 = getIoL2Cache();
    if (l2) {
        l2.invalidatePath(filePath);
    }
}

/** @param {string} filePath */
function invalidateIoCacheTierSubtrees(filePath) {
    invalidateIoCacheSubtree(filePath);
    const l2 = getIoL2Cache();
    if (l2) {
        l2.invalidatePath(filePath);
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
        await fs.mkdir(dirname(filePath), { recursive: true });
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

export { withIoResourceLock };
