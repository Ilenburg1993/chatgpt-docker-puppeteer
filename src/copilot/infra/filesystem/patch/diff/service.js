// @ts-check
/**
 * Serviço de diff textual com observabilidade canônica.
 *
 * @module copilot/infra/filesystem/patch/diff/service
 */

import { buildIoMeta, createIoTraceId } from '#copilot/core/io-contracts';
import { readText } from '#copilot/infra/internal/filesystem/read';
import { assertValidIoFilePath } from '#copilot/infra/internal/policy';
import {
    elapsedIoMs,
    getIoTelemetryRuntimeOption,
    nowIoMs,
    publishIoOperationResult,
} from '#copilot/infra/internal/telemetry';
import { buildSimpleTextDiff } from './algorithm.js';

/**
 * @typedef {{ content: string; bytesRead: number }} DiffReadable
 */

/**
 * @callback ReadTextLike
 * @param {string} filePath
 * @returns {Promise<DiffReadable>}
 */

/**
 * Executa diff textual entre dois arquivos usando uma função de leitura injetada.
 *
 * @param {ReadTextLike} readTextLike
 * @param {string} pathA
 * @param {string} pathB
 * @param {{ contextLines?: number }} [options]
 * @returns {Promise<{
 *     pathA: string;
 *     pathB: string;
 *     diff: string;
 *     identical: boolean;
 *     io: import('#copilot/core/io-contracts').IoMeta;
 * }>}
 */
export async function diffTextWithReader(readTextLike, pathA, pathB, options = {}) {
    const startedAt = nowIoMs();
    const traceId = createIoTraceId();
    try {
        const [a, b] = await Promise.all([readTextLike(pathA), readTextLike(pathB)]);
        const { diff, contextLines } = buildSimpleTextDiff(a.content, b.content, options);
        const io = publishIoOperationResult(
            buildIoMeta({
                operation: 'diff',
                target: `${pathA} <-> ${pathB}`,
                targetKind: 'file',
                bytesRead: a.bytesRead + b.bytesRead,
                durationMs: elapsedIoMs(startedAt),
                engine: 'io-engine.diffText',
                riskClass: 'low',
                traceId,
                advisoryLimits: { contextLines },
            }),
            true,
            undefined,
            getIoTelemetryRuntimeOption(options),
        );
        return { pathA, pathB, diff, identical: diff.trim() === '', io };
    } catch (error) {
        publishIoOperationResult(
            buildIoMeta({
                operation: 'diff',
                target: `${pathA} <-> ${pathB}`,
                targetKind: 'file',
                durationMs: elapsedIoMs(startedAt),
                engine: 'io-engine.diffText',
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
 * Diff textual simples entre arquivos locais, com validação de path e leitura via serviços canônicos.
 *
 * @param {string} pathA
 * @param {string} pathB
 * @param {{ contextLines?: number }} [options]
 */
export async function diffText(pathA, pathB, options = {}) {
    assertValidIoFilePath(pathA);
    assertValidIoFilePath(pathB);
    return diffTextWithReader(
        async (path) => {
            const textResult = await readText(path);
            return {
                content: textResult.content,
                bytesRead: textResult.bytesRead,
            };
        },
        pathA,
        pathB,
        options,
    );
}
