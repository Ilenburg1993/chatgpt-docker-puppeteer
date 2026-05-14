// @ts-check
/**
 * src/copilot/tools/file/write-tools.js
 *
 * Tools de escrita do filesystem: write_file_content, create_file, delete_file, copy_file, move_file, patch_file.
 *
 * @module copilot/tools/file/write-tools
 * @see EventBus
 * @see module:copilot/tools/file/shared
 */

import {
    copyFileLocked,
    createOrReplaceFileAtomic,
    deleteFileLocked,
    moveFileLocked,
    patchTextLocked,
    writeFileAtomic,
} from '#copilot/infra/public/io';
import {
    IO_CAPABILITY,
    IO_RISK,
    capabilityForCreate,
    riskForDryRun,
    riskForOverwrite,
} from '#copilot/infra/public/policy';
import {
    abortIoChangeSet,
    appendIoChangeSetEntry,
    applyIoChangeSet,
    beginIoChangeSet,
    completeIoOperationEnvelope,
    createIoOperationEnvelope,
    createIoRollbackToken,
    failIoOperationEnvelope,
    recordIoMutationAudit,
    serializeIoRollbackToken,
} from '#copilot/infra/public/runtime';
import { z } from 'zod';
import { toError } from '../../core/error-handlers.js';
import { withIoMeta } from '../../core/io-contracts.js';
import { log } from '../infra/logger.js';
import { buildTool } from '../infra/tool-factory.js';
import { createToolFailureResult } from '../infra/tool-feedback.js';
import { validatePath } from './shared.js';

const ADVISORY_WRITE_CONTENT_BYTES = 2 * 1024 * 1024;
const ADVISORY_PATCH_SEGMENT_CHARS = 200_000;

const PATCH_FEEDBACK_FIX = /** @type {const} */ ({
    ERR_PATCH_INVALID_OLD_STRING:
        'Envie old_string não vazio, copiado literalmente do conteúdo lido mais recentemente.',
    ERR_PATCH_INVALID_NEW_STRING: 'Envie new_string como string; use string vazia apenas quando quiser deletar texto.',
    ERR_PATCH_NOOP: 'Altere new_string para produzir diferença real, ou use allowNoop=true quando quiser registrar dry-run/no-op.',
    ERR_PATCH_NOT_FOUND:
        'Releia o arquivo com read_file_content, copie um trecho atual e inclua contexto suficiente em old_string.',
    ERR_PATCH_EXPECTED_OCCURRENCES:
        'Releia o arquivo e ajuste expected_occurrences, ou refine old_string para o número exato de matches desejado.',
    ERR_PATCH_AMBIGUOUS_MATCH:
        'Refine old_string com mais contexto, use occurrence_index para escolher a ocorrência, ou use replace_all com expected_occurrences.',
    ERR_PATCH_CONFLICTING_MODE: 'Escolha apenas um modo: replace_all para todos os matches ou occurrence_index para um match específico.',
    ERR_PATCH_INVALID_OCCURRENCE_INDEX: 'Use occurrence_index inteiro e baseado em 1.',
    ERR_PATCH_OCCURRENCE_INDEX_OUT_OF_RANGE: 'Releia o arquivo e use occurrence_index dentro da contagem de matches atual.',
    EEXPECTEDHASH: 'O arquivo mudou desde a leitura anterior. Releia o arquivo, atualize expectedHash e tente novamente.',
});

const PATCH_FEEDBACK_CATEGORY = /** @type {const} */ ({
    ERR_PATCH_INVALID_OLD_STRING: 'invalid-parameters',
    ERR_PATCH_INVALID_NEW_STRING: 'invalid-parameters',
    ERR_PATCH_NOOP: 'invalid-parameters',
    ERR_PATCH_NOT_FOUND: 'not-found',
    ERR_PATCH_EXPECTED_OCCURRENCES: 'conflict',
    ERR_PATCH_AMBIGUOUS_MATCH: 'invalid-parameters',
    ERR_PATCH_CONFLICTING_MODE: 'invalid-parameters',
    ERR_PATCH_INVALID_OCCURRENCE_INDEX: 'invalid-parameters',
    ERR_PATCH_OCCURRENCE_INDEX_OUT_OF_RANGE: 'invalid-parameters',
    EEXPECTEDHASH: 'conflict',
});

