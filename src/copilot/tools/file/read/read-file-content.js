// @ts-check
/**
 * src/copilot/tools/file/read/read-file-content.js
 *
 * Implementação especializada da tool `read_file_content`.
 *
 * @module copilot/tools/file/read/read-file-content
 */

import { sanitizeIoTextOutput, toError, withIoMeta } from '#copilot/core';
import { getIoCacheStats } from '#copilot/infra/public/cache';
import { createWorkspaceIo } from '#copilot/infra/public/filesystem/workspace';
import { createWorkspaceIndexing } from '#copilot/infra/public/indexing/workspace';
import { utf8ByteLength } from '#copilot/infra/public/platform';
import { z } from 'zod';
import { log } from '../../infra/logger.js';
import { buildTool } from '../../infra/tool-factory.js';
import { FILE_TOOLS_OUTPUT_POLICY, truncateBuffer, truncateUtf8Text, validatePath, WORKSPACE_ROOT } from '../shared.js';
import { createReadFileFailure } from './feedback.js';
import { buildReadFileMetadata } from './metadata.js';
import {
    buildAttemptedReadThroughReport,
    buildSkippedReadThroughReport,
    buildTimedOutReadThroughReport,
    DEFAULT_READ_THROUGH_AUTO_TIMEOUT_MS,
    DEFAULT_READ_THROUGH_FORCE_TIMEOUT_MS,
    normalizeReadThroughMode,
    planReadThrough,
} from './read-through-policy.js';
import { nextLineCursor, normalizeNonNegativeInteger, normalizePositiveInteger, parseReadCursor } from './window.js';

const { readBytesValidated, readTextChunksValidated, readTextValidated, statPathValidated } = createWorkspaceIo({
    workspaceRoot: WORKSPACE_ROOT,
});
const { warmReadThroughContext } = createWorkspaceIndexing({ workspaceRoot: WORKSPACE_ROOT });

/**
 * Tamanho mínimo em bytes para disparar warm read-through context em arquivos de texto.
 *
 * @type {number}
 */
const MIN_READ_THROUGH_BYTES = 1024;
const DEFAULT_STREAM_CHUNK_LINES = 200;

/**
 * @param {string} resolved
 * @param {'off' | 'auto' | 'force'} mode
 */
async function warmReadThroughWithBudget(resolved, mode) {
    const startedAt = Date.now();
    const timeoutMs = mode === 'force' ? DEFAULT_READ_THROUGH_FORCE_TIMEOUT_MS : DEFAULT_READ_THROUGH_AUTO_TIMEOUT_MS;
    const warmPromise = warmReadThroughContext(resolved, {
        workspaceRoot: WORKSPACE_ROOT,
        relatedImports: true,
        concurrency: 4,
        silent: true,
        cacheBytes: false,
    });
    warmPromise.catch(() => undefined);
    /** @type {ReturnType<typeof setTimeout> | null} */
    let timer = null;
    const timeoutPromise = new Promise((resolve) => {
        timer = setTimeout(() => resolve(buildTimedOutReadThroughReport(mode, startedAt, timeoutMs)), timeoutMs);
    });
    const result = await Promise.race([warmPromise, timeoutPromise]);
    if (timer) clearTimeout(timer);
    return result && typeof result === 'object' && 'timedOut' in result
        ? result
        : buildAttemptedReadThroughReport(mode, startedAt, result);
}

/**
 * @param {{
 *     path: string;
 *     encoding: 'utf8' | 'base64';
 *     readStrategy: string;
 *     returnedLines?: { start: number; end: number } | null;
 *     totalLines?: number;
 *     totalLinesKnown?: boolean;
 *     bytesReturned: number;
 *     truncated: boolean;
 *     nextCursor: string | null;
 *     sanitized?: boolean;
 *     redactions?: number;
 * }} input
 * @returns {{
 *     operation: 'read';
 *     path: string;
 *     encoding: 'utf8' | 'base64';
 *     readStrategy: string;
 *     summary: string;
 *     nextAction: string | null;
 *     truncated: boolean;
 *     nextCursor: string | null;
 * }}
 */
