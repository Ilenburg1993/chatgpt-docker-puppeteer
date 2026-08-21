// @ts-check
/**
 * Implementação especializada de `patch_file`.
 *
 * @module copilot/tools/file/write/patch-file
 */

import { withIoMeta } from '#copilot/core';
import { createIoOperationEnvelope } from '#copilot/infra/public/operations';
import { IO_CAPABILITY, IO_RISK, riskForDryRun } from '#copilot/infra/public/policy';
import { z } from 'zod';
import { log } from '../../infra/logger.js';
import { buildTool } from '../../infra/tool-factory.js';
import { createToolFailureResult } from '../../infra/tool-feedback.js';
import { validatePath, WORKSPACE_IO } from '../shared.js';
import {
    ADVISORY_PATCH_SEGMENT_CHARS,
    buildMutationChangeSet,
    completeAndAuditMutation,
    failAndAuditMutation,
    mutationFailureResult,
    pathFailureResult,
} from './mutation-helpers.js';
import { buildPatchFailureTerminalSummary, PATCH_FEEDBACK_FIX } from './patch-feedback.js';

const { patchTextLocked, patchTextLockedValidated } = WORKSPACE_IO;

/**
 * Dispatch a patch through the validated mutable fast path when available, otherwise preserve the canonical string
 * path.
 *
 * @param {{ resolved: string; validatedWritePath?: import('#copilot/infra/public/composition/workspace/authority').ValidatedMutableWorkspacePath }} target
 * @param {Parameters<typeof patchTextLocked>[1]} options
 */
function patchValidatedOrString(target, options) {
    return target.validatedWritePath
        ? patchTextLockedValidated(target.validatedWritePath, options)
        : patchTextLocked(target.resolved, options);
}

/**
 * @param {{
 *     path: string;
 *     dryRun: boolean;
 *     replacedOccurrences: number;
 *     occurrences: number;
 *     byteDelta: number;
 *     lineDelta: number;
 *     firstMatchLine: number | null;
 *     lastMatchLine: number | null;
 *     diffPreviewTruncated: boolean;
 *     previousHash?: string | null;
 *     contentHash?: string | null;
 * }} input
 * @returns {{
 *     operation: 'patch';
 *     path: string;
 *     dryRun: boolean;
 *     summary: string;
 *     nextAction: string | null;
 *     changed: boolean;
 *     hashes: { previousHash: string | null; contentHash: string | null };
 * }}
 */
function buildPatchTerminalSummary(input) {
    const status = input.dryRun ? 'Patch validado em dry-run' : 'Patch aplicado';
    const lines =
        input.firstMatchLine !== null
            ? ` · linhas ${input.firstMatchLine}-${input.lastMatchLine ?? input.firstMatchLine}`
            : '';
    const diff = input.diffPreviewTruncated ? ' · diff truncado' : '';
    const delta = ` · ${input.byteDelta >= 0 ? '+' : ''}${input.byteDelta} bytes · ${
        input.lineDelta >= 0 ? '+' : ''
    }${input.lineDelta} linhas`;
    const summary = `${status}: ${input.replacedOccurrences}/${input.occurrences} ocorrencias${lines}${delta}${diff}`;
    const nextAction = input.dryRun
        ? 'Se o diffPreview estiver correto, repita a chamada com dryRun=false e expectedHash preservado quando disponível.'
        : 'Use previousHash/contentHash para auditoria; não afirme mudanças adicionais sem nova tool.';
    return {
        operation: 'patch',
        path: input.path,
        dryRun: input.dryRun,
        summary,
        nextAction,
        changed: input.replacedOccurrences > 0 && !input.dryRun,
        hashes: {
            previousHash: input.previousHash ?? null,
            contentHash: input.contentHash ?? null,
        },
    };
}

/**
 * @param {string} message
 * @param {keyof typeof PATCH_FEEDBACK_FIX} code
 * @param {Record<string, unknown>} receivedParameters
 * @param {Record<string, unknown>} details
 * @returns {{
 *     success: false;
 *     error: string;
 *     toolFeedback: import('../../infra/tool-feedback.js').ToolFailureFeedback;
 * } & Record<string, unknown>}
 */
function createPatchValidationFailure(message, code, receivedParameters, details) {
    const terminalSummary = buildPatchFailureTerminalSummary(code, message, details, receivedParameters);
    return createToolFailureResult({
        toolName: 'patch_file',
        message,
        category: 'invalid-parameters',
        fix: PATCH_FEEDBACK_FIX[code],
        receivedParameters,
        details: { ...details, code },
        extra: {
            code,
            operationName: 'patch',
            terminalSummary,
            llmNextAction: terminalSummary.nextAction,
            presentation: {
                operation: 'patch',
                path: terminalSummary.path,
                targetKinds: ['file'],
                status: 'failed',
                summary: terminalSummary.summary,
            },
        },
    });
}

/**
 * Tool: patch_file — edição cirúrgica por substituição de string exata.
 */