/**
 * @param {ReturnType<typeof createIoOperationEnvelope>} operation
 * @param {{
 *     status?: 'planned' | 'applied' | 'failed' | 'dry-run';
 *     traceId?: string | null;
 *     evidence?: Record<string, unknown>;
 * }} result
 * @param {{
 *     tool: string;
 *     io?: import('../../core/io-contracts.js').IoMeta | null;
 *     result?: Record<string, unknown>;
 * }} auditContext
 */
async function completeAndAuditMutation(operation, result, auditContext) {
    const completed = completeIoOperationEnvelope(operation, result);
    const audit = await recordIoMutationAudit(completed, auditContext);
    return audit.enabled
        ? {
              ...completed,
              evidence: { ...completed.evidence, auditLog: audit },
          }
        : completed;
}

/**
 * @param {ReturnType<typeof createIoOperationEnvelope>} operation
 * @param {unknown} error
 * @param {{
 *     tool: string;
 *     io?: import('../../core/io-contracts.js').IoMeta | null;
 *     result?: Record<string, unknown>;
 * }} auditContext
 */
async function failAndAuditMutation(operation, error, auditContext) {
    const failed = failIoOperationEnvelope(operation, error);
    const audit = await recordIoMutationAudit(failed, auditContext);
    return audit.enabled
        ? {
              ...failed,
              evidence: { ...failed.evidence, auditLog: audit },
          }
        : failed;
}

/**
 * @param {{
 *     capability: string;
 *     riskClass: import('../../core/io-contracts.js').IoRiskClass;
 *     traceId?: string | null;
 *     action?: 'write' | 'patch' | 'delete' | 'copy' | 'move';
 *     targets?: string[];
 *     rollback?: {
 *         action: 'write' | 'patch' | 'delete' | 'copy' | 'move';
 *         target: string;
 *         previousHash?: string | null;
 *         contentHash?: string | null;
 *         bytes?: number | null;
 *         snapshotBase64?: string | null;
 *     } | null;
 *     entries?: {
 *         action: 'write' | 'patch' | 'delete' | 'copy' | 'move';
 *         targets: string[];
 *         rollback: {
 *             action: 'write' | 'patch' | 'delete' | 'copy' | 'move';
 *             target: string;
 *             previousHash?: string | null;
 *             contentHash?: string | null;
 *             bytes?: number | null;
 *             snapshotBase64?: string | null;
 *         } | null;
 *         evidence?: Record<string, unknown>;
 *     }[];
 *     dryRun?: boolean;
 *     evidence?: Record<string, unknown>;
 * }} input
 */
