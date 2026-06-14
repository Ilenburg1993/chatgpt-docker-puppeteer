// @ts-check
import { withIoMeta } from '#copilot/core';
import { decodeBase64ToOwnedBuffer, toOwnedBuffer, utf8ByteLength } from '#copilot/infra/public/buffer';
import { createIoOperationEnvelope } from '#copilot/infra/public/runtime';
import { z } from 'zod';
import { log } from '../infra/logger.js';
import { buildTool } from '../infra/tool-factory.js';
import { createToolFailureResult } from '../infra/tool-feedback.js';
import { validatePath, WORKSPACE_ROOT } from './shared.js';
/**
 * src/copilot/tools/file/write-tools.js
 *
 * Tools de escrita do filesystem: write_file_content, create_file, delete_file, copy_file, move_file, patch_file.
 *
 * @module copilot/tools/file/write-tools
 * @see EventBus
 * @see module:copilot/tools/file/shared
 */

import { createWorkspaceIo } from '#copilot/infra/public/workspace-io';
import { IO_CAPABILITY, IO_RISK, capabilityForCreate, riskForOverwrite } from '#copilot/infra/public/policy';
import {
    ADVISORY_WRITE_CONTENT_BYTES,
    buildMutationChangeSet,
    completeAndAuditMutation,
    failAndAuditMutation,
    mutationFailureResult,
    patchFileTool,
    pathFailureResult,
} from './write/index.js';
import { dryRunPatchPlan, normalizePatchPlan } from './write/patch-plan.js';

const { copyFileLocked, createOrReplaceFileAtomic, deleteFileLocked, moveFileLocked, writeFileAtomic } =
    createWorkspaceIo({ workspaceRoot: WORKSPACE_ROOT });

// ---------------------------------------------------------------------------
// Tool: patch_bundle_plan (read-only)
// ---------------------------------------------------------------------------

/**
 * Tool: patch_bundle_plan — simula execução de patch multi-arquivo sem efeitos colaterais.
 */