export const patchFileTool = buildTool({
    name: 'patch_file',
    description:
        'Aplica uma substituição cirúrgica num arquivo: substitui `old_string` por `new_string`. ' +
        '`old_string` deve ser literal e, por padrão, ocorrer exatamente uma vez. ' +
        'Para matches repetidos, use occurrence_index para uma ocorrência específica ou replace_all com expected_occurrences.',
    instructions:
        'Use patch_file for surgical exact-string edits after reading the current file. Prefer expectedHash from ' +
        'read_file_content when available. Use dryRun=true for risky edits, repeated matches or operator-visible ' +
        'planning, then apply the same patch when validated. Provide enough context in old_string for uniqueness; use ' +
        'occurrence_index or replace_all with expected_occurrences for repeated text. Do not use patch_file for ' +
        'full-file rewrites; use write_file_content only when replacing the whole file is truly intended. Do not claim ' +
        'an edit was applied until dryRun=false returns success.',
    parameters: z.object({
        path: z.string()['describe']('Caminho do arquivo (relativo ao workspace ou absoluto)'),
        old_string: z
            .string()
            .min(1)
            ['describe']('Texto exato a substituir. Deve ocorrer exatamente 1 vez no arquivo.'),
        new_string: z.string()['describe']('Texto de substituição (pode ser string vazia para deletar)'),
        replace_all: z
            .boolean()
            .optional()
            .default(false)
            ['describe']('Se true, substitui todas as ocorrências de old_string.'),
        expected_occurrences: z
            .number()
            .int()
            .min(1)
            .optional()
            ['describe']('Se definido, força contagem exata esperada de ocorrências antes de aplicar o patch.'),
        occurrence_index: z
            .number()
            .int()
            .min(1)
            .optional()
            ['describe']('Índice 1-based da ocorrência a substituir quando old_string aparece múltiplas vezes.'),
        expectedHash: z
            .string()
            .optional()
            ['describe']('SHA-256 esperado do conteúdo atual. Se o arquivo mudou, o patch falha sem aplicar.'),
        dryRun: z
            .boolean()
            .optional()
            .default(false)
            ['describe']('Se true, valida e calcula o patch sem escrever no disco.'),
        allowNoop: z
            .boolean()
            .optional()
            .default(false)
            ['describe']('Se true, permite old_string e new_string iguais para validar match sem mudança.'),
        diffContextLines: z
            .number()
            .int()
            .min(0)
            .max(20)
            .optional()
            .default(3)
            ['describe']('Linhas de contexto no diffPreview retornado.'),
        maxDiffLines: z
            .number()
            .int()
            .min(1)
            .max(500)
            .optional()
            .default(160)
            ['describe']('Máximo de linhas no diffPreview retornado.'),
        durability: z
            .enum(['file-and-directory', 'file', 'none'])
            .optional()
            ['describe'](
                'Perfil de persistência após crash; default file-and-directory. Não altera atomicidade ou preconditions.',
            ),
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
        durability,
    }) => {
        const v = await validatePath(filePath, { mode: 'write', issueMutableCapability: true });
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
            durability,
        };
        if (!v.ok) {
            return pathFailureResult('patch_file', v.reason ?? 'Caminho inválido.', receivedParameters);
        }
        if (typeof old_string !== 'string' || old_string.length === 0) {
            return createPatchValidationFailure(
                'old_string deve ser uma string não vazia.',
                'ERR_PATCH_INVALID_OLD_STRING',
                receivedParameters,
                { path: v.resolved },
            );
        }
        if (replace_all && occurrence_index !== undefined) {
            return createPatchValidationFailure(
                'Use replace_all ou occurrence_index, não ambos na mesma chamada.',
                'ERR_PATCH_CONFLICTING_MODE',
                receivedParameters,
                { path: v.resolved },
            );
        }
        const operation = createIoOperationEnvelope({
            capability: IO_CAPABILITY.filePatch,
            riskClass: riskForDryRun(dryRun, IO_RISK.high),
            targets: [v.resolved],
            evidence: { tool: 'patch_file', replaceAll: replace_all, occurrenceIndex: occurrence_index, dryRun },
        });

        try {
            const patchResult = await patchValidatedOrString(v, {
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
                ...(durability ? { durability } : {}),
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
            const terminalSummary = buildPatchTerminalSummary({
                path: v.resolved,
                dryRun: patchResult.dryRun,
                replacedOccurrences: patchResult.replacedOccurrences,
                occurrences: patchResult.occurrences,
                byteDelta: patchResult.byteDelta,
                lineDelta: patchResult.lineDelta,
                firstMatchLine: patchResult.firstMatchLine,
                lastMatchLine: patchResult.lastMatchLine,
                diffPreviewTruncated: patchResult.diffPreviewTruncated,
                previousHash: patchResult.previousHash,
                contentHash: patchResult.contentHash,
            });
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
                    operationName: 'patch',
                    terminalSummary,
                    llmNextAction: terminalSummary.nextAction,
                    presentation: {
                        operation: 'patch',
                        path: v.resolved,
                        targetKinds: ['file'],
                        status: dryRun ? 'dry-run' : 'completed',
                        summary: terminalSummary.summary,
                    },
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
                            bytes: patchResult.previousBytes,
                            snapshotBase64: patchResult.previousSnapshotBase64,
                            snapshotSidecar: patchResult.previousRollbackSidecar,
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