function buildMutationChangeSet(input) {
    /**
     * @type {{
     *     action: 'write' | 'patch' | 'delete' | 'copy' | 'move';
     *     targets: string[];
     *     rollback: {
     *         action: 'write' | 'patch' | 'delete' | 'copy' | 'move';
     *         target: string;
     *         previousHash?: string | null;
     *         contentHash?: string | null;
     *         bytes?: number | null;
     *         snapshotBase64?: string | null;
     *     } | null;
     *     evidence?: Record<string, unknown>;
     * }[]}
     */
    const entries = [];

    if (Array.isArray(input.entries) && input.entries.length > 0) {
        entries.push(...input.entries);
    } else if (input.action && Array.isArray(input.targets) && input.targets.length > 0) {
        entries.push({
            action: input.action,
            targets: input.targets,
            rollback: input.rollback ?? null,
            evidence: { ...(input.evidence ?? {}) },
        });
    }

    let changeSet = beginIoChangeSet({
        capability: input.capability,
        riskClass: input.riskClass,
        targets: entries.flatMap((entry) => entry.targets),
        ...(input.traceId === undefined ? {} : { traceId: input.traceId }),
        evidence: { ...(input.evidence ?? {}) },
    });

    for (const entry of entries) {
        changeSet = appendIoChangeSetEntry(changeSet, {
            action: entry.action,
            targets: entry.targets,
            rollback: entry.rollback ?? null,
            evidence: { ...(entry.evidence ?? input.evidence ?? {}) },
        });
    }

    changeSet = input.dryRun
        ? abortIoChangeSet(changeSet, 'dry-run')
        : applyIoChangeSet(changeSet, {
              ...(input.traceId === undefined ? {} : { traceId: input.traceId }),
              evidence: { ...(input.evidence ?? {}) },
          });

    const rollbackToken = createIoRollbackToken(changeSet);
    return {
        id: changeSet.changeSetId,
        status: changeSet.status,
        entryCount: changeSet.entries.length,
        rollback: {
            token: serializeIoRollbackToken(rollbackToken),
            stepCount: rollbackToken.stepCount,
            steps: rollbackToken.steps,
        },
    };
}

/**
 * @param {unknown} error
 * @returns {string | undefined}
 */
function readErrorCode(error) {
    if (!error || typeof error !== 'object') return undefined;
    const code = /** @type {Record<string, unknown>} */ (error)['code'];
    return typeof code === 'string' ? code : undefined;
}

/**
 * @param {unknown} error
 * @returns {Record<string, unknown>}
 */
function readErrorDetails(error) {
    if (!error || typeof error !== 'object') return {};
    const details = /** @type {Record<string, unknown>} */ (error)['details'];
    return details && typeof details === 'object' && !Array.isArray(details)
        ? /** @type {Record<string, unknown>} */ (details)
        : {};
}

/**
 * @param {string} reason
 * @returns {import('../infra/tool-feedback.js').ToolFailureCategory}
 */
function classifyPathFailure(reason) {
    return /vazio|byte nulo|null byte|inválid|invalid|malformad/i.test(reason)
        ? 'invalid-parameters'
        : 'policy-denied';
}

/**
 * @param {string} toolName
 * @param {string} reason
 * @param {Record<string, unknown>} receivedParameters
 * @param {Record<string, unknown>} [details]
 */
function pathFailureResult(toolName, reason, receivedParameters, details = {}) {
    return createToolFailureResult({
        toolName,
        message: reason,
        category: classifyPathFailure(reason),
        fix: 'Use um caminho válido dentro do workspace e tente novamente.',
        receivedParameters,
        details,
    });
}

/**
 * @param {unknown} error
 * @returns {import('../infra/tool-feedback.js').ToolFailureCategory | undefined}
 */
function patchFailureCategory(error) {
    const code = readErrorCode(error);
    if (!code) return undefined;
    return PATCH_FEEDBACK_CATEGORY[/** @type {keyof typeof PATCH_FEEDBACK_CATEGORY} */ (code)];
}

/**
 * @param {unknown} error
 * @returns {string | undefined}
 */
function patchFailureFix(error) {
    const code = readErrorCode(error);
    if (!code) return undefined;
    return PATCH_FEEDBACK_FIX[/** @type {keyof typeof PATCH_FEEDBACK_FIX} */ (code)];
}

/**
 * @param {string} toolName
 * @param {unknown} error
 * @param {Record<string, unknown>} receivedParameters
 * @param {Record<string, unknown>} extraDetails
 * @param {Record<string, unknown>} [extra]
 */
function mutationFailureResult(toolName, error, receivedParameters, extraDetails, extra = {}) {
    const e = toError(error);
    const code = readErrorCode(error);
    const category = toolName === 'patch_file' ? patchFailureCategory(error) : undefined;
    const fix = toolName === 'patch_file' ? patchFailureFix(error) : undefined;
    return createToolFailureResult({
        toolName,
        error,
        ...(category ? { category } : {}),
        ...(fix ? { fix } : {}),
        receivedParameters,
        details: {
            ...(code ? { code } : {}),
            ...readErrorDetails(error),
            ...extraDetails,
        },
        extra: {
            ...extra,
            ...(code ? { code } : {}),
            error: toolName === 'patch_file' ? e.message : e.message,
        },
    });
}