const patchBundlePlanTool = buildTool({
    name: 'patch_bundle_plan',
    description:
        'Simula aplicação de um patch bundle multi-arquivo usando dry-run. Não modifica arquivos.',
    instructions:
        'Use patch_bundle_plan para validar mudanças em múltiplos arquivos antes de executar patch_file. Sempre forneça um ' +
        'plano válido no formato de patch-plan. Nunca use este tool para mutação real.',
    parameters: z.object({
        plan: z.any().describe('Patch plan normalizado (use normalizePatchPlan antes se necessário)'),
        fileContents: z.record(z.string(), z.string()).describe('Mapa de conteúdo atual dos arquivos'),
    }),
    handler: async ({ plan, fileContents }) => {
        const normalized = normalizePatchPlan(plan);
        if (!normalized.ok) {
            return {
                success: false,
                error: 'invalid patch plan',
                details: normalized.errors,
            };
        }
        return dryRunPatchPlan(normalized.plan, fileContents);
    },
});

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
    instructions:
        'Use write_file_content only when replacing the whole existing file is intentional. Prefer patch_file for ' +
        'surgical edits. Read the current file first and pass expectedHash from read_file_content when available so ' +
        'concurrent changes fail safely instead of being overwritten. Do not claim the file was written until this ' +
        'tool returns success.',
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
            let buf;
            try {
                buf =
                    encoding === 'base64'
                        ? decodeBase64ToOwnedBuffer(content, 'write_file_content.content')
                        : toOwnedBuffer(content, 'utf8');
            } catch (error) {
                return createToolFailureResult({
                    toolName: 'write_file_content',
                    error,
                    category: 'invalid-parameters',
                    fix: 'Envie content como texto UTF-8 ou como base64/base64url válido quando encoding=base64.',
                    receivedParameters: { path: filePath, encoding, expectedHash },
                    details: { path: resolved, encoding },
                    extra: {
                        operation: await failAndAuditMutation(operation, error, { tool: 'write_file_content' }),
                    },
                });
            }
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
    instructions:
        'Use create_file for new files or deliberate file replacement. Use createParentDirs=true for approved ' +
        'workspace-relative scratch paths. Do not ask for a separate permission prompt when the operator already gave ' +
        'a concrete path and the terminal permission mode is automatic; report the created path and byte count only ' +
        'after this tool returns success.',
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
            const contentBytes = utf8ByteLength(content ?? '', 'write_file_content content');
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
    description:
        'Deleta um arquivo do workspace. Não opera sobre diretórios e retorna snapshot de rollback quando possível.',
    instructions:
        'Use delete_file only for explicit file cleanup or removal requested by the operator/scenario. Do not use it ' +
        'for directories. When deleting temporary live-test artifacts, prefer precise workspace-relative paths and ' +
        'avoid extra confirmation prompts if the cleanup was already part of the requested flow. Do not claim deletion ' +
        'or cleanup until this tool returns success. If a requested workflow names delete_file as the final cleanup ' +
        'step, invoke this tool; do not replace it with a textual claim that cleanup happened.',
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
            return withIoMeta(
                {
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
                            snapshotSidecar: deleted.previousRollbackSidecar,
                        },
                        evidence: { tool: 'delete_file' },
                    }),
                },
                deleted.io,
            );
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
    description:
        'Copia um arquivo para outro caminho no workspace, com overwrite explícito e rollback do destino quando possível.',
    instructions:
        'Use copy_file for file-to-file copies with explicit source and destination. Keep paths workspace-relative ' +
        'when the operator gave relative paths. Set overwrite=true only when replacing the destination is intended. ' +
        'Do not claim the copy happened until this tool returns success.',
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
                    destinationHash: copyResult.destinationHash,
                    staged: copyResult.staged,
                    destinationPreviousHash: copyResult.destinationPreviousHash,
                    destinationPreviousBytes: copyResult.destinationPreviousBytes,
                    destinationPreviousSnapshotTruncated: copyResult.destinationPreviousSnapshotTruncated,
                    destinationPreviousRollbackSidecar: copyResult.destinationPreviousRollbackSidecar,
                    lockWaitMs: copyResult.lockWaitMs,
                    operation: await completeAndAuditMutation(
                        operation,
                        {
                            traceId: copyResult.io.traceId ?? null,
                            evidence: {
                                bytesWritten: copyResult.bytesWritten,
                                sourceBytes: copyResult.sourceBytes,
                                sourceHash: copyResult.sourceHash,
                                destinationHash: copyResult.destinationHash,
                                staged: copyResult.staged,
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
                                    overwrite &&
                                    (copyResult.destinationPreviousSnapshotBase64 ||
                                        copyResult.destinationPreviousRollbackSidecar)
                                        ? {
                                              action: 'write',
                                              target: dst.resolved,
                                              previousHash: copyResult.destinationPreviousHash,
                                              bytes: copyResult.destinationPreviousBytes,
                                              snapshotBase64: copyResult.destinationPreviousSnapshotBase64,
                                              snapshotSidecar: copyResult.destinationPreviousRollbackSidecar,
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
                                    destinationRestoreAvailable: Boolean(
                                        copyResult.destinationPreviousSnapshotBase64 ||
                                        copyResult.destinationPreviousRollbackSidecar,
                                    ),
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
    instructions:
        'Use move_file for renames or moves after the source and destination are known. Keep the operation atomic and ' +
        'avoid additional permission questions when the operator already supplied the exact move in an automatic ' +
        'permission flow. Do not claim the move happened until this tool returns success.',
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
                    destinationPreviousRollbackSidecar: moveResult.destinationPreviousRollbackSidecar,
                    crossDevice: moveResult.crossDevice,
                    duplicatedAfterCrossDeviceMove: moveResult.duplicatedAfterCrossDeviceMove,
                    sourceUnlinkErrorCode: moveResult.sourceUnlinkErrorCode,
                    destinationHash: moveResult.destinationHash,
                    destinationBytes: moveResult.destinationBytes,
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
                            ...(overwrite &&
                            (moveResult.destinationPreviousSnapshotBase64 ||
                                moveResult.destinationPreviousRollbackSidecar)
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
                                              snapshotSidecar: moveResult.destinationPreviousRollbackSidecar,
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
    patchBundlePlanTool,
    copyFileTool,
    moveFileTool,
    patchFileTool,
];
