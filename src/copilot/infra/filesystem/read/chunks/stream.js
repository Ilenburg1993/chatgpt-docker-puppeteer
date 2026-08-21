// @ts-check
/** Consistent one-pass physical stream iterator with opportunistic byte-line seed capture. */

import { toBufferView, utf8ByteLength } from '#copilot/infra/internal/platform';
import { open, stat } from 'node:fs/promises';
import { addAbortSignal } from 'node:stream';
import { appendPhysicalLineStartsFromBuffer, resolveByteLineSeedStreamHighWaterMark } from '../line-index/index.js';
import {
    buildSnapshotVersion,
    createStaleChunkSnapshotError,
    fingerprintFromStats,
    sameFileSnapshot,
} from '../snapshot/index.js';
import { decodeUtf8Chunk } from './codec.js';

/** @typedef {import('./types.js').TextLineChunk} TextLineChunk */

/**
 * @param {string} filePath
 * @param {{
 *     chunkLines?: number;
 *     startLine?: number;
 *     endLine?: number;
 *     highWaterMark?: number;
 *     signal?: AbortSignal;
 *     attempt?: number;
 *     deliveryMode?: 'materialized' | 'stream';
 *     onPhase?: (phase: string, details: Record<string, unknown>) => void | Promise<void>;
 *     readRuntime?: {byteLineIndex:{enabled:boolean}};
 * }} [options]
 * @param {{
 *     totalLines: number;
 *     bytesRead: number;
 *     stoppedAtRequestedWindow: boolean;
 *     chunksEmitted: number;
 *     snapshotVersion: string | null;
 *     sizeBytes: number | null;
 *     mtimeMs: number | null;
 *     ctimeMs: number | null;
 *     dev: number | null;
 *     ino: number | null;
 *     byteLineStarts?: number[];
 *     byteLinePendingCrOffset?: number | null;
 *     byteLineScannedBytes?: number;
 * }} [state]
 * @returns {AsyncGenerator<TextLineChunk, void, void>}
 */