// ---------------------------------------------------------------------------
// Tool: write_file_content
// ---------------------------------------------------------------------------

/**
 * Tool: write_file_content — escreve conteúdo em um arquivo existente.
 */
const writeFileContentTool = buildTool({
    name: 'write_file_content',
    description:
        'Escreve conteúdo em um arquivo existente no workspace. ' +
        'Sobrescreve o conteúdo completo; use create_file para arquivos novos e expectedHash para precondição otimista.',
    parameters: z.object({
        path: z.string().describe('Caminho do arquivo (deve existir)'),
        content: z.string().describe('Novo conteúdo completo do arquivo'),
        encoding: z
            .enum(['utf8', 'base64'])
            .optional()
            .default('utf8')
            .describe('Codificação do conteúdo (utf8 para texto, base64 para binário)'),
        expectedHash: z
            .string()
            .optional()
            .describe('SHA-256 esperado do conteúdo atual. Se o arquivo mudou, a escrita falha sem aplicar.'),
    }),
    handler: async ({ path: filePath, content, encoding, expectedHash }) => {
        const { ok, reason, resolved } = await validatePath(filePath, { mode: 'write' });
        if (!ok) {
            return pathFailureResult('write_file_content', reason ?? 'Caminho inválido.', {
                path: filePath,
                encoding,
                expectedHash,
            });
        }

        log('INFO', `[copilot/write_file_content] ${resolved}`);
        const operation = createIoOperationEnvelope({
            capability: IO_CAPABILITY.fileWrite,
            riskClass: IO_RISK.high,
            targets: [resolved],
            evidence: { tool: 'write_file_content' },
        });

        try {
            const buf = encoding === 'base64' ? Buffer.from(content, 'base64') : Buffer.from(content, 'utf8');
            const writeResult = await writeFileAtomic(resolved, buf, {
                requireExists: true,
                ...(expectedHash ? { expectedHash } : {}),
                riskClass: IO_RISK.high,
                advisoryLimits: {
                    advisoryWriteContentBytes: ADVISORY_WRITE_CONTENT_BYTES,
                    contentBytes: buf.byteLength,
                    expectedHash: expectedHash ?? null,
                    limitMode: 'informative',
                },
            });
            return withIoMeta(
                {
                    success: true,
                    path: resolved,
                    bytesWritten: buf.length,
                    previousHash: writeResult.previousHash,
                    contentHash: writeResult.contentHash,
                    operation: await completeAndAuditMutation(
                        operation,
                        {
                            traceId: writeResult.io.traceId ?? null,
                            evidence: {
                                bytesWritten: buf.length,
                                previousHash: writeResult.previousHash,
                                contentHash: writeResult.contentHash,
                            },
                        },
                        { tool: 'write_file_content', io: writeResult.io, result: { path: resolved } },
                    ),
                    changeSet: buildMutationChangeSet({
                        capability: IO_CAPABILITY.fileWrite,
                        riskClass: IO_RISK.high,
                        traceId: writeResult.io.traceId ?? null,
                        action: 'write',
                        targets: [resolved],
                        rollback: {
                            action: 'write',
                            target: resolved,
                            previousHash: writeResult.previousHash,
                            contentHash: writeResult.contentHash,
                            bytes: buf.length,
                        },
                        evidence: { tool: 'write_file_content' },
                    }),
                },
                writeResult.io,
            );
        } catch (err) {
            const failedOperation = await failAndAuditMutation(operation, err, { tool: 'write_file_content' });
            return mutationFailureResult(
                'write_file_content',
                err,
                { path: filePath, encoding, expectedHash },
                { path: resolved },
                { operation: failedOperation },
            );
        }
    },
});

