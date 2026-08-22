// @ts-check
/** Physical snapshot reads that intentionally bypass L1/L2 caches. */

import { buildIoMeta, createIoTraceId } from '#copilot/core/io-contracts';
import { decodeUtf8Buffer, sha256 } from '#copilot/infra/internal/platform';
import { assertValidIoFilePath } from '#copilot/infra/internal/policy';
import {
    elapsedIoMs,
    getIoTelemetryRuntimeOption,
    nowIoMs,
    publishIoOperationResult,
} from '#copilot/infra/internal/telemetry';
import { readBytesFileRangeSnapshot, readBytesFileSnapshot } from '../snapshot/index.js';

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
        const io = publishIoOperationResult(
            buildIoMeta({
                operation: 'read',
                target: filePath,
                targetKind: 'file',
                bytesRead: snapshot.bytesRead,
                durationMs: elapsedIoMs(startedAt),
                engine: 'io-engine.fs.readFile.bytes-fresh',
                riskClass: 'low',
                traceId,
                cache: 'none',
                advisoryLimits: { ...(options.advisoryLimits ?? {}), freshness: 'physical-snapshot' },
            }),
            true,
            undefined,
            getIoTelemetryRuntimeOption(options),
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
        publishIoOperationResult(
            buildIoMeta({
                operation: 'read',
                target: filePath,
                targetKind: 'file',
                durationMs: elapsedIoMs(startedAt),
                engine: 'io-engine.fs.readFile.bytes-fresh',
                riskClass: 'low',
                traceId,
                cache: 'none',
            }),
            false,
            error,
            getIoTelemetryRuntimeOption(options),
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
        const io = publishIoOperationResult(
            buildIoMeta({
                operation: 'read',
                target: filePath,
                targetKind: 'file',
                bytesRead: snapshot.bytesRead,
                durationMs: elapsedIoMs(startedAt),
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
            undefined,
            getIoTelemetryRuntimeOption(options),
        );
        return { ...snapshot, io };
    } catch (error) {
        publishIoOperationResult(
            buildIoMeta({
                operation: 'read',
                target: filePath,
                targetKind: 'file',
                durationMs: elapsedIoMs(startedAt),
                engine:
                    options.fromEnd === true ? 'io-engine.fs.read.range-tail-fresh' : 'io-engine.fs.read.range-fresh',
                riskClass: 'low',
                traceId,
                cache: 'none',
            }),
            false,
            error,
            getIoTelemetryRuntimeOption(options),
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