function buildReadTerminalSummary(input) {
    const range =
        input.encoding === 'utf8' && input.returnedLines
            ? `linhas ${input.returnedLines.start}-${input.returnedLines.end}` +
              (input.totalLinesKnown && typeof input.totalLines === 'number' ? ` de ${input.totalLines}` : '')
            : `${input.bytesReturned} bytes`;
    const policy = input.truncated
        ? ` · truncado · nextCursor=${input.nextCursor ?? 'n/a'}`
        : input.nextCursor
          ? ` · nextCursor=${input.nextCursor}`
          : '';
    const sanitized = input.sanitized ? ` · ${input.redactions ?? 0} redacoes` : '';
    const nextAction = input.truncated
        ? 'Continue com o nextCursor para ler a próxima janela antes de editar ou resumir conclusões.'
        : input.nextCursor
          ? 'Use nextCursor se precisar da próxima janela; use includeHash=true antes de uma escrita otimista.'
          : 'Use includeHash=true numa releitura curta se a próxima etapa for escrever ou aplicar patch com expectedHash.';
    return {
        operation: 'read',
        path: input.path,
        encoding: input.encoding,
        readStrategy: input.readStrategy,
        summary: `Leitura concluida: ${range} · ${input.encoding}/${input.readStrategy}${policy}${sanitized}`,
        nextAction,
        truncated: input.truncated,
        nextCursor: input.nextCursor,
    };
}

/**
 * Tool: read_file_content — lê o conteúdo de um arquivo.
 */