// ---------------------------------------------------------------------------
// Tool: create_file
// ---------------------------------------------------------------------------

/**
 * Tool: create_file — cria um novo arquivo com conteúdo opcional.
 */
const createFileTool = buildTool({
    name: 'create_file',
    description:
        'Cria um novo arquivo no workspace com conteúdo opcional. ' +
        'Por padrão falha se o arquivo já existe; use overwrite=true somente quando quiser substituir.',
    parameters: z.object({
        path: z.string().describe('Caminho do arquivo a criar'),
        content: z.string().optional().default('').describe('Conteúdo inicial do arquivo'),
        createParentDirs: z
            .boolean()
            .optional()
            .default(true)
            .describe('Se true, cria diretórios intermediários se não existirem'),
        overwrite: z
            .boolean()
            .optional()
            .default(false)
            .describe('Se true, sobrescreve o arquivo se já existir (⚠️ destrutivo)'),
    }),
    handler: async ({ path: filePath, content, createParentDirs, overwrite }) => {
        const { ok, reason, resolved } = await validatePath(filePath, { mode: 'write' });
        if (!ok) {
            return pathFailureResult('create_file', reason ?? 'Caminho inválido.', {
                path: filePath,
                createParentDirs,
                overwrite,
            });
        }

        log('INFO', `[copilot/create_file] ${resolved}`);
        const riskClass = riskForOverwrite(overwrite);
        const operation = createIoOperationEnvelope({
            capability: capabilityForCreate(overwrite),
            riskClass,
            targets: [resolved],
            evidence: { tool: 'create_file', overwrite },
        });

        try {
            const contentBytes = Buffer.byteLength(content ?? '', 'utf8');
            const writeResult = await createOrReplaceFileAtomic(resolved, content ?? '', {
                encoding: 'utf8',
                createParentDirs,
                failIfExists: !overwrite,
                riskClass,
                advisoryLimits: {
                    advisoryWriteContentBytes: ADVISORY_WRITE_CONTENT_BYTES,
                    contentBytes,
                    limitMode: 'informative',
                },
            });
            return withIoMeta(
                {
                    success: true,
                    path: resolved,
                    bytesWritten: writeResult.bytesWritten,
                    operation: await completeAndAuditMutation(
                        operation,
                        {
                            traceId: writeResult.io.traceId ?? null,
                            evidence: { bytesWritten: writeResult.bytesWritten },
                        },
                        { tool: 'create_file', io: writeResult.io, result: { path: resolved } },
                    ),
                    changeSet: buildMutationChangeSet({
                        capability: capabilityForCreate(overwrite),
                        riskClass,
                        traceId: writeResult.io.traceId ?? null,
                        action: 'write',
                        targets: [resolved],
                        rollback: {
                            action: 'delete',
                            target: resolved,
                            previousHash: writeResult.previousHash,
                            contentHash: writeResult.contentHash,
                            bytes: writeResult.bytesWritten,
                        },
                        evidence: { tool: 'create_file', overwrite },
                    }),
                },
                writeResult.io,
            );
        } catch (err) {
            const failedOperation = await failAndAuditMutation(operation, err, { tool: 'create_file' });
            return mutationFailureResult(
                'create_file',
                err,
                { path: filePath, createParentDirs, overwrite },
                { path: resolved },
                { operation: failedOperation },
            );
        }
    },
});

// ---------------------------------------------------------------------------
// Tool: delete_file
// ---------------------------------------------------------------------------

/**
 * Tool: delete_file — deleta um arquivo do workspace.
 */
