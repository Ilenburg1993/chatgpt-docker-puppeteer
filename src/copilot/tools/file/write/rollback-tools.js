// @ts-check
/**
 * Tools operacionais de rollback para mutações locais de arquivo.
 *
 * @module copilot/tools/file/write/rollback-tools
 */

import {
    createIoOperationEnvelope,
    executeIoRollbackToken,
    listRollbackSidecars,
    parseIoRollbackToken,
} from '#copilot/infra/public/operations';
import path from 'node:path';
import { z } from 'zod';
import { buildTool } from '../../infra/tool-factory.js';
import { createToolFailureResult } from '../../infra/tool-feedback.js';
import { validatePath } from '../shared.js';
import { completeAndAuditMutation, failAndAuditMutation } from './mutation-helpers.js';

const MAX_ROLLBACK_TOKEN_CHARS = 32 * 1024 * 1024;

/**
 * @param {ReturnType<typeof parseIoRollbackToken>} token
 */
function tokenPaths(token) {
    return [
        ...new Set(
            token.steps.flatMap((step) =>
                step.action === 'move'
                    ? [step.source, step.destination].filter((value) => typeof value === 'string')
                    : [step.target],
            ),
        ),
    ];
}

export const rollbackFileChangesTool = buildTool({
    name: 'rollback_file_changes',
    description:
        'Valida ou aplica um token de rollback retornado por uma mutação local. Dry-run é o padrão; aplicação exige confirm=true.',
    instructions:
        'Use primeiro com dryRun=true. Aplique somente o token exato retornado pela mutação correspondente e somente ' +
        'quando todas as precondições estiverem ready. Não edite nem reconstrua tokens manualmente.',
    parameters: z.object({
        token: z
            .string()
            .min(1)
            .max(MAX_ROLLBACK_TOKEN_CHARS)
            ['describe']('Token base64url retornado em changeSet.rollback.token.'),
        dryRun: z.boolean().optional().default(true)['describe']('Valida todos os passos sem alterar arquivos.'),
        confirm: z.boolean().optional().default(false)['describe']('Obrigatório quando dryRun=false.'),
    }),
    handler: async ({ token: serialized, dryRun, confirm }) => {
        if (!dryRun && !confirm) {
            return createToolFailureResult({
                toolName: 'rollback_file_changes',
                message: 'Aplicação de rollback exige confirm=true.',
                category: 'invalid-parameters',
                fix: 'Execute primeiro com dryRun=true; depois repita com dryRun=false e confirm=true.',
                receivedParameters: { dryRun, confirm },
            });
        }

        let token;
        try {
            token = parseIoRollbackToken(serialized);
        } catch (error) {
            return createToolFailureResult({
                toolName: 'rollback_file_changes',
                error,
                category: 'invalid-parameters',
                fix: 'Use o token original retornado por uma file tool, sem alterações.',
                receivedParameters: { dryRun, confirm },
            });
        }

        const allowedPaths = new Set();
        for (const filePath of tokenPaths(token)) {
            const validation = await validatePath(filePath, { mode: 'write' });
            if (!validation.ok) {
                return createToolFailureResult({
                    toolName: 'rollback_file_changes',
                    message: validation.reason ?? 'Path de rollback negado pela policy.',
                    category: 'policy-denied',
                    fix: 'Use apenas tokens gerados para paths válidos do workspace atual.',
                    receivedParameters: { dryRun, confirm },
                    details: { field: 'token.paths' },
                });
            }
            allowedPaths.add(path.resolve(validation.resolved));
        }

        const operation = createIoOperationEnvelope({
            capability: 'file.rollback',
            riskClass: dryRun ? 'low' : 'high',
            targets: [...allowedPaths],
            evidence: { tool: 'rollback_file_changes', tokenId: token.tokenId, dryRun },
        });
        try {
            const result = await executeIoRollbackToken(token, { dryRun, allowedPaths });
            if (!result.success) {
                const error = Object.assign(new Error(result.error ?? 'Rollback bloqueado.'), {
                    code: result.code,
                });
                return {
                    ...result,
                    operation: await failAndAuditMutation(operation, error, {
                        tool: 'rollback_file_changes',
                        result: { tokenId: token.tokenId, status: result.status },
                    }),
                };
            }
            return {
                ...result,
                operation: await completeAndAuditMutation(
                    operation,
                    {
                        status: dryRun ? 'dry-run' : 'applied',
                        evidence: {
                            tokenId: token.tokenId,
                            stepCount: token.stepCount,
                            appliedCount: result.appliedCount,
                        },
                    },
                    {
                        tool: 'rollback_file_changes',
                        result: { tokenId: token.tokenId, status: result.status },
                    },
                ),
            };
        } catch (error) {
            return {
                success: false,
                dryRun,
                status: 'failed',
                error: error instanceof Error ? error.message : String(error),
                operation: await failAndAuditMutation(operation, error, {
                    tool: 'rollback_file_changes',
                    result: { tokenId: token.tokenId },
                }),
            };
        }
    },
});

export const rollbackSidecarsStatusTool = buildTool({
    name: 'rollback_sidecars_status',
    description:
        'Lista metadados e, opcionalmente, verifica a integridade dos sidecars de rollback sem expor conteúdo ou path absoluto.',
    parameters: z.object({
        maxEntries: z.number().int().positive().max(200).optional().default(50),
        verifyContent: z.boolean().optional().default(false),
    }),
    handler: async ({ maxEntries, verifyContent }) =>
        listRollbackSidecars({
            maxEntries,
            verifyContent,
        }),
});
