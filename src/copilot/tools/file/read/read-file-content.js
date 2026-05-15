// @ts-check
/**
 * src/copilot/tools/file/read/read-file-content.js
 *
 * Implementação especializada da tool `read_file_content`.
 *
 * @module copilot/tools/file/read/read-file-content
 */

import { stat as fsStat } from 'node:fs/promises';
import { z } from 'zod';
import { utf8ByteLength } from '#copilot/infra/public/buffer';
import { toError } from '../../../core/error-handlers.js';
import { withIoMeta } from '../../../core/io-contracts.js';
import { sanitizeIoTextOutput } from '../../../core/io-policy.js';
import { getIoCacheStats } from '#copilot/infra/public/cache';
import { readBytes, readText, readTextChunks, warmReadThroughContext } from '#copilot/infra/public/io';
import { log } from '../../infra/logger.js';
import { buildTool } from '../../infra/tool-factory.js';
import {
    FILE_TOOLS_OUTPUT_POLICY,
    truncateBuffer,
    truncateUtf8Text,
    validatePath,
    WORKSPACE_ROOT,
} from '../shared.js';
import { buildReadFileMetadata } from './metadata.js';
import {
    nextLineCursor,
    normalizeNonNegativeInteger,
    normalizePositiveInteger,
    parseReadCursor,
} from './window.js';

/**
 * Tamanho mínimo em bytes para disparar warm read-through context em arquivos de texto.
 *
 * @type {number}
 */
const MIN_READ_THROUGH_BYTES = 1024;
const DEFAULT_STREAM_CHUNK_LINES = 200;

/**
 * Tool: read_file_content — lê o conteúdo de um arquivo.
 */
export const readFileContentTool = buildTool({
    name: 'read_file_content',
    description:
        'Lê o conteúdo de um arquivo no workspace. Arquivos de texto são retornados como string. ' +
        'Arquivos binários retornam conteúdo em base64 quando essa codificação é solicitada.',
    parameters: z.object({
        path: z.string().describe('Caminho do arquivo (relativo ao workspace ou absoluto dentro de /workspaces/)'),
        startLine: z
            .number()
            .int()
            .min(1)
            .optional()
            .describe('Linha inicial (1-based). Se omitido, lê desde o início.'),
        endLine: z
            .number()
            .int()
            .min(1)
            .optional()
            .describe('Linha final (1-based, inclusivo). Se omitido, lê até o fim.'),
        cursor: z
            .string()
            .optional()
            .describe('Cursor retornado por chamada anterior. Em utf8 representa a próxima linha; em base64, byte offset.'),
        maxLines: z
            .number()
            .int()
            .min(1)
            .optional()
            .describe('Máximo de linhas a retornar em utf8 quando endLine não for definido.'),
        maxBytes: z
            .number()
            .int()
            .min(1)
            .optional()
            .describe('Máximo de bytes de saída para esta chamada. Default segue COPILOT_FILE_TOOLS_MAX_CONTENT_BYTES.'),
        encoding: z
            .enum(['utf8', 'base64'])
            .optional()
            .default('utf8')
            .describe('Codificação de saída. Use base64 para arquivos binários.'),
        readStrategy: z
            .enum(['cached', 'stream'])
            .optional()
            .default('cached')
            .describe('cached forma/reusa cache full-file; stream pagina por readline sem hidratar cache full-file.'),
        streamHighWaterMark: z
            .number()
            .int()
            .min(1024)
            .max(16 * 1024 * 1024)
            .optional()
            .describe('Buffer interno do read stream em bytes quando readStrategy=stream. Default: Node/fs padrão.'),
        includeMetadata: z
            .boolean()
            .optional()
            .default(true)
            .describe('Inclui bloco metadata com stat, cache, cursor, bytes, linhas e hashes quando solicitados.'),
        includeHash: z
            .boolean()
            .optional()
            .default(false)
            .describe('Inclui SHA-256 do arquivo completo e do conteúdo retornado em metadata.'),
        includeReadThrough: z
            .boolean()
            .optional()
            .default(true)
            .describe('Aquece contexto relacionado para arquivos de texto maiores quando readStrategy=cached.'),
        includeCacheStats: z
            .boolean()
            .optional()
            .default(false)
            .describe('Inclui snapshot de stats L1 do cache de IO no metadata. Útil para auditoria/debug.'),
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
    }) => {
        const resolvedEncoding = encoding ?? 'utf8';
        const resolvedReadStrategy = readStrategy ?? 'cached';
        const outputMaxBytes =
            normalizePositiveInteger(maxBytes, FILE_TOOLS_OUTPUT_POLICY.maxContentBytes) ?? Number.POSITIVE_INFINITY;
        const resolvedMaxLines = normalizePositiveInteger(maxLines);
        const { ok, reason, resolved } = await validatePath(filePath, { mode: 'read' });
        if (!ok) return { success: false, error: reason };
        if (resolvedEncoding === 'base64' && (startLine !== undefined || endLine !== undefined || maxLines !== undefined)) {
            return {
                success: false,
                error: 'Parâmetros de linha (startLine/endLine/maxLines) são válidos apenas com encoding=utf8.',
            };
        }

        const textCursor =
            resolvedEncoding === 'utf8' ? parseReadCursor(cursor, { min: 1, label: 'Cursor de linha' }) : null;
        if (textCursor && !textCursor.ok) return { success: false, error: textCursor.reason };
        const byteCursor =
            resolvedEncoding === 'base64' ? parseReadCursor(cursor, { min: 0, label: 'Cursor de bytes' }) : null;
        if (byteCursor && !byteCursor.ok) return { success: false, error: byteCursor.reason };

        const effectiveStartLine = textCursor?.ok && textCursor.value !== null ? textCursor.value : (startLine ?? 1);
        const effectiveEndLine =
            endLine ?? (resolvedMaxLines !== undefined ? effectiveStartLine + resolvedMaxLines - 1 : undefined);
        if (effectiveEndLine !== undefined && effectiveEndLine < effectiveStartLine) {
            return { success: false, error: 'Intervalo inválido: endLine deve ser maior ou igual a startLine.' };
        }

        log('INFO', `[copilot/read_file_content] ${resolved}`);

        try {
            const stats = await fsStat(resolved);
            if (stats.isDirectory()) return { success: false, error: 'É um diretório, use list_directory.' };

            if (resolvedEncoding === 'base64') {
                const raw = await readBytes(resolved);
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
                    ? await readTextChunks(resolved, {
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
                    : await readText(resolved, {
                          startLine: effectiveStartLine,
                          endLine: effectiveEndLine,
                          advisoryLimits: {
                              readStrategy: 'cached',
                              maxLines: resolvedMaxLines ?? null,
                              cursor: cursor ?? null,
                          },
                      });
            const textContent =
                'chunks' in text ? text.chunks.map((chunk) => chunk.content).join('\n') : text.content;
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
            const readThrough =
                resolvedReadStrategy === 'cached' && includeReadThrough !== false && stats.size >= MIN_READ_THROUGH_BYTES
                    ? await warmReadThroughContext(resolved, {
                          workspaceRoot: WORKSPACE_ROOT,
                          relatedImports: true,
                          concurrency: 4,
                          silent: true,
                      })
                    : null;
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
                ...(includeHash && 'contentHash' in text ? { contentHash: text.contentHash } : {}),
                ...(includeHash && 'returnedContentHash' in text ? { returnedContentHash: text.returnedContentHash } : {}),
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
            return { success: false, error: toError(err).message };
        }
    },
});
