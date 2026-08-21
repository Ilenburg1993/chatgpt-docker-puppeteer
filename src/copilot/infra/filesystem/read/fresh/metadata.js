// @ts-check
/** Observable physical directory/stat adapters. */

import { buildIoMeta, createIoTraceId } from '#copilot/core';
import { assertValidIoFilePath } from '#copilot/infra/internal/policy';
import {
    elapsedIoMs,
    getIoTelemetryRuntimeOption,
    nowIoMs,
    publishIoOperationResult,
} from '#copilot/infra/internal/telemetry';
import { lstatPathSnapshot, readDirectoryNamesSnapshot, statPathSnapshot } from '../snapshot/index.js';

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
        const io = publishIoOperationResult(
            buildIoMeta({
                operation: 'scan',
                target: dirPath,
                targetKind: 'directory',
                durationMs: elapsedIoMs(startedAt),
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
            undefined,
            getIoTelemetryRuntimeOption(options),
        );
        return { path: dirPath, entries, io };
    } catch (error) {
        publishIoOperationResult(
            buildIoMeta({
                operation: 'scan',
                target: dirPath,
                targetKind: 'directory',
                durationMs: elapsedIoMs(startedAt),
                engine: 'io-engine.fs.readdir.names-fresh',
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
        const io = publishIoOperationResult(
            buildIoMeta({
                operation: 'stat',
                target: filePath,
                targetKind: stats.isDirectory() ? 'directory' : 'file',
                durationMs: elapsedIoMs(startedAt),
                engine: 'io-engine.fs.lstat',
                riskClass: 'low',
                traceId,
                cache: 'none',
                advisoryLimits: { ...(options.advisoryLimits ?? {}), followSymlinks: false },
            }),
            true,
            undefined,
            getIoTelemetryRuntimeOption(options),
        );
        return { path: filePath, stats, io };
    } catch (error) {
        publishIoOperationResult(
            buildIoMeta({
                operation: 'stat',
                target: filePath,
                targetKind: 'unknown',
                durationMs: elapsedIoMs(startedAt),
                engine: 'io-engine.fs.lstat',
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
        const io = publishIoOperationResult(
            buildIoMeta({
                operation: 'stat',
                target: filePath,
                targetKind: stats.isDirectory() ? 'directory' : 'file',
                durationMs: elapsedIoMs(startedAt),
                engine: 'io-engine.fs.stat',
                riskClass: 'low',
                traceId,
                ...(options.advisoryLimits !== undefined ? { advisoryLimits: options.advisoryLimits } : {}),
            }),
            true,
            undefined,
            getIoTelemetryRuntimeOption(options),
        );
        return { path: filePath, stats, io };
    } catch (error) {
        publishIoOperationResult(
            buildIoMeta({
                operation: 'stat',
                target: filePath,
                targetKind: 'unknown',
                durationMs: elapsedIoMs(startedAt),
                engine: 'io-engine.fs.stat',
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
