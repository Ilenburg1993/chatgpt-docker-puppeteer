// @ts-check
/**
 * High-throughput local/LLM-B exact-string patch batch.
 *
 * Same-target patches execute sequentially under one canonical patchTextBatchLocked critical section; independent
 * targets use the shared bounded bulk executor. Automatic rollback capture stays disabled for this path.
 *
 * @module copilot/tools/file/write/patch-files-batch
 */

import { runBoundedOperationBatch } from '#copilot/infra/public/bulk';
import { createWorkspaceIo } from '#copilot/infra/public/workspace-io';
import { z } from 'zod';
import { buildTool } from '../../infra/tool-factory.js';
import { validatePath, WORKSPACE_ROOT } from '../shared.js';

const { patchTextBatchLocked, patchTextBatchLockedValidated } = createWorkspaceIo({ workspaceRoot: WORKSPACE_ROOT });

/**
 * @param {{ resolved: string; validatedWritePath?: unknown }} target
 * @param {Parameters<typeof patchTextBatchLocked>[1]} options
 */
function patchBatchValidatedOrString(target, options) {
    return target.validatedWritePath
        ? patchTextBatchLockedValidated(target.validatedWritePath, options)
        : patchTextBatchLocked(target.resolved, options);
}

const MAX_PATCH_OPERATIONS = 64;
const MAX_PATCH_TARGETS = 32;
const MAX_PATCH_CONCURRENCY = 8;
const MAX_PATCH_INPUT_BYTES = 1536 * 1024;

const patchOperationSchema = z.object({
    path: z.string().min(1),
    old_string: z.string().min(1),
    new_string: z.string(),
    replace_all: z.boolean().optional().default(false),
    expected_occurrences: z.number().int().min(1).optional(),
    occurrence_index: z.number().int().min(1).optional(),
    expectedHash: z.string().optional(),
    allowNoop: z.boolean().optional().default(false),
    diffContextLines: z.number().int().min(0).max(20).optional().default(3),
    maxDiffLines: z.number().int().min(1).max(500).optional().default(160),
    includeDiffPreview: z.boolean().optional().default(false),
});

/** @param {unknown[]} operations */
function estimatePatchInputBytes(operations) {
    try {
        return Buffer.byteLength(JSON.stringify(operations), 'utf8');
    } catch {
        return MAX_PATCH_INPUT_BYTES + 1;
    }
}