const deleteFileTool = buildTool({
    name: 'delete_file',
    description: 'Deleta um arquivo do workspace. Não opera sobre diretórios e retorna snapshot de rollback quando possível.',
    parameters: z.object({
        path: z.string().describe('Caminho do arquivo a deletar'),
    }),
    handler: async ({ path: filePath }) => {
        const { ok, reason, resolved } = await validatePath(filePath, { mode: 'write' });
        if (!ok) {
            return pathFailureResult('delete_file', reason ?? 'Caminho inválido.', { path: filePath });
        }

        log('INFO', `[copilot/delete_file] ${resolved}`);
        const operation = createIoOperationEnvelope({
            capability: IO_CAPABILITY.fileDelete,
            riskClass: IO_RISK.high,
            targets: [resolved],
            evidence: { tool: 'delete_file' },
        });

        try {
            const deleted = await deleteFileLocked(resolved);
            return {
                success: true,
                ...deleted,
                operation: await completeAndAuditMutation(
                    operation,
                    {
                        traceId: deleted.io?.traceId ?? null,
                        evidence: {
                            deleted: true,
                            previousHash: deleted.previousHash,
                            previousBytes: deleted.previousBytes,
                        },
                    },
                    { tool: 'delete_file', io: deleted.io, result: { path: resolved } },
                ),
                changeSet: buildMutationChangeSet({
                    capability: IO_CAPABILITY.fileDelete,
                    riskClass: IO_RISK.high,
                    traceId: deleted.io?.traceId ?? null,
                    action: 'delete',
                    targets: [resolved],
                    rollback: {
                        action: 'write',
                        target: resolved,
                        previousHash: deleted.previousHash,
                        bytes: deleted.previousBytes,
                        snapshotBase64: deleted.previousSnapshotBase64,
                    },
                    evidence: { tool: 'delete_file' },
                }),
            };
        } catch (err) {
            const e = /** @type {{ code?: unknown }} */ (err);
            if (e.code === 'EISDIR' || e.code === 'EPERM') {
                const failedOperation = await failAndAuditMutation(operation, err, { tool: 'delete_file' });
                return createToolFailureResult({
                    toolName: 'delete_file',
                    message: 'É um diretório. delete_file só opera em arquivos.',
                    category: 'invalid-parameters',
                    fix: 'Use uma tool de diretório apropriada ou informe o caminho de um arquivo regular.',
                    receivedParameters: { path: filePath },
                    details: { path: resolved, code: String(e.code) },
                    extra: { operation: failedOperation },
                });
            }
            const failedOperation = await failAndAuditMutation(operation, err, { tool: 'delete_file' });
            return mutationFailureResult(
                'delete_file',
                err,
                { path: filePath },
                { path: resolved },
                { operation: failedOperation },
            );
        }
    },
});

// ---------------------------------------------------------------------------
// Tool: copy_file
// ---------------------------------------------------------------------------

/**
 * Tool: copy_file — copia um arquivo para outro caminho no workspace.
 */
