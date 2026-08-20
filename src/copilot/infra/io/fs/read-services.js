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
import { bufferIsUtf8, decodeUtf8Buffer, isBufferValue, toOwnedBuffer } from '../../shared/buffer.js';
import { fingerprintMatches, richFingerprintMatches } from '../../shared/fingerprint-match.js';
import { sha256 } from '../../shared/hash.js';
import { splitPhysicalTextLines } from '../../shared/text-lines.js';
import { sliceTextByCachedLineOffsets } from './line-offset-cache.js';
import { readBytesFileRangeSnapshot, readBytesFileSnapshot } from './read-bytes.js';
import { readTextLineChunks, readTextLineChunksStream } from './read-chunks.js';
import { readDirectoryNamesSnapshot } from './read-directory.js';
import { lstatPathSnapshot, statPathSnapshot } from './stat.js';

/** @typedef {'full' | 'returned' | 'none'} TextHashMode */

const textHashStats = {
    reads: 0,
    hashComputations: 0,
    fullHashComputations: 0,
    returnedSliceHashComputations: 0,
    knownFullHashReuses: 0,
    fullWindowReturnedHashReuses: 0,
    fullHashOutputSkips: 0,
    returnedHashOutputSkips: 0,
};

/** Métricas de hashing textual, separadas de cache/I/O para tornar custo criptográfico observável. */
export function getIoReadHashStats() {
    return { ...textHashStats };
}

/** Test-only reset. */
export function resetIoReadHashStatsForTest() {
    for (const key of Object.keys(textHashStats)) {
        textHashStats[/** @type {keyof typeof textHashStats} */ (key)] = 0;
    }
}

/** @param {unknown} value @returns {TextHashMode} */
function normalizeTextHashMode(value) {
    return value === 'returned' || value === 'none' ? value : 'full';
}

/**
 * Calcula somente digests exigidos pelo caller. Em janela integral, o SHA-256 retornado e o integral são o mesmo
 * digest; portanto um único cálculo alimenta ambos e também pode enriquecer o cache para chamadas futuras.
 *
 * @param {string} fullText
 * @param {string} returnedText
 * @param {boolean} fullWindow
 * @param {TextHashMode} hashMode
 * @param {string | undefined} knownFullHash
 */
function resolveTextHashes(fullText, returnedText, fullWindow, hashMode, knownFullHash) {
    textHashStats.reads += 1;
    let reusableFullHash = knownFullHash;
    let contentHash = /** @type {string | undefined} */ (undefined);
    let returnedContentHash = /** @type {string | undefined} */ (undefined);

    const ensureFullHash = () => {
        if (reusableFullHash) {
            textHashStats.knownFullHashReuses += 1;
            return reusableFullHash;
        }
        reusableFullHash = sha256(fullText);
        textHashStats.hashComputations += 1;
        textHashStats.fullHashComputations += 1;
        return reusableFullHash;
    };

    if (hashMode === 'full') {
        contentHash = ensureFullHash();
        if (fullWindow) {
            returnedContentHash = contentHash;
            textHashStats.fullWindowReturnedHashReuses += 1;
        } else {
            returnedContentHash = sha256(returnedText);
            textHashStats.hashComputations += 1;
            textHashStats.returnedSliceHashComputations += 1;
        }
    } else if (hashMode === 'returned') {
        textHashStats.fullHashOutputSkips += 1;
        if (fullWindow) {
            returnedContentHash = ensureFullHash();
            textHashStats.fullWindowReturnedHashReuses += 1;
        } else {
            returnedContentHash = sha256(returnedText);
            textHashStats.hashComputations += 1;
            textHashStats.returnedSliceHashComputations += 1;
        }
    } else {
        textHashStats.fullHashOutputSkips += 1;
        textHashStats.returnedHashOutputSkips += 1;
    }

    return { contentHash, returnedContentHash, reusableFullHash };
}

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
    return ['ctimeMs', 'dev', 'ino'].every((key) => typeof meta[key] === 'number' && Number.isFinite(meta[key]));
}

