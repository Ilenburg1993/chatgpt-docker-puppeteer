// @ts-check
/**
 * High-throughput local/LLM-B text read batch.
 *
 * This tool deliberately complements rather than replaces read_file_content: it focuses on many independent UTF-8
 * windows with bounded concurrency and per-item failure isolation. Rich binary/read-through metadata stays in the
 * single-file tool.
 *
 * @module copilot/tools/file/read/read-files-batch
 */

import { runBoundedOperationBatch } from '#copilot/infra/public/bulk';
import { createWorkspaceIo } from '#copilot/infra/public/workspace-io';
import { z } from 'zod';
import { buildTool } from '../../infra/tool-factory.js';
import { truncateUtf8Text, validatePath, WORKSPACE_ROOT } from '../shared.js';

const { readTextValidated } = createWorkspaceIo({ workspaceRoot: WORKSPACE_ROOT });

const MAX_BATCH_READS = 32;
const MAX_BATCH_READ_CONCURRENCY = 8;
const MAX_BATCH_READ_INPUT_BYTES = 1024 * 1024;
const DEFAULT_ITEM_OUTPUT_BYTES = 256 * 1024;
const HARD_ITEM_OUTPUT_BYTES = 2 * 1024 * 1024;
const DEFAULT_BATCH_OUTPUT_BUDGET_BYTES = 1024 * 1024;
const MIN_BATCH_OUTPUT_BUDGET_BYTES = 64 * 1024;
const MAX_BATCH_OUTPUT_BUDGET_BYTES = 4 * 1024 * 1024;

const readRequestSchema = z.object({
    path: z.string().min(1),
    startLine: z.number().int().min(1).optional(),
    endLine: z.number().int().min(1).optional(),
    maxBytes: z.number().int().min(1).max(HARD_ITEM_OUTPUT_BYTES).optional(),
});

/** @param {unknown} value */
function estimateRequestBytes(value) {
    try {
        return Buffer.byteLength(JSON.stringify(value), 'utf8') + 64;
    } catch {
        return MAX_BATCH_READ_INPUT_BYTES + 1;
    }
}