const copyFileTool = buildTool({
    name: 'copy_file',
    description: 'Copia um arquivo para outro caminho no workspace, com overwrite explícito e rollback do destino quando possível.',
    parameters: z.object({
        source: z.string().describe('Caminho do arquivo de origem'),
        destination: z.string().describe('Caminho de destino'),
        overwrite: z.boolean().optional().default(false).describe('Sobrescrever destino se existir'),
    }),
    handler: async ({ source, destination, overwrite }) => {
        const src = await validatePath(source, { mode: 'read' });
        if (!src.ok) {
            return pathFailureResult(
                'copy_file',
                src.reason ?? 'Caminho de origem inválido.',
                { source, destination, overwrite },
                { field: 'source' },
            );
        }

        const dst = await validatePath(destination, { mode: 'write' });
        if (!dst.ok) {
            return pathFailureResult(
                'copy_file',
                dst.reason ?? 'Caminho de destino inválido.',
                { source, destination, overwrite },
                { field: 'destination' },
            );
        }

        log('INFO', `[copilot/copy_file] ${src.resolved} → ${dst.resolved}`);
        const riskClass = riskForOverwrite(overwrite);
        const operation = createIoOperationEnvelope({
            capability: IO_CAPABILITY.fileCopy,
            riskClass,
            targets: [src.resolved, dst.resolved],
            evidence: { tool: 'copy_file', overwrite },
        });

        try {
            const copyResult = await copyFileLocked(src.resolved, dst.resolved, { overwrite });
            return withIoMeta(
                {
                    success: true,
                    source: src.resolved,
                    destination: dst.resolved,
                    bytesWritten: copyResult.bytesWritten,
                    sourceBytes: copyResult.sourceBytes,
                    sourceHash: copyResult.sourceHash,
                    destinationPreviousHash: copyResult.destinationPreviousHash,
                    destinationPreviousBytes: copyResult.destinationPreviousBytes,
                    destinationPreviousSnapshotTruncated: copyResult.destinationPreviousSnapshotTruncated,
                    lockWaitMs: copyResult.lockWaitMs,
                    operation: await completeAndAuditMutation(
                        operation,
                        {
                            traceId: copyResult.io.traceId ?? null,
                            evidence: {
                                bytesWritten: copyResult.bytesWritten,
                                sourceBytes: copyResult.sourceBytes,
                                sourceHash: copyResult.sourceHash,
                            },
                        },
                        {
                            tool: 'copy_file',
                            io: copyResult.io,
                            result: { source: src.resolved, destination: dst.resolved },
                        },
                    ),
                    changeSet: buildMutationChangeSet({
                        capability: IO_CAPABILITY.fileCopy,
                        riskClass,
                        traceId: copyResult.io.traceId ?? null,
                        entries: [
                            {
                                action: 'copy',
                                targets: [src.resolved, dst.resolved],
                                rollback:
                                    overwrite && copyResult.destinationPreviousSnapshotBase64
                                        ? {
                                              action: 'write',
                                              target: dst.resolved,
                                              previousHash: copyResult.destinationPreviousHash,
                                              bytes: copyResult.destinationPreviousBytes,
                                              snapshotBase64: copyResult.destinationPreviousSnapshotBase64,
                                          }
                                        : {
                                              action: 'delete',
                                              target: dst.resolved,
                                              previousHash: copyResult.destinationPreviousHash ?? copyResult.sourceHash,
                                              bytes: copyResult.bytesWritten,
                                          },
                                evidence: {
                                    tool: 'copy_file',
                                    overwrite,
                                    destinationRestoreAvailable: Boolean(copyResult.destinationPreviousSnapshotBase64),
                                    destinationRestoreTruncated: Boolean(
                                        copyResult.destinationPreviousSnapshotTruncated,
                                    ),
                                },
                            },
                        ],
                        evidence: { tool: 'copy_file', overwrite },
                    }),
                },
                copyResult.io,
            );
        } catch (err) {
            const failedOperation = await failAndAuditMutation(operation, err, { tool: 'copy_file' });
            return mutationFailureResult(
                'copy_file',
                err,
                { source, destination, overwrite },
                { source: src.resolved, destination: dst.resolved },
                { operation: failedOperation },
            );
        }
    },
});

// ---------------------------------------------------------------------------
// Tool: move_file
// ---------------------------------------------------------------------------

/**
 * Tool: move_file — move/renomeia um arquivo para outro caminho no workspace.
 */
