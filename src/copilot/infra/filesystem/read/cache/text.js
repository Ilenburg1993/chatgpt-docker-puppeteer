// @ts-check
/** Cached L1/L2 UTF-8 text read service and line projection. */

import { makeTextKey, normalizeIoCacheKey } from '#copilot/infra/internal/cache/keys';
import { buildIoMeta, createIoTraceId } from '#copilot/infra/internal/operations/contracts';
import { bufferIsUtf8, isBufferValue } from '#copilot/infra/internal/platform/buffer';
import { slicePhysicalTextLines, splitPhysicalTextLines } from '#copilot/infra/internal/platform/text-lines';
import { assertValidIoFilePath } from '#copilot/infra/internal/policy';
import {
    elapsedIoMs,
    getIoTelemetryRuntimeOption,
    nowIoMs,
    publishIoOperationResult,
} from '#copilot/infra/internal/telemetry';
import { readBytesFileSnapshot, statPathSnapshot } from '../snapshot/index.js';
import {
    hasRichCacheFingerprint,
    l2EntryMatchesStat,
    parseCacheMetaJson,
    readCacheContentHash,
    stringifyCacheMeta,
} from './entry.js';
import { normalizeTextHashMode, resolveTextHashes } from './hash-policy.js';

/** @typedef {import('./hash-policy.js').TextHashMode} TextHashMode */

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
 *     cacheRuntime?: {l1:ReturnType<typeof import('#copilot/infra/internal/cache/memory/runtime').createIoL1CacheRuntime>;l2:{get:()=>ReturnType<typeof import('#copilot/infra/internal/cache/l2').createIoL2SqliteCache>|null}};
 *     readRuntime?: {hashes:ReturnType<typeof import('./hash-runtime.js').createIoReadHashRuntime>;lineOffsets:ReturnType<typeof import('./line-offset-runtime.js').createLineOffsetCacheRuntime>};
 * }} [options]
 */