/**
 * @param {{ mtimeMs?: number | null; sizeBytes: number }} l2Entry
 * @param {Record<string, unknown>} l2Meta
 * @param {{
 *     mtimeMs?: number;
 *     ctimeMs?: number;
 *     size?: number;
 *     dev?: number | bigint;
 *     ino?: number | bigint;
 * } | null} metadata
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
 * Lê bytes diretamente de um snapshot consistente, sem consultar nem preencher L1/L2. Use para state/secrets/PID/TLS e
 * outros arquivos cujo contrato exige refletir o disco no instante da chamada.
 *
 * @param {string} filePath
 * @param {{
 *     traceId?: string;
 *     advisoryLimits?: Record<string, unknown>;
 *     signal?: AbortSignal;
 *     includeHash?: boolean;
 * }} [options]
 */
export async function readBytesFresh(filePath, options = {}) {
    assertValidIoFilePath(filePath);
    const traceId = options.traceId ?? createIoTraceId();
    const startedAt = nowIoMs();
    try {
        const snapshot = await readBytesFileSnapshot(filePath, options.signal ? { signal: options.signal } : {});
        const contentHash = options.includeHash === true ? sha256(snapshot.content) : undefined;
        const io = publishAndReturn(
            buildIoMeta({
                operation: 'read',
                target: filePath,
                targetKind: 'file',
                bytesRead: snapshot.bytesRead,
                durationMs: elapsedMs(startedAt),
                engine: 'io-engine.fs.readFile.bytes-fresh',
                riskClass: 'low',
                traceId,
                cache: 'none',
                advisoryLimits: { ...(options.advisoryLimits ?? {}), freshness: 'physical-snapshot' },
            }),
            true,
        );
        return {
            path: filePath,
            content: snapshot.content,
            bytesRead: snapshot.bytesRead,
            sizeBytes: snapshot.sizeBytes,
            mtimeMs: snapshot.mtimeMs,
            ctimeMs: snapshot.ctimeMs,
            dev: snapshot.dev,
            ino: snapshot.ino,
            mode: snapshot.mode,
            isFile: snapshot.isFile,
            attempts: snapshot.attempts,
            ...(contentHash === undefined ? {} : { contentHash }),
            cacheFingerprintStrategy: 'fresh-snapshot',
            io,
        };
    } catch (error) {
        publishAndReturn(
            buildIoMeta({
                operation: 'read',
                target: filePath,
                targetKind: 'file',
                durationMs: elapsedMs(startedAt),
                engine: 'io-engine.fs.readFile.bytes-fresh',
                riskClass: 'low',
                traceId,
                cache: 'none',
            }),
            false,
            error,
        );
        throw error;
    }
}

/**
 * Bounded fresh byte-range/tail read with the same physical-snapshot consistency guarantees used by full fresh reads.
 *
 * @param {string} filePath
 * @param {{
 *     start?: number;
 *     maxBytes: number;
 *     fromEnd?: boolean;
 *     rejectSymlink?: boolean;
 *     traceId?: string;
 *     advisoryLimits?: Record<string, unknown>;
 *     signal?: AbortSignal;
 * }} options
 */
