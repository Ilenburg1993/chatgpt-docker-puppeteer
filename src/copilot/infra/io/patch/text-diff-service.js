// @ts-check
/**
 * Serviço de diff textual com observabilidade canônica.
 *
 * @module copilot/infra/io/patch/text-diff-service
 */

import { buildIoMeta, createIoTraceId } from '../../../core/io-contracts.js';
import { nowIoMs, publishIoOperation } from '../../io-observability.js';
import { assertValidIoFilePath } from '../../policy/path-resource.js';
import { readText } from '../fs/read-services.js';
import { buildSimpleTextDiff } from './text-diff.js';

/**
 * @param {number} startedAt
 * @returns {number}
 */
function elapsedMs(startedAt) {
    return Math.max(0, Math.round(nowIoMs() - startedAt));
}

/**
 * @param {import('../../../core/io-contracts.js').IoMeta} io
 * @param {boolean} success
 * @param {unknown} [error]
 * @returns {import('../../../core/io-contracts.js').IoMeta}
 */
function publishAndReturn(io, success, error) {
    publishIoOperation(io, { success, ...(error !== undefined ? { error } : {}) });
    return io;
}

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
 *     io: import('../../../core/io-contracts.js').IoMeta;
 * }>}
 */
export async function diffTextWithReader(readTextLike, pathA, pathB, options = {}) {
    const startedAt = nowIoMs();
    const traceId = createIoTraceId();
    try {
        const [a, b] = await Promise.all([readTextLike(pathA), readTextLike(pathB)]);
        const { diff, contextLines } = buildSimpleTextDiff(a.content, b.content, options);
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
