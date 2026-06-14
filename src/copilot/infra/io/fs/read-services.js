// @ts-check
/**
 * Serviços de leitura com cache/observabilidade canônica para o domínio IO.
 *
 * @module copilot/infra/io/fs/read-services
 */

import { buildIoMeta, createIoTraceId } from '#copilot/core';
import { getIoL2Cache } from '../../io-cache-l2-registry.js';
import { getIoL1Cache, getVerifiedIoL1Entry, makeBytesKey, makeTextKey, normalizeIoCacheKey } from '../../io-cache.js';
import { nowIoMs, publishIoOperation } from '../../io-observability.js';
import { assertValidIoFilePath } from '../../policy/path-resource.js';
import { bufferIsUtf8, isBufferValue, toOwnedBuffer } from '../../shared/buffer.js';
import { fingerprintMatches, richFingerprintMatches } from '../../shared/fingerprint-match.js';
import { sha256 } from '../../shared/hash.js';
import { splitPhysicalTextLines } from '../../shared/text-lines.js';
import { readBytesFileSnapshot } from './read-bytes.js';
import { sliceTextByCachedLineOffsets } from './line-offset-cache.js';
import { readTextLineChunks, readTextLineChunksStream } from './read-chunks.js';
import { statPathSnapshot } from './stat.js';

/**
 * @param {number} startedAt
 * @returns {number}
 */
function elapsedMs(startedAt) {
    return Math.max(0, Math.round(nowIoMs() - startedAt));
}

/**
 * @param {unknown} metaJson
 * @returns {Record<string, unknown>}
 */
function parseCacheMetaJson(metaJson) {
    if (typeof metaJson !== 'string' || metaJson.trim() === '') return {};
    try {
        const parsed = JSON.parse(metaJson);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? /** @type {Record<string, unknown>} */ (parsed)
            : {};
    } catch {
        return {};
    }
}

/**
 * @param {Record<string, unknown>} meta
 * @returns {string}
 */
function stringifyCacheMeta(meta) {
    return JSON.stringify(meta);
}

/**
 * @param {Record<string, unknown>} meta
 * @returns {string | undefined}
 */
function readCacheContentHash(meta) {
    return typeof meta['contentHash'] === 'string' ? meta['contentHash'] : undefined;
}

/**
 * @param {Record<string, unknown>} meta
 * @returns {boolean}
 */
function hasRichCacheFingerprint(meta) {
    return ['ctimeMs', 'dev', 'ino'].every(
        (key) => typeof meta[key] === 'number' && Number.isFinite(meta[key]),
    );
}

/**
 * @param {{ mtimeMs?: number | null; sizeBytes: number }} l2Entry
 * @param {Record<string, unknown>} l2Meta
 * @param {{ mtimeMs?: number; ctimeMs?: number; size?: number; dev?: number | bigint; ino?: number | bigint } | null} metadata
 * @returns {boolean}
 */
