// @ts-check
/** Observable chunked/streaming text read adapters. */

import { buildIoMeta, createIoTraceId } from '#copilot/infra/internal/operations/contracts';
import { assertValidIoFilePath } from '#copilot/infra/internal/policy';
import {
    elapsedIoMs,
    getIoTelemetryRuntimeOption,
    nowIoMs,
    publishIoOperationResult,
} from '#copilot/infra/internal/telemetry';
import { readTextLineChunks, readTextLineChunksStream } from './lines.js';

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
 *     readRuntime?: NonNullable<NonNullable<Parameters<typeof readTextLineChunks>[1]>['readRuntime']>;
 * }} [options]
 */
export async function readTextChunks(filePath, options = {}) {
    assertValidIoFilePath(filePath);
    const traceId = options.traceId ?? createIoTraceId();
    const startedAt = nowIoMs();
    try {
        const snapshot = await readTextLineChunks(filePath, options);
        const io = publishIoOperationResult(
            buildIoMeta({
                operation: 'read',
                target: filePath,
                targetKind: 'file',
                bytesRead: snapshot.bytesRead,
                durationMs: elapsedIoMs(startedAt),
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
            undefined,
            getIoTelemetryRuntimeOption(options),
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
        publishIoOperationResult(
            buildIoMeta({
                operation: 'read',
                target: filePath,
                targetKind: 'file',
                durationMs: elapsedIoMs(startedAt),
                engine: 'io-engine.fs.createReadStream.textChunks',
                riskClass: 'low',
                traceId,
            }),
            false,
            error,
            getIoTelemetryRuntimeOption(options),
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
 *     readRuntime?: NonNullable<NonNullable<Parameters<typeof readTextLineChunksStream>[1]>['readRuntime']>;
 * }} [options]
 * @returns {ReadableStream<import('./types.js').TextLineChunk>}
 */
export function readTextChunksStream(filePath, options = {}) {
    return readTextLineChunksStream(filePath, options);
}