export async function readText(filePath, options = {}) {
    assertValidIoFilePath(filePath);
    const traceId = options.traceId ?? createIoTraceId();
    const hashMode = normalizeTextHashMode(options.hashMode);
    const startedAt = nowIoMs();
    let failurePublished = false;
    try {
        const _l1 = options.cacheRuntime?.l1 ?? null;
        const l2Cache = options.cacheRuntime?.l2.get() ?? null;
        const hashRuntime = options.readRuntime?.hashes ?? null;
        const lineOffsetRuntime = options.readRuntime?.lineOffsets ?? null;
        const _normalizedPath = normalizeIoCacheKey(filePath);
        const _textKey = makeTextKey(_normalizedPath, undefined, undefined);
        const _cachedText = _l1 ? await _l1.getVerified(_textKey, filePath) : null;
        /** @type {'l1-hit' | 'l1-miss' | 'bypass'} */
        let _cacheState = _l1 ? 'l1-miss' : 'bypass';
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
            const sliced = lineOffsetRuntime
                ? lineOffsetRuntime.slice(
                      filePath,
                      cachedContent,
                      {
                          sizeBytes: Number.isFinite(_cachedText.size) ? Number(_cachedText.size) : _cachedText.bytes,
                          mtimeMs: Number.isFinite(_cachedText.mtime) ? Number(_cachedText.mtime) : null,
                      },
                      { startLine: options.startLine, endLine: options.endLine },
                  )
                : {
                      ...slicePhysicalTextLines(cachedContent, {
                          startLine: options.startLine,
                          endLine: options.endLine,
                      }),
                      cache: /** @type {const} */ ('line-offset-bypass'),
                  };
            totalLines = sliced.totalLines;
            sliceStart = sliced.returnedLines.start;
            sliceEnd = sliced.returnedLines.end;
            content = sliced.content;
            const hashes = hashRuntime
                ? hashRuntime.resolve(
                      cachedContent,
                      content,
                      sliceStart === 1 && sliceEnd === totalLines,
                      hashMode,
                      _cachedText.contentHash,
                  )
                : resolveTextHashes(
                      cachedContent,
                      content,
                      sliceStart === 1 && sliceEnd === totalLines,
                      hashMode,
                      _cachedText.contentHash,
                  );
            if (!_cachedText.contentHash && hashes.reusableFullHash) _cachedText.contentHash = hashes.reusableFullHash;
            const io = publishIoOperationResult(
                buildIoMeta({
                    operation: 'read',
                    target: filePath,
                    targetKind: 'file',
                    bytesRead: _cachedText.bytes,
                    durationMs: elapsedIoMs(startedAt),
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
                undefined,
                getIoTelemetryRuntimeOption(options),
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
                    const sliced = lineOffsetRuntime
                        ? lineOffsetRuntime.slice(
                              filePath,
                              text,
                              {
                                  sizeBytes: Number(metadata?.size ?? l2Entry.sizeBytes),
                                  mtimeMs: Number.isFinite(Number(metadata?.mtimeMs))
                                      ? Number(metadata?.mtimeMs)
                                      : null,
                              },
                              { startLine: options.startLine, endLine: options.endLine },
                          )
                        : {
                              ...slicePhysicalTextLines(text, {
                                  startLine: options.startLine,
                                  endLine: options.endLine,
                              }),
                              cache: /** @type {const} */ ('line-offset-bypass'),
                          };
                    const totalLines = sliced.totalLines;
                    const sliceStart = sliced.returnedLines.start;
                    const sliceEnd = sliced.returnedLines.end;
                    const content = sliced.content;
                    const hashes = hashRuntime
                        ? hashRuntime.resolve(
                              text,
                              content,
                              sliceStart === 1 && sliceEnd === totalLines,
                              hashMode,
                              l2ContentHash,
                          )
                        : resolveTextHashes(
                              text,
                              content,
                              sliceStart === 1 && sliceEnd === totalLines,
                              hashMode,
                              l2ContentHash,
                          );

                    const _now = Date.now();
                    _l1?.set(_textKey, {
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

                    const io = publishIoOperationResult(
                        buildIoMeta({
                            operation: 'read',
                            target: filePath,
                            targetKind: 'file',
                            bytesRead: l2Entry.payload.byteLength,
                            durationMs: elapsedIoMs(startedAt),
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
                        undefined,
                        getIoTelemetryRuntimeOption(options),
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
            durationMs: elapsedIoMs(startedAt),
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
            publishIoOperationResult(buildIoMeta(baseMeta), false, error, getIoTelemetryRuntimeOption(options));
            failurePublished = true;
            throw error;
        }
        const text = raw.toString('utf8');
        const sliced = lineOffsetRuntime
            ? lineOffsetRuntime.slice(
                  filePath,
                  text,
                  { sizeBytes: textSnapshot.sizeBytes, mtimeMs: textSnapshot.mtimeMs },
                  { startLine: options.startLine, endLine: options.endLine },
              )
            : {
                  ...slicePhysicalTextLines(text, { startLine: options.startLine, endLine: options.endLine }),
                  cache: /** @type {const} */ ('line-offset-bypass'),
              };
        totalLines = sliced.totalLines;
        sliceStart = sliced.returnedLines.start;
        sliceEnd = sliced.returnedLines.end;
        content = sliced.content;
        const hashes = hashRuntime
            ? hashRuntime.resolve(text, content, sliceStart === 1 && sliceEnd === totalLines, hashMode, undefined)
            : resolveTextHashes(text, content, sliceStart === 1 && sliceEnd === totalLines, hashMode, undefined);
        const _textNow = Date.now();
        /** @type {import('#copilot/infra/internal/cache/memory').IoCacheEntry} */
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
        _l1?.set(_textKey, _textEntry);
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
        const io = publishIoOperationResult(
            buildIoMeta(baseMeta),
            true,
            undefined,
            getIoTelemetryRuntimeOption(options),
        );
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
            publishIoOperationResult(
                buildIoMeta({
                    operation: 'read',
                    target: filePath,
                    targetKind: 'file',
                    durationMs: elapsedIoMs(startedAt),
                    engine: 'io-engine.fs.readFile.text',
                    riskClass: 'low',
                    traceId,
                }),
                false,
                error,
                getIoTelemetryRuntimeOption(options),
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