export const readFilesBatchTool = buildTool({
    name: 'read_files_batch',
    description:
        'Lê até 32 janelas UTF-8 independentes em uma única chamada, com concorrência limitada, ordem preservada e falha isolada por item.',
    instructions:
        'Use read_files_batch quando precisar de vários arquivos/janelas atuais de uma vez. Prefira best-effort para ' +
        'investigação ampla; use fail-fast quando os itens posteriores dependerem logicamente dos anteriores. Para ' +
        'binários, read-through avançado ou metadata detalhada, use read_file_content.',
    parameters: z.object({
        requests: z.array(readRequestSchema).min(1).max(MAX_BATCH_READS),
        failureMode: z.enum(['best-effort', 'fail-fast']).optional().default('best-effort'),
        concurrency: z.number().int().min(1).max(MAX_BATCH_READ_CONCURRENCY).optional().default(6),
        resultBudgetBytes: z
            .number()
            .int()
            .min(MIN_BATCH_OUTPUT_BUDGET_BYTES)
            .max(MAX_BATCH_OUTPUT_BUDGET_BYTES)
            .optional()
            .default(DEFAULT_BATCH_OUTPUT_BUDGET_BYTES),
    }),
    handler: async ({ requests, failureMode, concurrency, resultBudgetBytes }) => {
        const perItemBudget = Math.max(4096, Math.floor(resultBudgetBytes / Math.max(1, requests.length)));
        const execution = await runBoundedOperationBatch(
            requests,
            async (request, index) => {
                const parsed = readRequestSchema.safeParse(request);
                if (!parsed.success) {
                    return {
                        success: false,
                        index,
                        code: 'ERR_BATCH_READ_INVALID_ITEM',
                        error: 'Invalid read_files_batch request.',
                    };
                }
                const input = parsed.data;
                if (input.endLine !== undefined && input.startLine !== undefined && input.endLine < input.startLine) {
                    return {
                        success: false,
                        index,
                        path: input.path,
                        code: 'ERR_BATCH_READ_LINE_RANGE',
                        error: 'endLine must be greater than or equal to startLine.',
                    };
                }
                const resolved = await validatePath(input.path, { mode: 'read', issueReadCapability: true });
                if (!resolved.ok || !resolved.validatedReadPath) {
                    return {
                        success: false,
                        index,
                        path: input.path,
                        code: 'ERR_BATCH_READ_PATH',
                        error: resolved.reason ?? 'Path denied.',
                    };
                }
                try {
                    const snapshot = await readTextValidated(resolved.validatedReadPath, {
                        ...(input.startLine !== undefined ? { startLine: input.startLine } : {}),
                        ...(input.endLine !== undefined ? { endLine: input.endLine } : {}),
                    });
                    const outputLimit = Math.min(input.maxBytes ?? DEFAULT_ITEM_OUTPUT_BYTES, perItemBudget);
                    const bounded = truncateUtf8Text(
                        snapshot.content,
                        outputLimit,
                        '\n\n[read_files_batch item truncated]',
                    );
                    return {
                        success: true,
                        index,
                        path: input.path,
                        resolvedPath: resolved.resolved,
                        content: bounded.text,
                        bytesReturned: Buffer.byteLength(bounded.text, 'utf8'),
                        sourceBytes: snapshot.bytesRead,
                        totalLines: snapshot.totalLines,
                        returnedLines: snapshot.returnedLines,
                        contentHash: snapshot.contentHash,
                        returnedContentHashBeforeTruncation: snapshot.returnedContentHash,
                        truncated: bounded.truncated,
                        maxBytes: outputLimit,
                        engine: snapshot.io.engine,
                    };
                } catch (error) {
                    const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
                    return {
                        success: false,
                        index,
                        path: input.path,
                        code: typeof code === 'string' ? code : 'ERR_BATCH_READ_EXECUTION',
                        error: error instanceof Error ? error.message : String(error),
                    };
                }
            },
            {
                concurrency,
                failureMode,
                maxItems: MAX_BATCH_READS,
                maxInputBytes: MAX_BATCH_READ_INPUT_BYTES,
                estimateItemBytes: estimateRequestBytes,
                isFailure: (value) => value.success !== true,
            },
        );

        const results = execution.results.map((row) => {
            if (row.status === 'skipped') {
                return {
                    index: row.index,
                    success: false,
                    status: 'skipped',
                    skipped: true,
                    code: 'ERR_BATCH_READ_SKIPPED',
                    reason: row.reason,
                    durationMs: 0,
                };
            }
            if ('value' in row && row.value) {
                return { ...row.value, status: row.status, durationMs: row.durationMs };
            }
            return {
                index: row.index,
                success: false,
                status: 'failed',
                code: row.status === 'failed' ? (row.code ?? 'ERR_BATCH_READ_EXECUTION') : 'ERR_BATCH_READ_EXECUTION',
                error: row.status === 'failed' ? (row.error ?? 'Batch read failed.') : 'Batch read failed.',
                durationMs: row.durationMs,
            };
        });
        return {
            success: execution.failedCount === 0 && execution.skippedCount === 0,
            batch: true,
            executionId: execution.executionId,
            failureMode: execution.failureMode,
            requestCount: execution.requestCount,
            attemptedCount: execution.attemptedCount,
            succeededCount: execution.succeededCount,
            failedCount: execution.failedCount,
            skippedCount: execution.skippedCount,
            concurrency: execution.concurrency,
            maxInFlight: execution.maxInFlight,
            inputBytes: execution.inputBytes,
            durationMs: execution.durationMs,
            resultBudgetBytes,
            perItemBudgetBytes: perItemBudget,
            results,
            terminalSummary: {
                operation: 'read-batch',
                summary: `${execution.succeededCount}/${execution.requestCount} leituras concluídas; ${execution.failedCount} falharam; ${execution.skippedCount} puladas.`,
                nextAction:
                    execution.failedCount > 0
                        ? 'Use os códigos/erros por item; os resultados bem-sucedidos permanecem válidos e não precisam ser relidos.'
                        : null,
            },
        };
    },
});
