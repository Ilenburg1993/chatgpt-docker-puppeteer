// @ts-check
/**
 * Implementação especializada de `patch_file`.
 *
 * @module copilot/tools/file/write/patch-file
 */

import { patchTextLocked } from '#copilot/infra/public/io';
import { IO_CAPABILITY, IO_RISK, riskForDryRun } from '#copilot/infra/public/policy';
import { createIoOperationEnvelope } from '#copilot/infra/public/runtime';
import { z } from 'zod';
import { withIoMeta } from '#copilot/core';
import { log } from '../../infra/logger.js';
import { buildTool } from '../../infra/tool-factory.js';
import { createToolFailureResult } from '../../infra/tool-feedback.js';
import { validatePath } from '../shared.js';
import {
    ADVISORY_PATCH_SEGMENT_CHARS,
    buildMutationChangeSet,
    completeAndAuditMutation,
    failAndAuditMutation,
    mutationFailureResult,
    pathFailureResult,
} from './mutation-helpers.js';
import { PATCH_FEEDBACK_FIX } from './patch-feedback.js';

/**
 * Tool: patch_file — edição cirúrgica por substituição de string exata.
 */
export const patchFileTool = buildTool({
    name: 'patch_file',
    description:
        'Aplica uma substituição cirúrgica num arquivo: substitui `old_string` por `new_string`. ' +
        '`old_string` deve ser literal e, por padrão, ocorrer exatamente uma vez. ' +
        'Para matches repetidos, use occurrence_index para uma ocorrência específica ou replace_all com expected_occurrences.',
    parameters: z.object({
        path: z.string().describe('Caminho do arquivo (relativo ao workspace ou absoluto)'),
        old_string: z.string().min(1).describe('Texto exato a substituir. Deve ocorrer exatamente 1 vez no arquivo.'),
        new_string: z.string().describe('Texto de substituição (pode ser string vazia para deletar)'),
        replace_all: z
            .boolean()
            .optional()
            .default(false)
            .describe('Se true, substitui todas as ocorrências de old_string.'),
        expected_occurrences: z
            .number()
            .int()
            .min(1)
            .optional()
            .describe('Se definido, força contagem exata esperada de ocorrências antes de aplicar o patch.'),
        occurrence_index: z
            .number()
            .int()
            .min(1)
            .optional()
            .describe('Índice 1-based da ocorrência a substituir quando old_string aparece múltiplas vezes.'),
        expectedHash: z
            .string()
            .optional()
            .describe('SHA-256 esperado do conteúdo atual. Se o arquivo mudou, o patch falha sem aplicar.'),
        dryRun: z
            .boolean()
            .optional()
            .default(false)
            .describe('Se true, valida e calcula o patch sem escrever no disco.'),
        allowNoop: z
            .boolean()
            .optional()
            .default(false)
            .describe('Se true, permite old_string e new_string iguais para validar match sem mudança.'),
        diffContextLines: z
            .number()
            .int()
            .min(0)
            .max(20)
            .optional()
            .default(3)
            .describe('Linhas de contexto no diffPreview retornado.'),
        maxDiffLines: z
            .number()
            .int()
            .min(1)
            .max(500)
            .optional()
            .default(160)
            .describe('Máximo de linhas no diffPreview retornado.'),
    }),
    handler: async ({
        path: filePath,
        old_string,
        new_string,
        replace_all,
        expected_occurrences,
        occurrence_index,
        expectedHash,
        dryRun,
        allowNoop,
        diffContextLines,
        maxDiffLines,
    }) => {
        const v = await validatePath(filePath, { mode: 'write' });
        const receivedParameters = {
            path: filePath,
            old_string,
            new_string,
            replace_all,
            expected_occurrences,
            occurrence_index,
            expectedHash,
            dryRun,
            allowNoop,
            diffContextLines,
            maxDiffLines,
        };
        if (!v.ok) {
            return pathFailureResult('patch_file', v.reason ?? 'Caminho inválido.', receivedParameters);
        }
        if (typeof old_string !== 'string' || old_string.length === 0) {
            return createToolFailureResult({
                toolName: 'patch_file',
                message: 'old_string deve ser uma string não vazia.',
                category: 'invalid-parameters',
                fix: PATCH_FEEDBACK_FIX.ERR_PATCH_INVALID_OLD_STRING,
                receivedParameters,
                details: { path: v.resolved, code: 'ERR_PATCH_INVALID_OLD_STRING' },
                extra: { code: 'ERR_PATCH_INVALID_OLD_STRING' },
            });
        }
        if (replace_all && occurrence_index !== undefined) {
            return createToolFailureResult({
                toolName: 'patch_file',
                message: 'Use replace_all ou occurrence_index, não ambos na mesma chamada.',
                category: 'invalid-parameters',
                fix: PATCH_FEEDBACK_FIX.ERR_PATCH_CONFLICTING_MODE,
                receivedParameters,
                details: { path: v.resolved, code: 'ERR_PATCH_CONFLICTING_MODE' },
                extra: { code: 'ERR_PATCH_CONFLICTING_MODE' },
            });
        }
        const operation = createIoOperationEnvelope({
            capability: IO_CAPABILITY.filePatch,
            riskClass: riskForDryRun(dryRun, IO_RISK.high),
            targets: [v.resolved],
            evidence: { tool: 'patch_file', replaceAll: replace_all, occurrenceIndex: occurrence_index, dryRun },
        });

        try {
            const patchResult = await patchTextLocked(v.resolved, {
                oldString: old_string,
                newString: new_string,
                replaceAll: replace_all,
                expectedOccurrences: expected_occurrences,
                occurrenceIndex: occurrence_index,
                ...(expectedHash ? { expectedHash } : {}),
                dryRun,
                allowNoop,
                diffContextLines,
                maxDiffLines,
                advisoryLimits: {
                    advisoryPatchSegmentChars: ADVISORY_PATCH_SEGMENT_CHARS,
                    oldStringChars: old_string.length,
                    newStringChars: new_string.length,
                    expectedHash: expectedHash ?? null,
                    dryRun,
                    occurrenceIndex: occurrence_index ?? null,
                    replaceAll: Boolean(replace_all),
                    limitMode: 'informative',
                },
            });
            log('INFO', `[copilot/patch_file] Patch ${dryRun ? 'simulado' : 'aplicado'}: ${v.resolved}`);
            return withIoMeta(
                {
                    success: true,
                    path: v.resolved,
                    dryRun: patchResult.dryRun,
                    occurrences: patchResult.occurrences,
                    replacedOccurrences: patchResult.replacedOccurrences,
                    projectedBytes: patchResult.projectedBytes,
                    previousBytes: patchResult.previousBytes,
                    byteDelta: patchResult.byteDelta,
                    firstMatchLine: patchResult.firstMatchLine,
                    lastMatchLine: patchResult.lastMatchLine,
                    lineDelta: patchResult.lineDelta,
                    occurrenceIndex: patchResult.occurrenceIndex,
                    noop: patchResult.noop,
                    diffPreview: patchResult.diffPreview,
                    diffPreviewTruncated: patchResult.diffPreviewTruncated,
                    diffPreviewLines: patchResult.diffPreviewLines,
                    diffPreviewBytes: patchResult.diffPreviewBytes,
                    diffContextLines: patchResult.diffContextLines,
                    previousHash: patchResult.previousHash,
                    contentHash: patchResult.contentHash,
                    operation: await completeAndAuditMutation(
                        operation,
                        {
                            status: dryRun ? 'dry-run' : 'applied',
                            traceId: patchResult.io.traceId ?? null,
                            evidence: {
                                dryRun,
                                occurrences: patchResult.occurrences,
                                replacedOccurrences: patchResult.replacedOccurrences,
                                projectedBytes: patchResult.projectedBytes,
                                byteDelta: patchResult.byteDelta,
                                firstMatchLine: patchResult.firstMatchLine,
                                lastMatchLine: patchResult.lastMatchLine,
                                previousHash: patchResult.previousHash,
                                contentHash: patchResult.contentHash,
                            },
                        },
                        { tool: 'patch_file', io: patchResult.io, result: { path: v.resolved, dryRun } },
                    ),
                    changeSet: buildMutationChangeSet({
                        capability: IO_CAPABILITY.filePatch,
                        riskClass: riskForDryRun(dryRun, IO_RISK.high),
                        traceId: patchResult.io.traceId ?? null,
                        action: 'patch',
                        targets: [v.resolved],
                        rollback: {
                            action: 'write',
                            target: v.resolved,
                            previousHash: patchResult.previousHash,
                            contentHash: patchResult.contentHash,
                            bytes: patchResult.projectedBytes,
                            snapshotBase64: patchResult.previousSnapshotBase64,
                        },
                        dryRun,
                        evidence: {
                            tool: 'patch_file',
                            dryRun,
                            occurrenceIndex: patchResult.occurrenceIndex,
                            replacedOccurrences: patchResult.replacedOccurrences,
                        },
                    }),
                },
                patchResult.io,
            );
        } catch (e) {
            const failedOperation = await failAndAuditMutation(operation, e, { tool: 'patch_file' });
            return mutationFailureResult(
                'patch_file',
                e,
                receivedParameters,
                { path: v.resolved },
                { operation: failedOperation },
            );
        }
    },
});