export async function readBytesRangeFresh(filePath, options) {
    assertValidIoFilePath(filePath);
    const traceId = options.traceId ?? createIoTraceId();
    const startedAt = nowIoMs();
    try {
        const snapshot = await readBytesFileRangeSnapshot(filePath, options);
        const io = publishAndReturn(
            buildIoMeta({
                operation: 'read',
                target: filePath,
                targetKind: 'file',
                bytesRead: snapshot.bytesRead,
                durationMs: elapsedMs(startedAt),
                engine:
                    options.fromEnd === true ? 'io-engine.fs.read.range-tail-fresh' : 'io-engine.fs.read.range-fresh',
                riskClass: 'low',
                traceId,
                cache: 'none',
                advisoryLimits: {
                    ...(options.advisoryLimits ?? {}),
                    freshness: 'physical-range-snapshot',
                    startByte: snapshot.startByte,
                    maxBytes: options.maxBytes,
                    fromEnd: options.fromEnd === true,
                    rejectSymlink: options.rejectSymlink === true,
                },
            }),
            true,
        );
        return { ...snapshot, io };
    } catch (error) {
        publishAndReturn(
            buildIoMeta({
                operation: 'read',
                target: filePath,
                targetKind: 'file',
                durationMs: elapsedMs(startedAt),
                engine:
                    options.fromEnd === true ? 'io-engine.fs.read.range-tail-fresh' : 'io-engine.fs.read.range-fresh',
                riskClass: 'low',
                traceId,
                cache: 'none',
            }),
            false,
            error,
        );
        throw error;
    }
}

/**
 * Lê UTF-8 diretamente do disco por snapshot consistente, sem cache. Hash é opt-in porque state/config normalmente
 * precisa de freshness física, não de identidade criptográfica.
 *
 * @param {string} filePath
 * @param {{
 *     traceId?: string;
 *     advisoryLimits?: Record<string, unknown>;
 *     signal?: AbortSignal;
 *     includeHash?: boolean;
 * }} [options]
 */
export async function readTextFresh(filePath, options = {}) {
    const result = await readBytesFresh(filePath, options);
    const content = decodeUtf8Buffer(result.content, `Arquivo contém bytes inválidos para UTF-8: ${filePath}`);
    return {
        ...result,
        content,
    };
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
 *     hashMode?: TextHashMode;
 * }} [options]
 */