function l2EntryMatchesStat(l2Entry, l2Meta, metadata) {
    if (!metadata) return false;
    const basicMatches = fingerprintMatches(
        {
            mtimeMs: Number(l2Entry.mtimeMs),
            sizeBytes: Number(l2Entry.sizeBytes),
        },
        {
            mtimeMs: Number(metadata.mtimeMs),
            sizeBytes: Number(metadata.size),
        },
    );
    if (!basicMatches) return false;

    if (!hasRichCacheFingerprint(l2Meta)) return true;
    return richFingerprintMatches(
        {
            mtimeMs: Number(l2Entry.mtimeMs),
            ctimeMs: Number(l2Meta['ctimeMs']),
            sizeBytes: Number(l2Entry.sizeBytes),
            dev: Number(l2Meta['dev']),
            ino: Number(l2Meta['ino']),
        },
        {
            mtimeMs: Number(metadata.mtimeMs),
            ctimeMs: Number(metadata.ctimeMs),
            sizeBytes: Number(metadata.size),
            dev: Number(metadata.dev),
            ino: Number(metadata.ino),
        },
    );
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
 * Lê bytes completos de um arquivo.
 *
 * @param {string} filePath
 * @param {{ traceId?: string; advisoryLimits?: Record<string, unknown>; signal?: AbortSignal }} [options]
 */
export async function readBytes(filePath, options = {}) {
    assertValidIoFilePath(filePath);
    const traceId = options.traceId ?? createIoTraceId();
    const startedAt = nowIoMs();
    try {
        const _l1 = getIoL1Cache();
        const _normalizedPath = normalizeIoCacheKey(filePath);
        const _cacheKey = makeBytesKey(_normalizedPath);
        const _cached = await getVerifiedIoL1Entry(_cacheKey, filePath);
        if (_cached) {
            const content = /** @type {Buffer} */ (
                isBufferValue(_cached.content) ? _cached.content : toOwnedBuffer(String(_cached.content))
            );
            const contentHash = _cached.contentHash ?? sha256(content);
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
            return {
                path: filePath,
                content,
                bytesRead: content.byteLength,
                sizeBytes: Number.isFinite(_cached.size) ? Number(_cached.size) : content.byteLength,
                mtimeMs: Number.isFinite(_cached.mtime) ? Number(_cached.mtime) : null,
                contentHash,
                cacheFingerprintStrategy: _cached.fingerprintStrategy ?? null,
                io,
            };
        }
        const l2Cache = getIoL2Cache();
        if (l2Cache) {
            const l2Entry = l2Cache.get(_cacheKey);
            if (l2Entry?.kind === 'bytes' && isBufferValue(l2Entry.payload)) {
                const l2Meta = parseCacheMetaJson(l2Entry.metaJson);
                const contentHash = readCacheContentHash(l2Meta) ?? sha256(l2Entry.payload);
                const metadata = await statPathSnapshot(filePath).catch(() => null);

                if (l2EntryMatchesStat(l2Entry, l2Meta, metadata)) {
                    const fingerprintStrategy = hasRichCacheFingerprint(l2Meta)
                        ? 'l2-mtime-size-ctime-dev-ino'
                        : 'l2-mtime-size';
                    const _now = Date.now();
                    _l1.set(_cacheKey, {
                        content: l2Entry.payload,
                        bytes: l2Entry.payload.byteLength,
                        cachedAt: _now,
                        lastValidatedAt: _now,
                        accessCount: 1,
                        mtime: Number(metadata?.mtimeMs),
                        size: Number(metadata?.size),
                        ctime: Number(metadata?.ctimeMs),
                        dev: Number(metadata?.dev),
                        ino: Number(metadata?.ino),
                        contentHash,
                        fingerprintStrategy,
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
                        sizeBytes: Number(metadata?.size ?? l2Entry.sizeBytes),
                        mtimeMs: Number.isFinite(Number(metadata?.mtimeMs)) ? Number(metadata?.mtimeMs) : null,
                        contentHash,
                        cacheFingerprintStrategy: fingerprintStrategy,
                        io,
                    };
                }

                l2Cache.invalidatePath(filePath);
            }
        }
        const snapshot = await readBytesFileSnapshot(filePath, options.signal ? { signal: options.signal } : {});
        const content = snapshot.content;
        const contentHash = sha256(content);
        const _now = Date.now();
        /** @type {import('../../io-cache.js').IoCacheEntry} */
        const _entry = {
            content,
            bytes: content.byteLength,
            cachedAt: _now,
            lastValidatedAt: _now,
            accessCount: 1,
            mtime: snapshot.mtimeMs,
            size: snapshot.sizeBytes,
            ctime: snapshot.ctimeMs,
            dev: snapshot.dev,
            ino: snapshot.ino,
            contentHash,
            fingerprintStrategy: 'fs-read',
        };
        _l1.set(_cacheKey, _entry);
        if (l2Cache) {
            l2Cache.set({
                key: _cacheKey,
                path: filePath,
                kind: 'bytes',
                payload: content,
                sizeBytes: content.byteLength,
                mtimeMs: Number.isFinite(_entry.mtime) ? Number(_entry.mtime) : null,
                metaJson: stringifyCacheMeta({
                    contentHash,
                    ctimeMs: snapshot.ctimeMs,
                    dev: snapshot.dev,
                    ino: snapshot.ino,
                }),
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
        return {
            path: filePath,
            content,
            bytesRead: content.byteLength,
            sizeBytes: snapshot.sizeBytes,
            mtimeMs: snapshot.mtimeMs,
            contentHash,
            cacheFingerprintStrategy: 'fs-read',
            io,
        };
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
 *     signal?: AbortSignal;
 * }} [options]
 */
export async function readText(filePath, options = {}) {
    assertValidIoFilePath(filePath);
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
        /** @type {number} */
        let totalLines = 0;
        /** @type {number} */
        let sliceStart = 1;
        /** @type {number} */
        let sliceEnd = 1;
        /** @type {string} */
        let content = '';

        if (_cachedText !== null && typeof _cachedText.content === 'string') {
            _cacheState = 'l1-hit';
            const cachedContent = _cachedText.content;
            const contentHash = _cachedText.contentHash ?? sha256(cachedContent);
            const sliced = sliceTextByCachedLineOffsets(
                filePath,
                cachedContent,
                {
                    sizeBytes: Number.isFinite(_cachedText.size) ? Number(_cachedText.size) : _cachedText.bytes,
                    mtimeMs: Number.isFinite(_cachedText.mtime) ? Number(_cachedText.mtime) : null,
                },
                { startLine: options.startLine, endLine: options.endLine },
            );
            totalLines = sliced.totalLines;
            sliceStart = sliced.returnedLines.start;
            sliceEnd = sliced.returnedLines.end;
            content = sliced.content;
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
                sizeBytes: Number.isFinite(_cachedText.size) ? Number(_cachedText.size) : _cachedText.bytes,
                mtimeMs: Number.isFinite(_cachedText.mtime) ? Number(_cachedText.mtime) : null,
                contentHash,
                returnedContentHash: sha256(content),
                cacheFingerprintStrategy: _cachedText.fingerprintStrategy ?? null,
                totalLines,
                returnedLines: { start: sliceStart, end: sliceEnd },
                io,
            };
        }

        if (l2Cache) {
            const l2Entry = l2Cache.get(_textKey);
            if (l2Entry?.kind === 'text' && isBufferValue(l2Entry.payload)) {
                const l2Meta = parseCacheMetaJson(l2Entry.metaJson);
                const l2ContentHash = readCacheContentHash(l2Meta);
                const metadata = await statPathSnapshot(filePath).catch(() => null);

                if (l2EntryMatchesStat(l2Entry, l2Meta, metadata)) {
                    const fingerprintStrategy = hasRichCacheFingerprint(l2Meta)
                        ? 'l2-mtime-size-ctime-dev-ino'
                        : 'l2-mtime-size';
                    const text = l2Entry.payload.toString('utf8');
                    const contentHash = l2ContentHash ?? sha256(text);
                    const sliced = sliceTextByCachedLineOffsets(
                        filePath,
                        text,
                        {
                            sizeBytes: Number(metadata?.size ?? l2Entry.sizeBytes),
                            mtimeMs: Number.isFinite(Number(metadata?.mtimeMs)) ? Number(metadata?.mtimeMs) : null,
                        },
                        { startLine: options.startLine, endLine: options.endLine },
                    );
                    const totalLines = sliced.totalLines;
                    const sliceStart = sliced.returnedLines.start;
                    const sliceEnd = sliced.returnedLines.end;
                    const content = sliced.content;

                    const _now = Date.now();
                    _l1.set(_textKey, {
                        content: text,
                        bytes: l2Entry.payload.byteLength,
                        cachedAt: _now,
                        lastValidatedAt: _now,
                        accessCount: 1,
                        mtime: Number(metadata?.mtimeMs),
                        size: Number(metadata?.size),
                        ctime: Number(metadata?.ctimeMs),
                        dev: Number(metadata?.dev),
                        ino: Number(metadata?.ino),
                        contentHash,
                        fingerprintStrategy,
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
                        sizeBytes: Number(metadata?.size ?? l2Entry.sizeBytes),
                        mtimeMs: Number.isFinite(Number(metadata?.mtimeMs)) ? Number(metadata?.mtimeMs) : null,
                        contentHash,
                        returnedContentHash: sha256(content),
                        cacheFingerprintStrategy: fingerprintStrategy,
                        totalLines,
                        returnedLines: { start: sliceStart, end: sliceEnd },
                        io,
                    };
                }

                l2Cache.invalidatePath(filePath);
            }
        }

        const textSnapshot = await readBytesFileSnapshot(filePath, options.signal ? { signal: options.signal } : {});
        raw = textSnapshot.content;
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
        if (!bufferIsUtf8(raw)) {
            const error = new Error('Arquivo binário detectado (bytes inválidos para UTF-8).');
            publishAndReturn(buildIoMeta(baseMeta), false, error);
            failurePublished = true;
            throw error;
        }
        const text = raw.toString('utf8');
        const contentHash = sha256(text);
        const sliced = sliceTextByCachedLineOffsets(
            filePath,
            text,
            { sizeBytes: textSnapshot.sizeBytes, mtimeMs: textSnapshot.mtimeMs },
            { startLine: options.startLine, endLine: options.endLine },
        );
        totalLines = sliced.totalLines;
        sliceStart = sliced.returnedLines.start;
        sliceEnd = sliced.returnedLines.end;
        content = sliced.content;
        const _textNow = Date.now();
        /** @type {import('../../io-cache.js').IoCacheEntry} */
        const _textEntry = {
            content: text,
            bytes: raw.byteLength,
            cachedAt: _textNow,
            lastValidatedAt: _textNow,
            accessCount: 1,
            mtime: textSnapshot.mtimeMs,
            size: textSnapshot.sizeBytes,
            ctime: textSnapshot.ctimeMs,
            dev: textSnapshot.dev,
            ino: textSnapshot.ino,
            contentHash,
            fingerprintStrategy: 'fs-read',
        };
        _l1.set(_textKey, _textEntry);
        if (l2Cache) {
            l2Cache.set({
                key: _textKey,
                path: filePath,
                kind: 'text',
                payload: text,
                sizeBytes: raw.byteLength,
                mtimeMs: Number.isFinite(_textEntry.mtime) ? Number(_textEntry.mtime) : null,
                metaJson: stringifyCacheMeta({
                    contentHash,
                    lineCount: totalLines,
                    encoding: 'utf8',
                    ctimeMs: textSnapshot.ctimeMs,
                    dev: textSnapshot.dev,
                    ino: textSnapshot.ino,
                }),
            });
        }
        const io = publishAndReturn(buildIoMeta(baseMeta), true);
        return {
            path: filePath,
            content,
            bytesRead: raw.byteLength,
            sizeBytes: textSnapshot.sizeBytes,
            mtimeMs: textSnapshot.mtimeMs,
            contentHash,
            returnedContentHash: sha256(content),
            cacheFingerprintStrategy: 'fs-read',
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
    return { ...result, lines: splitPhysicalTextLines(result.content) };
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
 *     highWaterMark?: number;
 *     signal?: AbortSignal;
 *     advisoryLimits?: Record<string, unknown>;
 * }} [options]
 */
export async function readTextChunks(filePath, options = {}) {
    assertValidIoFilePath(filePath);
    const traceId = options.traceId ?? createIoTraceId();
    const startedAt = nowIoMs();
    try {
        const snapshot = await readTextLineChunks(filePath, options);
        const io = publishAndReturn(
            buildIoMeta({
                operation: 'read',
                target: filePath,
                targetKind: 'file',
                bytesRead: snapshot.bytesRead,
                durationMs: elapsedMs(startedAt),
                engine: snapshot.engine ?? 'io-engine.fs.createReadStream.textChunks',
                riskClass: 'low',
                traceId,
                advisoryLimits: {
                    ...(options.advisoryLimits ?? {}),
                    chunkLines: snapshot.chunkLines,
                    startLine: snapshot.startLine,
                    endLine: snapshot.endLine,
                    ...(options.highWaterMark !== undefined ? { highWaterMark: options.highWaterMark } : {}),
                    chunkCount: snapshot.chunks.length,
                    limitMode: 'informative',
                },
            }),
            true,
        );
        return {
            path: filePath,
            chunks: snapshot.chunks,
            totalLines: snapshot.totalLines,
            totalLinesKnown: snapshot.totalLinesKnown ?? snapshot.endLine === null,
            returnedLineCount: snapshot.returnedLineCount,
            returnedChunkCount: snapshot.chunks.length,
            lastScannedLine: snapshot.lastScannedLine,
            fileTotalLines: snapshot.totalLinesKnown ?? snapshot.endLine === null ? snapshot.totalLines : null,
            fileTotalLinesKnown: snapshot.totalLinesKnown ?? snapshot.endLine === null,
            bytesRead: snapshot.bytesRead,
            sizeBytes: snapshot.sizeBytes,
            mtimeMs: snapshot.mtimeMs,
            snapshotVersion: snapshot.snapshotVersion,
            snapshotAttempts: snapshot.attempts,
            consistent: snapshot.consistent,
            snapshotFingerprintStrategy: snapshot.snapshotFingerprintStrategy,
            cacheFingerprintStrategy: snapshot.cacheFingerprintStrategy ?? 'stream-bypass',
            io,
        };
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
 * Exponibiliza `readTextChunks` em forma de `ReadableStream` para consumidores que preferem streaming web nativo.
 *
 * @param {string} filePath
 * @param {{
 *     chunkLines?: number;
 *     startLine?: number;
 *     endLine?: number;
 *     traceId?: string;
 *     highWaterMark?: number;
 *     signal?: AbortSignal;
 *     advisoryLimits?: Record<string, unknown>;
 * }} [options]
 * @returns {ReadableStream<import('./read-chunks.js').TextLineChunk>}
 */
export function readTextChunksStream(filePath, options = {}) {
    return readTextLineChunksStream(filePath, options);
}

/**
 * Stat canônico com observabilidade. Leitura metadata-only, sem bloqueio por tamanho.
 *
 * @param {string} filePath
 * @param {{ traceId?: string; advisoryLimits?: Record<string, unknown> }} [options]
 */
export async function statPath(filePath, options = {}) {
    assertValidIoFilePath(filePath);
    const traceId = options.traceId ?? createIoTraceId();
    const startedAt = nowIoMs();
    try {
        const stats = await statPathSnapshot(filePath);
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