const moveFileTool = buildTool({
    name: 'move_file',
    description: 'Move ou renomeia um arquivo no workspace, com overwrite explícito e metadados de rollback.',
    parameters: z.object({
        source: z.string().describe('Caminho do arquivo de origem'),
        destination: z.string().describe('Caminho de destino'),
        overwrite: z.boolean().optional().default(false).describe('Sobrescrever destino se existir'),
    }),
    handler: async ({ source, destination, overwrite }) => {
        const src = await validatePath(source, { mode: 'read' });
        if (!src.ok) {
            return pathFailureResult(
                'move_file',
                src.reason ?? 'Caminho de origem inválido.',
                { source, destination, overwrite },
                { field: 'source' },
            );
        }

        const dst = await validatePath(destination, { mode: 'write' });
        if (!dst.ok) {
            return pathFailureResult(
                'move_file',
                dst.reason ?? 'Caminho de destino inválido.',
                { source, destination, overwrite },
                { field: 'destination' },
            );
        }

        log('INFO', `[copilot/move_file] ${src.resolved} → ${dst.resolved}`);
        const riskClass = riskForOverwrite(overwrite);
        const operation = createIoOperationEnvelope({
            capability: IO_CAPABILITY.fileMove,
            riskClass,
            targets: [src.resolved, dst.resolved],
            evidence: { tool: 'move_file', overwrite },
        });

        try {
            const moveResult = await moveFileLocked(src.resolved, dst.resolved, { overwrite });
            return withIoMeta(
                {
                    success: true,
                    source: src.resolved,
                    destination: dst.resolved,
                    sourceBytes: moveResult.sourceBytes,
                    sourceHash: moveResult.sourceHash,
                    destinationPreviousHash: moveResult.destinationPreviousHash,
                    destinationPreviousBytes: moveResult.destinationPreviousBytes,
                    destinationPreviousSnapshotTruncated: moveResult.destinationPreviousSnapshotTruncated,
                    lockWaitMs: moveResult.lockWaitMs,
                    operation: await completeAndAuditMutation(
                        operation,
                        {
                            traceId: moveResult.io.traceId ?? null,
                            evidence: {
                                moved: true,
                                sourceBytes: moveResult.sourceBytes,
                                sourceHash: moveResult.sourceHash,
                            },
                        },
                        {
                            tool: 'move_file',
                            io: moveResult.io,
                            result: { source: src.resolved, destination: dst.resolved },
                        },
                    ),
                    changeSet: buildMutationChangeSet({
                        capability: IO_CAPABILITY.fileMove,
                        riskClass,
                        traceId: moveResult.io.traceId ?? null,
                        entries: [
                            {
                                action: 'move',
                                targets: [src.resolved, dst.resolved],
                                rollback: {
                                    action: 'move',
                                    target: src.resolved,
                                    previousHash: moveResult.sourceHash,
                                    bytes: moveResult.sourceBytes,
                                },
                                evidence: { tool: 'move_file', overwrite },
                            },
                            ...(overwrite && moveResult.destinationPreviousSnapshotBase64
                                ? [
                                      {
                                          action: /** @type {'move'} */ ('move'),
                                          targets: [src.resolved, dst.resolved],
                                          rollback: {
                                              action: /** @type {'write'} */ ('write'),
                                              target: dst.resolved,
                                              previousHash: moveResult.destinationPreviousHash,
                                              bytes: moveResult.destinationPreviousBytes,
                                              snapshotBase64: moveResult.destinationPreviousSnapshotBase64,
                                          },
                                          evidence: {
                                              tool: 'move_file',
                                              overwrite,
                                              restoreDestination: true,
                                              destinationRestoreTruncated: Boolean(
                                                  moveResult.destinationPreviousSnapshotTruncated,
                                              ),
                                          },
                                      },
                                  ]
                                : []),
                        ],
                        evidence: { tool: 'move_file', overwrite },
                    }),
                },
                moveResult.io,
            );
        } catch (err) {
            const failedOperation = await failAndAuditMutation(operation, err, { tool: 'move_file' });
            return mutationFailureResult(
                'move_file',
                err,
                { source, destination, overwrite },
                { source: src.resolved, destination: dst.resolved },
                { operation: failedOperation },
            );
        }
    },
});

// ---------------------------------------------------------------------------
// Tool: patch_file
// ---------------------------------------------------------------------------

/**
 * Tool: patch_file — edição cirúrgica por substituição de string exata.
 */
const patchFileTool = buildTool({
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

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export { copyFileTool, createFileTool, deleteFileTool, moveFileTool, patchFileTool, writeFileContentTool };

/**
 * Tools de escrita do filesystem.
 *
 * @type {import('#copilot/sdk/types').Tool[]}
 */
export const fileWriteTools = [
    writeFileContentTool,
    createFileTool,
    deleteFileTool,
    copyFileTool,
    moveFileTool,
    patchFileTool,
];