export async function readText(filePath, options = {}) {
    assertValidIoFilePath(filePath);
    const traceId = options.traceId ?? createIoTraceId();
    const hashMode = normalizeTextHashMode(options.hashMode);
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
            const hashes = resolveTextHashes(
                cachedContent,
                content,
                sliceStart === 1 && sliceEnd === totalLines,
                hashMode,
                _cachedText.contentHash,
            );
            if (!_cachedText.contentHash && hashes.reusableFullHash) _cachedText.contentHash = hashes.reusableFullHash;
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
                ctimeMs: Number.isFinite(_cachedText.ctime) ? Number(_cachedText.ctime) : null,
                dev: Number.isFinite(_cachedText.dev) ? Number(_cachedText.dev) : null,
                ino: Number.isFinite(_cachedText.ino) ? Number(_cachedText.ino) : null,
                contentHash: hashes.contentHash,
                returnedContentHash: hashes.returnedContentHash,
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
                    const hashes = resolveTextHashes(
                        text,
                        content,
                        sliceStart === 1 && sliceEnd === totalLines,
                        hashMode,
                        l2ContentHash,
                    );

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
                        ...(hashes.reusableFullHash ? { contentHash: hashes.reusableFullHash } : {}),
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
                        ctimeMs: Number.isFinite(Number(metadata?.ctimeMs)) ? Number(metadata?.ctimeMs) : null,
                        dev: Number.isFinite(Number(metadata?.dev)) ? Number(metadata?.dev) : null,
                        ino: Number.isFinite(Number(metadata?.ino)) ? Number(metadata?.ino) : null,
                        contentHash: hashes.contentHash,
                        returnedContentHash: hashes.returnedContentHash,
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
        const hashes = resolveTextHashes(
            text,
            content,
            sliceStart === 1 && sliceEnd === totalLines,
            hashMode,
            undefined,
        );
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
            ...(hashes.reusableFullHash ? { contentHash: hashes.reusableFullHash } : {}),
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
                    ...(hashes.reusableFullHash ? { contentHash: hashes.reusableFullHash } : {}),
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
            ctimeMs: textSnapshot.ctimeMs,
            dev: textSnapshot.dev,
            ino: textSnapshot.ino,
            contentHash: hashes.contentHash,
            returnedContentHash: hashes.returnedContentHash,
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
            stoppedAtRequestedWindow: snapshot.stoppedAtRequestedWindow,
            fileTotalLines: (snapshot.totalLinesKnown ?? snapshot.endLine === null) ? snapshot.totalLines : null,
            fileTotalLinesKnown: snapshot.totalLinesKnown ?? snapshot.endLine === null,
            bytesRead: snapshot.bytesRead,
            ...('indexBytesRead' in snapshot ? { indexBytesRead: snapshot.indexBytesRead } : {}),
            ...('rangeBytesRead' in snapshot ? { rangeBytesRead: snapshot.rangeBytesRead } : {}),
            ...('indexCacheState' in snapshot ? { indexCacheState: snapshot.indexCacheState } : {}),
            ...('rangeSource' in snapshot ? { rangeSource: snapshot.rangeSource } : {}),
            sizeBytes: snapshot.sizeBytes,
            mtimeMs: snapshot.mtimeMs,
            ctimeMs: snapshot.ctimeMs,
            dev: snapshot.dev,
            ino: snapshot.ino,
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
 * Listagem física de diretório, sem L1/L2 e sem pre-access. Ausência permanece ENOENT para o caller decidir se é estado
 * opcional ou erro operacional.
 *
 * @param {string} dirPath
 * @param {{ traceId?: string; advisoryLimits?: Record<string, unknown> }} [options]
 */
export async function listDirectoryNamesFresh(dirPath, options = {}) {
    assertValidIoFilePath(dirPath);
    const traceId = options.traceId ?? createIoTraceId();
    const startedAt = nowIoMs();
    try {
        const entries = await readDirectoryNamesSnapshot(dirPath);
        const io = publishAndReturn(
            buildIoMeta({
                operation: 'scan',
                target: dirPath,
                targetKind: 'directory',
                durationMs: elapsedMs(startedAt),
                engine: 'io-engine.fs.readdir.names-fresh',
                riskClass: 'low',
                traceId,
                cache: 'none',
                advisoryLimits: {
                    ...(options.advisoryLimits ?? {}),
                    freshness: 'physical-directory-listing',
                    entryCount: entries.length,
                },
            }),
            true,
        );
        return { path: dirPath, entries, io };
    } catch (error) {
        publishAndReturn(
            buildIoMeta({
                operation: 'scan',
                target: dirPath,
                targetKind: 'directory',
                durationMs: elapsedMs(startedAt),
                engine: 'io-engine.fs.readdir.names-fresh',
                riskClass: 'low',
                traceId,
                cache: 'none',
            }),
            false,
            error,
        );
        throw error;
    }
}

/**
 * lstat canônico com observabilidade. Não segue symlinks e, por isso, é a primitive apropriada para state/config que
 * precisa rejeitar links antes de qualquer leitura de conteúdo.
 *
 * @param {string} filePath
 * @param {{ traceId?: string; advisoryLimits?: Record<string, unknown> }} [options]
 */
export async function lstatPath(filePath, options = {}) {
    assertValidIoFilePath(filePath);
    const traceId = options.traceId ?? createIoTraceId();
    const startedAt = nowIoMs();
    try {
        const stats = await lstatPathSnapshot(filePath);
        const io = publishAndReturn(
            buildIoMeta({
                operation: 'stat',
                target: filePath,
                targetKind: stats.isDirectory() ? 'directory' : 'file',
                durationMs: elapsedMs(startedAt),
                engine: 'io-engine.fs.lstat',
                riskClass: 'low',
                traceId,
                cache: 'none',
                advisoryLimits: { ...(options.advisoryLimits ?? {}), followSymlinks: false },
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
                engine: 'io-engine.fs.lstat',
                riskClass: 'low',
                traceId,
                cache: 'none',
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