export async function* iterateTextLineChunks(
    filePath,
    options = {},
    state = {
        totalLines: 0,
        bytesRead: 0,
        stoppedAtRequestedWindow: false,
        chunksEmitted: 0,
        snapshotVersion: null,
        sizeBytes: null,
        mtimeMs: null,
        ctimeMs: null,
        dev: null,
        ino: null,
    },
) {
    const chunkLines =
        Number.isFinite(options.chunkLines) && Number(options.chunkLines) > 0
            ? Math.floor(Number(options.chunkLines))
            : 200;
    const startLine = Math.max(1, options.startLine ?? 1);
    const endLine = Number.isFinite(options.endLine)
        ? Math.max(startLine, Number(options.endLine))
        : Number.POSITIVE_INFINITY;
    const boundedMaterializedFirstPage =
        options.deliveryMode === 'materialized' && startLine === 1 && Number.isFinite(options.endLine);
    const highWaterMark =
        Number.isFinite(options.highWaterMark) && Number(options.highWaterMark) > 0
            ? Math.floor(Number(options.highWaterMark))
            : boundedMaterializedFirstPage
              ? resolveByteLineSeedStreamHighWaterMark(endLine)
              : undefined;
    /** @type {string[]} */
    let current = [];
    let currentStartLine = startLine;
    let carry = '';
    let chunkIndex = 0;
    const decoder = new TextDecoder('utf-8', { fatal: true });
    options.signal?.throwIfAborted();
    const handle = await open(filePath, 'r');
    const before = await handle.stat();
    const snapshotVersion = buildSnapshotVersion(fingerprintFromStats(before));
    state.snapshotVersion = snapshotVersion;
    state.sizeBytes = before.size;
    state.mtimeMs = before.mtimeMs;
    state.ctimeMs = before.ctimeMs;
    state.dev = Number(before.dev);
    state.ino = Number(before.ino);
    const seedByteLineIndex =
        options.deliveryMode === 'materialized' &&
        startLine === 1 &&
        Number.isFinite(options.endLine) &&
        options.readRuntime?.byteLineIndex.enabled === true;
    if (seedByteLineIndex) {
        state.byteLineStarts = [0];
        state.byteLinePendingCrOffset = null;
        state.byteLineScannedBytes = 0;
    }
    const baseStream = handle.createReadStream({
        autoClose: false,
        ...(highWaterMark !== undefined ? { highWaterMark } : {}),
    });
    const stream = options.signal ? addAbortSignal(options.signal, baseStream) : baseStream;

    /**
     * @param {string} content
     * @returns {TextLineChunk}
     */
    function emitChunk(content) {
        const chunk = {
            index: chunkIndex,
            startLine: currentStartLine,
            endLine: currentStartLine + current.length - 1,
            content,
            bytes: utf8ByteLength(content, 'read chunk'),
            ...(options.deliveryMode === 'stream' ? { snapshotVersion } : {}),
        };
        chunkIndex += 1;
        state.chunksEmitted += 1;
        current = [];
        return chunk;
    }

    /**
     * @param {string} line
     * @returns {TextLineChunk | null}
     */
    function pushLine(line) {
        state.totalLines += 1;
        if (state.totalLines < startLine) return null;
        if (state.totalLines > endLine) {
            state.stoppedAtRequestedWindow = true;
            return null;
        }
        if (current.length === 0) currentStartLine = state.totalLines;
        current.push(line);
        if (current.length >= chunkLines) {
            return emitChunk(current.join('\n'));
        }
        return null;
    }

    /**
     * @param {string} decoded
     * @param {boolean} final
     * @returns {TextLineChunk[]}
     */
    function processDecoded(decoded, final) {
        /** @type {TextLineChunk[]} */
        const emitted = [];
        let data = carry + decoded;
        carry = '';
        let trailingCr = '';
        if (!final && data.endsWith('\r')) {
            trailingCr = '\r';
            data = data.slice(0, -1);
        }
        if (data === '') {
            carry = trailingCr;
            return emitted;
        }

        const parts = data.split(/\r\n|\n|\r/);
        if (!final) {
            carry = `${parts.pop() ?? ''}${trailingCr}`;
        } else if (/\r\n|\n|\r/.test(data.slice(-2))) {
            while (parts.length > 0 && parts[parts.length - 1] === '') parts.pop();
        }

        for (const line of parts) {
            const chunk = pushLine(line);
            if (chunk) emitted.push(chunk);
            if (state.stoppedAtRequestedWindow) break;
        }
        return emitted;
    }

    try {
        for await (const chunk of stream) {
            const buf = toBufferView(/** @type {Buffer | Uint8Array} */ (chunk));
            if (seedByteLineIndex && state.byteLineStarts) {
                const chunkFileStart = Number(state.byteLineScannedBytes ?? 0);
                state.byteLinePendingCrOffset = appendPhysicalLineStartsFromBuffer(
                    buf,
                    chunkFileStart,
                    state.byteLineStarts,
                    state.byteLinePendingCrOffset ?? null,
                );
                state.byteLineScannedBytes = chunkFileStart + buf.byteLength;
            }
            state.bytesRead += buf.byteLength;
            if (options.onPhase) {
                await options.onPhase('after-stream-chunk', {
                    filePath,
                    attempt: options.attempt ?? 1,
                    bytesRead: state.bytesRead,
                    chunkBytes: buf.byteLength,
                    snapshotVersion,
                });
            }
            for (const emitted of processDecoded(decodeUtf8Chunk(decoder, buf), false)) {
                yield emitted;
            }
            if (state.stoppedAtRequestedWindow) break;
        }
        if (!state.stoppedAtRequestedWindow) {
            for (const emitted of processDecoded(decodeUtf8Chunk(decoder, undefined, true), true)) {
                yield emitted;
            }
        }
        const after = await handle.stat();
        const pathAfter = await stat(filePath);
        if (!sameFileSnapshot(before, after) || !sameFileSnapshot(after, pathAfter)) {
            throw createStaleChunkSnapshotError(filePath, options.attempt ?? 1, {
                partial: options.deliveryMode === 'stream' && state.chunksEmitted > 0,
                snapshotVersion,
            });
        }
    } finally {
        if (!stream.destroyed) stream.destroy();
        await handle.close().catch(() => undefined);
    }

    if (current.length > 0) {
        yield emitChunk(current.join('\n'));
    }
}