export const readFileContentTool = buildTool({
    name: 'read_file_content',
    description:
        'Lê o conteúdo de um arquivo no workspace. Arquivos de texto são retornados como string. ' +
        'Arquivos binários retornam conteúdo em base64 quando essa codificação é solicitada.',
    instructions:
        'Use read_file_content before editing files and when the model needs exact current text. ' +
        'Prefer startLine/endLine, maxLines or cursor for large files; request includeHash=true before follow-up writes ' +
        'that need optimistic safety. Use readStrategy=stream for large line windows and encoding=base64 only for binary ' +
        'files. Summarize returned ranges, truncation and nextCursor instead of pasting huge content back to the user.',
    parameters: z.object({
        path: z.string()['describe']('Caminho do arquivo (relativo ao workspace ou absoluto dentro de /workspaces/)'),
        startLine: z
            .number()
            .int()
            .min(1)
            .optional()
            ['describe']('Linha inicial (1-based). Se omitido, lê desde o início.'),
        endLine: z
            .number()
            .int()
            .min(1)
            .optional()
            ['describe']('Linha final (1-based, inclusivo). Se omitido, lê até o fim.'),
        cursor: z
            .string()
            .optional()
            ['describe'](
                'Cursor retornado por chamada anterior. Em utf8 representa a próxima linha; em base64, byte offset.',
            ),
        maxLines: z
            .number()
            .int()
            .min(1)
            .optional()
            ['describe']('Máximo de linhas a retornar em utf8 quando endLine não for definido.'),
        maxBytes: z
            .number()
            .int()
            .min(1)
            .optional()
            ['describe'](
                'Máximo de bytes de saída para esta chamada. Default segue COPILOT_FILE_TOOLS_MAX_CONTENT_BYTES.',
            ),
        encoding: z
            .enum(['utf8', 'base64'])
            .optional()
            .default('utf8')
            ['describe']('Codificação de saída. Use base64 para arquivos binários.'),
        readStrategy: z
            .enum(['cached', 'stream'])
            .optional()
            .default('cached')
            ['describe'](
                'cached forma/reusa cache full-file; stream pagina por readline sem hidratar cache full-file.',
            ),
        streamHighWaterMark: z
            .number()
            .int()
            .min(1024)
            .max(16 * 1024 * 1024)
            .optional()
            ['describe']('Buffer interno do read stream em bytes quando readStrategy=stream. Default: Node/fs padrão.'),
        includeMetadata: z
            .boolean()
            .optional()
            .default(true)
            ['describe']('Inclui bloco metadata com stat, cache, cursor, bytes, linhas e hashes quando solicitados.'),
        includeHash: z
            .boolean()
            .optional()
            .default(false)
            ['describe']('Inclui SHA-256 do arquivo completo e do conteúdo retornado em metadata.'),
        includeReadThrough: z
            .union([z.boolean(), z.enum(['off', 'auto', 'force'])])
            .optional()
            .default('auto')
            ['describe'](
                "Controla aquecimento de contexto relacionado: 'off' desativa, 'auto' usa heurística de tamanho, 'force' tenta sempre em utf8/cached. Boolean legado: true=auto, false=off.",
            ),
        includeCacheStats: z
            .boolean()
            .optional()
            .default(false)
            ['describe']('Inclui snapshot de stats L1 do cache de IO no metadata. Útil para auditoria/debug.'),
        quietLog: z
            .boolean()
            .optional()
            .default(false)
            ['describe']('Suprime log informativo de leitura quando a superfície chamadora já renderiza a operação.'),
    }),
    handler: async ({
        path: filePath,
        startLine,
        endLine,
        cursor,
        maxLines,
        maxBytes,
        encoding,
        readStrategy,
        streamHighWaterMark,
        includeMetadata,
        includeHash,
        includeReadThrough,
        includeCacheStats,
        quietLog,
    }) => {
        const receivedParameters = {
            path: filePath,
            startLine,
            endLine,
            cursor,
            maxLines,
            maxBytes,
            encoding,
            readStrategy,
            streamHighWaterMark,
            includeMetadata,
            includeHash,
            includeReadThrough,
            includeCacheStats,
            quietLog,
        };
        const resolvedEncoding = encoding ?? 'utf8';
        const resolvedReadStrategy = readStrategy ?? 'cached';
        const readThroughMode = normalizeReadThroughMode(includeReadThrough);
        const outputMaxBytes =
            normalizePositiveInteger(maxBytes, FILE_TOOLS_OUTPUT_POLICY.maxContentBytes) ?? Number.POSITIVE_INFINITY;
        const resolvedMaxLines = normalizePositiveInteger(maxLines);
        const validated = await validatePath(filePath, { mode: 'read', issueReadCapability: true });
        const { ok, reason, resolved, validatedReadPath } = validated;
        if (!ok || !validatedReadPath) {
            return createReadFileFailure(
                reason ?? 'Caminho inválido.',
                'ERR_READ_PATH_INVALID',
                receivedParameters,
                { path: filePath },
                { category: 'policy-denied' },
            );
        }
        if (
            resolvedEncoding === 'base64' &&
            (startLine !== undefined || endLine !== undefined || maxLines !== undefined)
        ) {
            return createReadFileFailure(
                'Parâmetros de linha (startLine/endLine/maxLines) são válidos apenas com encoding=utf8.',
                'ERR_READ_BINARY_LINE_WINDOW',
                receivedParameters,
                { path: resolved, encoding: resolvedEncoding },
                { category: 'invalid-parameters' },
            );
        }

        const textCursor =
            resolvedEncoding === 'utf8' ? parseReadCursor(cursor, { min: 1, label: 'Cursor de linha' }) : null;
        if (textCursor && !textCursor.ok) {
            return createReadFileFailure(
                textCursor.reason,
                'ERR_READ_CURSOR_INVALID',
                receivedParameters,
                {
                    path: resolved,
                    encoding: resolvedEncoding,
                    cursorKind: 'line',
                },
                { category: 'invalid-parameters' },
            );
        }
        const byteCursor =
            resolvedEncoding === 'base64' ? parseReadCursor(cursor, { min: 0, label: 'Cursor de bytes' }) : null;
        if (byteCursor && !byteCursor.ok) {
            return createReadFileFailure(
                byteCursor.reason,
                'ERR_READ_CURSOR_INVALID',
                receivedParameters,
                {
                    path: resolved,
                    encoding: resolvedEncoding,
                    cursorKind: 'byte',
                },
                { category: 'invalid-parameters' },
            );
        }

        const effectiveStartLine = textCursor?.ok && textCursor.value !== null ? textCursor.value : (startLine ?? 1);
        const effectiveEndLine =
            endLine ?? (resolvedMaxLines !== undefined ? effectiveStartLine + resolvedMaxLines - 1 : undefined);
        if (effectiveEndLine !== undefined && effectiveEndLine < effectiveStartLine) {
            return createReadFileFailure(
                'Intervalo inválido: endLine deve ser maior ou igual a startLine.',
                'ERR_READ_LINE_WINDOW_INVALID',
                receivedParameters,
                { path: resolved, effectiveStartLine, effectiveEndLine },
                { category: 'invalid-parameters' },
            );
        }

        if (!quietLog) log('INFO', `[copilot/read_file_content] ${resolved}`);

        try {
            const stats = (await statPathValidated(validatedReadPath)).stats;
            if (stats.isDirectory()) {
                return createReadFileFailure(
                    'É um diretório, use list_directory.',
                    'ERR_READ_DIRECTORY',
                    receivedParameters,
                    { path: resolved },
                    { category: 'invalid-parameters' },
                );
            }

            if (resolvedEncoding === 'base64') {
                const raw = await readBytesValidated(validatedReadPath);
                const offset = normalizeNonNegativeInteger(byteCursor?.ok ? byteCursor.value : 0, 0);
                const source = offset > 0 ? raw.content.subarray(Math.min(offset, raw.content.length)) : raw.content;
                const limitedBuffer = truncateBuffer(source, outputMaxBytes);
                const nextCursor =
                    offset + limitedBuffer.length < raw.content.length ? String(offset + limitedBuffer.length) : null;
                const truncated = nextCursor !== null;
                if (truncated) {
                    log(
                        'INFO',
                        `[copilot/read_file_content] conteúdo binário truncado por política (${outputMaxBytes} bytes) em ${resolved}`,
                    );
                }
                const content = limitedBuffer.toString('base64');
                const bytesReturned = utf8ByteLength(content, 'read_file_content bytes');
                const metadata = buildReadFileMetadata(stats, {
                    resolved,
                    encoding: 'base64',
                    readStrategy: 'cached',
                    cache: raw.io.cache ?? null,
                    cursor,
                    nextCursor,
                    maxBytes: outputMaxBytes,
                    bytesRead: raw.bytesRead,
                    bytesReturned,
                    rawReturnedBytes: limitedBuffer.byteLength,
                    truncated,
                    cacheFingerprintStrategy: raw.cacheFingerprintStrategy,
                    ...(includeCacheStats ? { cacheStats: getIoCacheStats() } : {}),
                    ...(includeHash ? { contentHash: raw.contentHash } : {}),
                });
                const terminalSummary = buildReadTerminalSummary({
                    path: resolved,
                    encoding: 'base64',
                    readStrategy: 'cached',
                    bytesReturned,
                    truncated,
                    nextCursor,
                });
                return withIoMeta(
                    {
                        success: true,
                        path: resolved,
                        size: stats.size,
                        encoding: 'base64',
                        content,
                        truncated,
                        cursor: cursor ?? null,
                        nextCursor,
                        bytesReturned,
                        rawReturnedBytes: limitedBuffer.byteLength,
                        operation: 'read',
                        terminalSummary,
                        llmNextAction: terminalSummary.nextAction,
                        presentation: {
                            operation: 'read',
                            path: resolved,
                            targetKinds: ['file'],
                            status: 'completed',
                            summary: terminalSummary.summary,
                        },
                        ...(includeMetadata === false ? {} : { metadata }),
                        ...(truncated
                            ? {
                                  configuredLimitBytes: outputMaxBytes,
                                  originalContentBytes: raw.content.length,
                              }
                            : {}),
                    },
                    raw.io,
                );
            }

            const text =
                resolvedReadStrategy === 'stream'
                    ? await readTextChunksValidated(validatedReadPath, {
                          startLine: effectiveStartLine,
                          endLine: effectiveEndLine,
                          chunkLines: resolvedMaxLines ?? DEFAULT_STREAM_CHUNK_LINES,
                          ...(streamHighWaterMark !== undefined ? { highWaterMark: streamHighWaterMark } : {}),
                          advisoryLimits: {
                              readStrategy: 'stream',
                              maxLines: resolvedMaxLines ?? null,
                              cursor: cursor ?? null,
                              streamHighWaterMark: streamHighWaterMark ?? null,
                          },
                      })
                    : await readTextValidated(validatedReadPath, {
                          startLine: effectiveStartLine,
                          endLine: effectiveEndLine,
                          hashMode: includeHash ? 'full' : 'none',
                          advisoryLimits: {
                              readStrategy: 'cached',
                              maxLines: resolvedMaxLines ?? null,
                              cursor: cursor ?? null,
                          },
                      });
            const textContent = 'chunks' in text ? text.chunks.map((chunk) => chunk.content).join('\n') : text.content;
            const returnedLines =
                'chunks' in text
                    ? text.chunks.length > 0
                        ? {
                              start: text.chunks[0]?.startLine ?? effectiveStartLine,
                              end: text.chunks[text.chunks.length - 1]?.endLine ?? effectiveStartLine - 1,
                          }
                        : { start: effectiveStartLine, end: effectiveStartLine - 1 }
                    : text.returnedLines;
            const totalLinesKnown = 'totalLinesKnown' in text ? text.totalLinesKnown : true;
            const nextCursor = nextLineCursor(returnedLines, text.totalLines, totalLinesKnown);
            const readThroughPlan = planReadThrough({
                mode: readThroughMode,
                readStrategy: resolvedReadStrategy,
                fileSize: stats.size,
                minBytes: MIN_READ_THROUGH_BYTES,
            });
            const readThrough = readThroughPlan.attempted
                ? await warmReadThroughWithBudget(resolved, readThroughMode)
                : buildSkippedReadThroughReport(readThroughPlan);
            const sanitized = sanitizeIoTextOutput({ text: textContent });
            const contentOutput = truncateUtf8Text(
                sanitized.text,
                outputMaxBytes,
                Number.isFinite(FILE_TOOLS_OUTPUT_POLICY.maxContentBytes)
                    ? `\n\n⚠️ [conteúdo truncado por política COPILOT_FILE_TOOLS_MAX_CONTENT_BYTES=${outputMaxBytes}]`
                    : undefined,
            );
            const truncated = contentOutput.truncated;
            if (truncated) {
                log(
                    'INFO',
                    `[copilot/read_file_content] conteúdo truncado por política (${outputMaxBytes} bytes) em ${resolved}`,
                );
            }
            const metadata = buildReadFileMetadata(stats, {
                resolved,
                encoding: 'utf8',
                readStrategy: resolvedReadStrategy,
                cache: resolvedReadStrategy === 'stream' ? 'stream-bypass' : (text.io.cache ?? null),
                cursor,
                nextCursor,
                maxBytes: outputMaxBytes,
                bytesRead: text.bytesRead,
                bytesReturned: utf8ByteLength(contentOutput.text, 'read_file_content returned bytes'),
                rawReturnedBytes: utf8ByteLength(sanitized.text, 'read_file_content raw bytes'),
                totalLines: text.totalLines,
                totalLinesKnown,
                returnedLines,
                truncated,
                sanitized: sanitized.sanitized,
                redactions: sanitized.redactions,
                cacheFingerprintStrategy: text.cacheFingerprintStrategy,
                ...(resolvedReadStrategy === 'stream' && streamHighWaterMark !== undefined
                    ? { streamHighWaterMark }
                    : {}),
                ...(includeCacheStats ? { cacheStats: getIoCacheStats() } : {}),
                ...(resolvedMaxLines !== undefined ? { maxLines: resolvedMaxLines } : {}),
                ...(includeHash && 'contentHash' in text && typeof text.contentHash === 'string'
                    ? { contentHash: text.contentHash }
                    : {}),
                ...(includeHash && 'returnedContentHash' in text && typeof text.returnedContentHash === 'string'
                    ? { returnedContentHash: text.returnedContentHash }
                    : {}),
            });
            const terminalSummary = buildReadTerminalSummary({
                path: resolved,
                encoding: 'utf8',
                readStrategy: resolvedReadStrategy,
                returnedLines,
                totalLines: text.totalLines,
                totalLinesKnown,
                bytesReturned: metadata.bytesReturned,
                truncated,
                nextCursor,
                sanitized: sanitized.sanitized,
                redactions: sanitized.redactions,
            });

            return withIoMeta(
                {
                    success: true,
                    path: resolved,
                    size: stats.size,
                    totalLines: text.totalLines,
                    totalLinesKnown,
                    returnedLines,
                    content: contentOutput.text,
                    readThrough,
                    sanitized: sanitized.sanitized,
                    redactions: sanitized.redactions,
                    truncated,
                    cursor: cursor ?? null,
                    nextCursor,
                    readStrategy: resolvedReadStrategy,
                    bytesReturned: metadata.bytesReturned,
                    rawReturnedBytes: metadata.rawReturnedBytes,
                    operation: 'read',
                    terminalSummary,
                    llmNextAction: terminalSummary.nextAction,
                    presentation: {
                        operation: 'read',
                        path: resolved,
                        targetKinds: ['file'],
                        status: 'completed',
                        summary: terminalSummary.summary,
                    },
                    ...(includeMetadata === false ? {} : { metadata }),
                    ...(truncated
                        ? {
                              configuredLimitBytes: outputMaxBytes,
                              originalContentBytes: contentOutput.originalBytes,
                          }
                        : {}),
                },
                { ...text.io, truncated, policyVersion: sanitized.policyVersion },
            );
        } catch (err) {
            const error = toError(err);
            return createReadFileFailure(
                error.message,
                'ERR_READ_FAILED',
                receivedParameters,
                {
                    path: resolved,
                    encoding: resolvedEncoding,
                    readStrategy: resolvedReadStrategy,
                    errorName: error.name,
                },
                { error },
            );
        }
    },
});