export const patchFilesBatchTool = buildTool({
    name: 'patch_files_batch',
    description:
        'Aplica/simula até 64 patches literais em até 32 arquivos numa única chamada; cada arquivo é atômico e falhas entre arquivos são isoladas.',
    instructions:
        'Use patch_files_batch para edições cirúrgicas em muitos arquivos. Patches no mesmo arquivo são sequenciais e ' +
        'atômicos; targets diferentes podem executar em paralelo. Use dryRun=true quando precisar de um preflight sem ' +
        'escrita. Best-effort preserva resultados úteis de targets independentes; fail-fast reduz trabalho após falha.',
    parameters: z.object({
        operations: z.array(patchOperationSchema).min(1).max(MAX_PATCH_OPERATIONS),
        dryRun: z.boolean().optional().default(false),
        failureMode: z.enum(['best-effort', 'fail-fast']).optional().default('best-effort'),
        targetConcurrency: z.number().int().min(1).max(MAX_PATCH_CONCURRENCY).optional().default(4),
        durability: z
            .enum(['file-and-directory', 'file', 'none'])
            .optional()
            ['describe'](
                'Perfil de persistência após crash; default file-and-directory. Atomicidade e preconditions permanecem ativas.',
            ),
    }),
    handler: async ({ operations, dryRun, failureMode, targetConcurrency, durability }) => {
        const inputBytes = estimatePatchInputBytes(operations);
        if (inputBytes > MAX_PATCH_INPUT_BYTES) {
            return {
                success: false,
                code: 'ERR_PATCH_FILES_BATCH_INPUT_LIMIT',
                inputBytes,
                maxInputBytes: MAX_PATCH_INPUT_BYTES,
            };
        }

        /** @type {{
    path: string;
    entries: { operation: ReturnType<typeof patchOperationSchema.parse>; index: number }[];
}[]} */
        const groups = [];
        /** @type {Map<string, (typeof groups)[number]>} */
        const byPath = new Map();
        for (const [index, operation] of operations.entries()) {
            const parsed = patchOperationSchema.safeParse(operation);
            if (parsed.success === false) {
                const parseError = parsed.error;
                return {
                    success: false,
                    code: 'ERR_PATCH_FILES_BATCH_INVALID_ITEM',
                    index,
                    error: parseError instanceof Error ? parseError.message : String(parseError),
                };
            }
            const key = parsed.data.path;
            let group = byPath.get(key);
            if (!group) {
                group = { path: key, entries: [] };
                byPath.set(key, group);
                groups.push(group);
            }
            group.entries.push({ operation: parsed.data, index });
        }
        if (groups.length > MAX_PATCH_TARGETS) {
            return {
                success: false,
                code: 'ERR_PATCH_FILES_BATCH_TARGET_LIMIT',
                targetCount: groups.length,
                maxTargets: MAX_PATCH_TARGETS,
            };
        }

        const execution = await runBoundedOperationBatch(
            groups,
            async (group) => {
                const resolved = await validatePath(group.path, { mode: 'write', issueMutableCapability: true });
                if (!resolved.ok) {
                    return {
                        success: false,
                        path: group.path,
                        code: 'ERR_PATCH_FILES_BATCH_PATH',
                        error: resolved.reason ?? 'Path denied.',
                        rows: group.entries.map((entry) => ({
                            index: entry.index,
                            success: false,
                            path: group.path,
                            code: 'ERR_PATCH_FILES_BATCH_PATH',
                            error: resolved.reason ?? 'Path denied.',
                        })),
                    };
                }
                const conflicting = group.entries.find(
                    ({ operation }) => operation.replace_all === true && operation.occurrence_index !== undefined,
                );
                if (conflicting) {
                    return {
                        success: false,
                        path: group.path,
                        code: 'ERR_PATCH_CONFLICTING_MODE',
                        error: 'Use replace_all or occurrence_index, not both.',
                        rows: group.entries.map((entry) => ({
                            index: entry.index,
                            success: false,
                            path: group.path,
                            code:
                                entry.index === conflicting.index
                                    ? 'ERR_PATCH_CONFLICTING_MODE'
                                    : 'ERR_PATCH_BATCH_GROUP_ABORTED',
                        })),
                    };
                }
                try {
                    const patch = await patchBatchValidatedOrString(resolved, {
                        operations: group.entries.map(({ operation }) => ({
                            oldString: operation.old_string,
                            newString: operation.new_string,
                            replaceAll: operation.replace_all,
                            ...(operation.expected_occurrences !== undefined
                                ? { expectedOccurrences: operation.expected_occurrences }
                                : {}),
                            ...(operation.occurrence_index !== undefined
                                ? { occurrenceIndex: operation.occurrence_index }
                                : {}),
                            ...(operation.expectedHash ? { expectedHash: operation.expectedHash } : {}),
                            allowNoop: operation.allowNoop,
                            diffContextLines: operation.diffContextLines,
                            maxDiffLines: operation.maxDiffLines,
                            computeDiff: operation.includeDiffPreview,
                        })),
                        dryRun,
                        captureRollback: false,
                        ...(durability ? { durability } : {}),
                        advisoryLimits: {
                            tool: 'patch_files_batch',
                            operationCount: group.entries.length,
                            targetConcurrency,
                            dryRun,
                        },
                    });
                    const rows = group.entries.map((entry, groupIndex) => {
                        const result = /** @type {Record<string, unknown>} */ (patch.operations[groupIndex] ?? {});
                        return {
                            index: entry.index,
                            success: true,
                            path: group.path,
                            dryRun,
                            occurrences: result['occurrences'],
                            replacedOccurrences: result['replacedOccurrences'],
                            previousBytes: result['previousBytes'],
                            projectedBytes: result['projectedBytes'],
                            bytesWritten: dryRun ? 0 : groupIndex === group.entries.length - 1 ? patch.bytesWritten : 0,
                            batchBytesWritten: dryRun ? 0 : patch.bytesWritten,
                            byteDelta: result['byteDelta'],
                            lineDelta: result['lineDelta'],
                            firstMatchLine: result['firstMatchLine'],
                            lastMatchLine: result['lastMatchLine'],
                            previousHash: result['previousHash'],
                            contentHash: result['contentHash'],
                            noop: result['noop'],
                            ...(entry.operation.includeDiffPreview
                                ? {
                                      diffPreview: result['diffPreview'],
                                      diffPreviewTruncated: result['diffPreviewTruncated'],
                                  }
                                : {}),
                        };
                    });
                    return { success: true, path: group.path, rows, traceId: patch.io.traceId ?? null };
                } catch (error) {
                    const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
                    const message = error instanceof Error ? error.message : String(error);
                    return {
                        success: false,
                        path: group.path,
                        code: typeof code === 'string' ? code : 'ERR_PATCH_FILES_BATCH_EXECUTION',
                        error: message,
                        rows: group.entries.map((entry) => ({
                            index: entry.index,
                            success: false,
                            path: group.path,
                            code: typeof code === 'string' ? code : 'ERR_PATCH_FILES_BATCH_EXECUTION',
                            error: message,
                            groupAborted: true,
                        })),
                    };
                }
            },
            {
                concurrency: targetConcurrency,
                failureMode,
                maxItems: MAX_PATCH_TARGETS,
                isFailure: (value) => value.success !== true,
            },
        );

        /** @type {Record<string, unknown>[]} */
        const rows = [];
        for (const executionRow of execution.results) {
            const group = groups[executionRow.index];
            if (!group) continue;
            if (executionRow.status === 'skipped') {
                for (const entry of group.entries) {
                    rows.push({
                        index: entry.index,
                        success: false,
                        skipped: true,
                        path: group.path,
                        code: 'ERR_PATCH_FILES_BATCH_SKIPPED',
                        reason: executionRow.reason,
                    });
                }
                continue;
            }
            if ('value' in executionRow && executionRow.value) {
                rows.push(...executionRow.value.rows);
            }
        }
        rows.sort((left, right) => Number(left['index'] ?? 0) - Number(right['index'] ?? 0));
        const succeededCount = rows.filter((row) => row['success'] === true).length;
        const skippedCount = rows.filter((row) => row['skipped'] === true).length;
        const failedCount = rows.length - succeededCount - skippedCount;
        return {
            success: failedCount === 0 && skippedCount === 0,
            partial: succeededCount > 0 && (failedCount > 0 || skippedCount > 0),
            batch: true,
            dryRun,
            executionId: execution.executionId,
            failureMode: execution.failureMode,
            operationCount: operations.length,
            targetCount: groups.length,
            inputBytes,
            succeededCount,
            failedCount,
            skippedCount,
            concurrency: execution.concurrency,
            maxInFlight: execution.maxInFlight,
            durationMs: execution.durationMs,
            results: rows,
            terminalSummary: {
                operation: 'patch-batch',
                summary: `${succeededCount}/${operations.length} patches concluídos; ${failedCount} falharam; ${skippedCount} pulados; dryRun=${String(dryRun)}.`,
                nextAction:
                    failedCount > 0
                        ? 'Corrija apenas os targets falhos; patches bem-sucedidos de outros targets não precisam ser repetidos.'
                        : null,
            },
        };
    },
});
