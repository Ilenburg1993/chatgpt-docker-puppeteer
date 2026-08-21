// @ts-check
/** Cached L1/L2 byte read service. */

import { buildIoMeta, createIoTraceId } from '#copilot/core';
import {
    getIoL1Cache,
    getIoL2Cache,
    getVerifiedIoL1Entry,
    makeBytesKey,
    normalizeIoCacheKey,
} from '#copilot/infra/internal/cache';
import { isBufferValue, sha256, toOwnedBuffer } from '#copilot/infra/internal/platform';
import { assertValidIoFilePath } from '#copilot/infra/internal/policy';
import { elapsedIoMs, nowIoMs, publishIoOperationResult } from '#copilot/infra/internal/telemetry';
import { readBytesFileSnapshot, statPathSnapshot } from '../snapshot/index.js';
import {
    hasRichCacheFingerprint,
    l2EntryMatchesStat,
    parseCacheMetaJson,
    readCacheContentHash,
    stringifyCacheMeta,
} from './entry.js';

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
            const io = publishIoOperationResult(
                buildIoMeta({
                    operation: 'read',
                    target: filePath,
                    targetKind: 'file',
                    bytesRead: content.byteLength,
                    durationMs: elapsedIoMs(startedAt),
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
                    const io = publishIoOperationResult(
                        buildIoMeta({
                            operation: 'read',
                            target: filePath,
                            targetKind: 'file',
                            bytesRead: l2Entry.payload.byteLength,
                            durationMs: elapsedIoMs(startedAt),
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
        /** @type {import('#copilot/infra/internal/cache').IoCacheEntry} */
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
        const io = publishIoOperationResult(
            buildIoMeta({
                operation: 'read',
                target: filePath,
                targetKind: 'file',
                bytesRead: content.byteLength,
                durationMs: elapsedIoMs(startedAt),
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
        publishIoOperationResult(
            buildIoMeta({
                operation: 'read',
                target: filePath,
                targetKind: 'file',
                durationMs: elapsedIoMs(startedAt),
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
