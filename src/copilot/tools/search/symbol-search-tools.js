// @ts-check
/**
 * Search tools de símbolos: `workspace_symbol_search`.
 *
 * Owner canônico da tool de busca simbólica (funções, classes, exports, tipos).
 * Extraído de `file/read-tools.js` para separar domain search do domain file-read.
 *
 * @module copilot/tools/search/symbol-search-tools
 */

import { toError, withIoMeta } from '#copilot/core';
import { createWorkspaceIo } from '#copilot/infra/public/workspace-io';
import { z } from 'zod';
import { log } from '../infra/logger.js';
import { buildTool } from '../infra/tool-factory.js';
import { FILE_TOOLS_OUTPUT_POLICY, truncateUtf8Text, validatePath, WORKSPACE_ROOT } from '../file/shared.js';

const { searchWorkspaceSymbols } = createWorkspaceIo({ workspaceRoot: WORKSPACE_ROOT });

/**
 * Tool: workspace_symbol_search — busca símbolos no workspace via infraestrutura canônica de search.
 */
export const workspaceSymbolSearchTool = buildTool({
    name: 'workspace_symbol_search',
    description:
        'Busca símbolos (funções, classes, exports, variáveis, tipos) no workspace usando ripgrep. ' +
        'Equivalente ao "Go to Symbol in Workspace" do VS Code — retorna arquivo, linha e trecho da declaração.',
    parameters: z.object({
        name: z
            .string()
            .min(1)
            .describe('Nome ou prefixo/substring do símbolo a buscar (ex: "validatePath", "MyClass")'),
        kind: z
            .enum(['function', 'class', 'variable', 'export', 'type', 'all'])
            .optional()
            .default('all')
            .describe('Tipo de símbolo: function, class, variable, export, type ou all (qualquer declaração).'),
        path: z
            .string()
            .optional()
            .default('.')
            .describe('Diretório onde buscar (relativo ao workspace). Default: raiz do workspace'),
        includePattern: z.string().optional().describe('Glob de arquivos a incluir (ex: "*.ts", "src/**/*.js")'),
        caseSensitive: z.boolean().optional().default(false).describe('Busca sensível a maiúsculas. Default: false'),
        maxResults: z.number().int().min(1).optional().describe('Número máximo sugerido de declarações a retornar.'),
        cursor: z.string().optional().describe('Cursor numérico retornado por chamada anterior.'),
        exactMatch: z.boolean().optional().default(false).describe('Se true, busca apenas símbolos com nome exato (sem substring match). Default: false.'),
    }),
    handler: async ({
        name: symbolName,
        kind,
        path: searchPath,
        includePattern,
        caseSensitive,
        maxResults,
        cursor,
        exactMatch,
    }) => {
        const { ok, reason, resolved } = await validatePath(searchPath ?? '.', { mode: 'read' });
        if (!ok) return { success: false, error: reason };

        const resolvedKind =
            /** @type {'function' | 'class' | 'variable' | 'export' | 'type' | 'all'} */
            (kind ?? 'all');

        log('INFO', `[copilot/workspace_symbol_search] symbol="${symbolName}" kind=${resolvedKind} in ${resolved}`);

        try {
            const result = await searchWorkspaceSymbols(resolved, {
                workspaceRoot: WORKSPACE_ROOT,
                symbolName,
                kind: resolvedKind,
                exactMatch,
                includePattern,
                caseSensitive,
                maxResults,
                cursor,
            });
            const output = truncateUtf8Text(
                result.output,
                FILE_TOOLS_OUTPUT_POLICY.maxSearchOutputBytes,
                Number.isFinite(FILE_TOOLS_OUTPUT_POLICY.maxSearchOutputBytes)
                    ? `\n\n⚠️ [resultado truncado por política COPILOT_FILE_TOOLS_MAX_SEARCH_OUTPUT_BYTES=${FILE_TOOLS_OUTPUT_POLICY.maxSearchOutputBytes}]`
                    : undefined,
            );
            if (output.truncated) {
                log(
                    'INFO',
                    `[copilot/workspace_symbol_search] saída truncada por política (${FILE_TOOLS_OUTPUT_POLICY.maxSearchOutputBytes} bytes) em ${resolved}`,
                );
            }

            return withIoMeta(
                {
                    success: true,
                    symbol: symbolName,
                    kind: resolvedKind,
                    searchPath: resolved,
                    matchCount: result.matchCount,
                    output: output.text,
                    sanitized: result.sanitized,
                    redactions: result.redactions,
                    truncated: output.truncated || Boolean(result.truncated),
                    nextCursor: result.nextCursor ?? null,
                    cursorOffset: result.cursorOffset ?? 0,
                    totalMatches: result.totalMatches ?? result.matchCount,
                    ...(output.truncated
                        ? {
                              configuredLimitBytes: FILE_TOOLS_OUTPUT_POLICY.maxSearchOutputBytes,
                              originalOutputBytes: output.originalBytes,
                          }
                        : {}),
                    ...(result.message ? { message: result.message } : {}),
                },
                { ...result.io, truncated: output.truncated || Boolean(result.truncated) },
            );
        } catch (err) {
            return { success: false, error: toError(err).message };
        }
    },
});
