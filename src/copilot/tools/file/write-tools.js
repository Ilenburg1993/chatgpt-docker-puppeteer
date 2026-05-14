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

import { z } from 'zod';
import { IO_CAPABILITY, IO_RISK, capabilityForCreate, riskForDryRun, riskForOverwrite } from '#copilot/infra/public/policy';
import { toError } from '../../core/error-handlers.js';
import { withIoMeta } from '../../core/io-contracts.js';
import {
    copyFileLocked,
    createOrReplaceFileAtomic,
    deleteFileLocked,
    moveFileLocked,
    patchTextLocked,
    writeFileAtomic,
} from '#copilot/infra/public/io';
import {
    completeIoOperationEnvelope,
    createIoOperationEnvelope,
    failIoOperationEnvelope,
    recordIoMutationAudit,
} from '#copilot/infra/public/runtime';
import { log } from '../infra/logger.js';
import { buildTool } from '../infra/tool-factory.js';
import { validatePath } from './shared.js';

const ADVISORY_WRITE_CONTENT_BYTES = 2 * 1024 * 1024;
const ADVISORY_PATCH_SEGMENT_CHARS = 200_000;

/**
 * @param {ReturnType<typeof createIoOperationEnvelope>} operation
 * @param {{ status?: 'planned' | 'applied' | 'failed' | 'dry-run'; traceId?: string | null; evidence?: Record<string, unknown> }} result
 * @param {{ tool: string; io?: import('../../core/io-contracts.js').IoMeta | null; result?: Record<string, unknown> }} auditContext
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
 * @param {{ tool: string; io?: import('../../core/io-contracts.js').IoMeta | null; result?: Record<string, unknown> }} auditContext
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
        '⚠️ REQUER APROVAÇÃO — sobrescreve conteúdo existente. Use create_file para arquivos novos.',
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
        if (!ok) return { success: false, error: reason };

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
                },
                writeResult.io,
            );
        } catch (err) {
            return {
                success: false,
                error: toError(err).message,
                operation: await failAndAuditMutation(operation, err, { tool: 'write_file_content' }),
            };
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
        '⚠️ REQUER APROVAÇÃO — o arquivo não deve existir previamente (use write_file_content para sobrescrever).',
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
        if (!ok) return { success: false, error: reason };

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
                },
                writeResult.io,
            );
        } catch (err) {
            return {
                success: false,
                error: toError(err).message,
                operation: await failAndAuditMutation(operation, err, { tool: 'create_file' }),
            };
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
        'Deleta um arquivo do workspace. ' + '⚠️ REQUER APROVAÇÃO — OPERAÇÃO IRREVERSÍVEL. Não deleta diretórios.',
    parameters: z.object({
        path: z.string().describe('Caminho do arquivo a deletar'),
    }),
    handler: async ({ path: filePath }) => {
        const { ok, reason, resolved } = await validatePath(filePath, { mode: 'write' });
        if (!ok) return { success: false, error: reason };

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
            };
        } catch (err) {
            const e = /** @type {{ code?: unknown }} */ (err);
            if (e.code === 'EISDIR' || e.code === 'EPERM') {
                return {
                    success: false,
                    error: 'É um diretório. delete_file só opera em arquivos.',
                    operation: await failAndAuditMutation(operation, err, { tool: 'delete_file' }),
                };
            }
            return {
                success: false,
                error: toError(err).message,
                operation: await failAndAuditMutation(operation, err, { tool: 'delete_file' }),
            };
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
    description: 'Copia um arquivo para outro caminho no workspace. ' + '⚠️ REQUER APROVAÇÃO se o destino já existe.',
    parameters: z.object({
        source: z.string().describe('Caminho do arquivo de origem'),
        destination: z.string().describe('Caminho de destino'),
        overwrite: z.boolean().optional().default(false).describe('Sobrescrever destino se existir'),
    }),
    handler: async ({ source, destination, overwrite }) => {
        const src = await validatePath(source, { mode: 'read' });
        if (!src.ok) return { success: false, error: src.reason };

        const dst = await validatePath(destination, { mode: 'write' });
        if (!dst.ok) return { success: false, error: dst.reason };

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
                },
                copyResult.io,
            );
        } catch (err) {
            return {
                success: false,
                error: toError(err).message,
                operation: await failAndAuditMutation(operation, err, { tool: 'copy_file' }),
            };
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
    description: 'Move ou renomeia um arquivo no workspace. ' + '⚠️ REQUER APROVAÇÃO — remove o arquivo de origem.',
    parameters: z.object({
        source: z.string().describe('Caminho do arquivo de origem'),
        destination: z.string().describe('Caminho de destino'),
        overwrite: z.boolean().optional().default(false).describe('Sobrescrever destino se existir'),
    }),
    handler: async ({ source, destination, overwrite }) => {
        const src = await validatePath(source, { mode: 'read' });
        if (!src.ok) return { success: false, error: src.reason };

        const dst = await validatePath(destination, { mode: 'write' });
        if (!dst.ok) return { success: false, error: dst.reason };

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
                },
                moveResult.io,
            );
        } catch (err) {
            return {
                success: false,
                error: toError(err).message,
                operation: await failAndAuditMutation(operation, err, { tool: 'move_file' }),
            };
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
        '`old_string` deve ocorrer EXATAMENTE UMA VEZ no arquivo (inclua ≥3 linhas de contexto). ' +
        '⚠️ REQUER APROVAÇÃO — modifica o arquivo em disco.',
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
        expectedHash: z
            .string()
            .optional()
            .describe('SHA-256 esperado do conteúdo atual. Se o arquivo mudou, o patch falha sem aplicar.'),
        dryRun: z
            .boolean()
            .optional()
            .default(false)
            .describe('Se true, valida e calcula o patch sem escrever no disco.'),
    }),
    handler: async ({
        path: filePath,
        old_string,
        new_string,
        replace_all,
        expected_occurrences,
        expectedHash,
        dryRun,
    }) => {
        const v = await validatePath(filePath, { mode: 'write' });
        if (!v.ok) return { success: false, error: v.reason };
        const operation = createIoOperationEnvelope({
            capability: IO_CAPABILITY.filePatch,
            riskClass: riskForDryRun(dryRun, IO_RISK.high),
            targets: [v.resolved],
            evidence: { tool: 'patch_file', replaceAll: replace_all, dryRun },
        });

        try {
            const patchResult = await patchTextLocked(v.resolved, {
                oldString: old_string,
                newString: new_string,
                replaceAll: replace_all,
                expectedOccurrences: expected_occurrences,
                ...(expectedHash ? { expectedHash } : {}),
                dryRun,
                advisoryLimits: {
                    advisoryPatchSegmentChars: ADVISORY_PATCH_SEGMENT_CHARS,
                    oldStringChars: old_string.length,
                    newStringChars: new_string.length,
                    expectedHash: expectedHash ?? null,
                    dryRun,
                    limitMode: 'informative',
                },
            });
            log('INFO', `[copilot/patch_file] Patch ${dryRun ? 'simulado' : 'aplicado'}: ${v.resolved}`);
            return withIoMeta(
                {
                    success: true,
                    path: v.resolved,
                    dryRun: patchResult.dryRun,
                    replacedOccurrences: patchResult.replacedOccurrences,
                    projectedBytes: patchResult.projectedBytes,
                    previousHash: patchResult.previousHash,
                    contentHash: patchResult.contentHash,
                    operation: await completeAndAuditMutation(
                        operation,
                        {
                            status: dryRun ? 'dry-run' : 'applied',
                            traceId: patchResult.io.traceId ?? null,
                            evidence: {
                                dryRun,
                                replacedOccurrences: patchResult.replacedOccurrences,
                                projectedBytes: patchResult.projectedBytes,
                                previousHash: patchResult.previousHash,
                                contentHash: patchResult.contentHash,
                            },
                        },
                        { tool: 'patch_file', io: patchResult.io, result: { path: v.resolved, dryRun } },
                    ),
                },
                patchResult.io,
            );
        } catch (e) {
            return {
                success: false,
                error: `Erro ao escrever arquivo: ${toError(e).message}`,
                operation: await failAndAuditMutation(operation, e, { tool: 'patch_file' }),
            };
        }
    },
});

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export { copyFileTool, createFileTool, deleteFileTool, moveFileTool, patchFileTool, writeFileContentTool };

/**
 * Tools de escrita do filesystem (requirePermission — aprovação obrigatória).
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
