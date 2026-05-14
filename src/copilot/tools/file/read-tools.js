// @ts-check
/**
 * src/copilot/tools/file/read-tools.js
 *
 * Superfície canônica unificada das file read tools.
 *
 * Este arquivo concentra TODAS as tools de leitura/busca/símbolo do subdomínio `file`, evitando a fragmentação
 * histórica entre `read-tools-io.js`, `read-tools-search.js` e `symbol-search-tool.js`.
 *
 * Princípios:
 *
 * - uma única superfície de leitura (`fileReadTools`);
 * - todas as tools expõem metadados de I/O canônicos;
 * - a organização por responsabilidade fica intra-arquivo/helpers, não em múltiplos módulos paralelos.
 *
 * @module copilot/tools/file/read-tools
 */

import { stat as fsStat } from 'node:fs/promises';
import { z } from 'zod';
import { toError } from '../../core/error-handlers.js';
import { withIoMeta } from '../../core/io-contracts.js';
import { sanitizeIoTextOutput } from '../../core/io-policy.js';
import {
    diffText,
    readBytes,
    readText,
    scanDirectory,
    searchText,
    searchWorkspaceSymbols,
    warmReadThroughContext,
} from '#copilot/infra/public/io';
import { log } from '../infra/logger.js';
import { buildTool, withSkipPermission } from '../infra/tool-factory.js';
import {
    applyEntryLimit,
    FILE_TOOLS_OUTPUT_POLICY,
    truncateBuffer,
    truncateUtf8Text,
    validatePath,
    WORKSPACE_ROOT,
} from './shared.js';

/**
 * Tamanho mínimo em bytes para disparar warm read-through context em arquivos de texto.
 *
 * @type {number}
 */
const MIN_READ_THROUGH_BYTES = 1024;

/**
 * @typedef {object} IoScanEntry
 * @property {string} name
 * @property {'file' | 'directory' | 'symlink' | 'other'} type
 * @property {string} path
 * @property {number} [size]
 * @property {IoScanEntry[]} [children]
 */

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
        encoding: z
            .enum(['utf8', 'base64'])
            .optional()
            .default('utf8')
            .describe('Codificação de saída. Use base64 para arquivos binários.'),
    }),
    handler: async ({ path: filePath, startLine, endLine, encoding }) => {
        const { ok, reason, resolved } = await validatePath(filePath, { mode: 'read' });
        if (!ok) return { success: false, error: reason };
        if (startLine !== undefined && endLine !== undefined && endLine < startLine) {
            return { success: false, error: 'Intervalo inválido: endLine deve ser maior ou igual a startLine.' };
        }

        log('INFO', `[copilot/read_file_content] ${resolved}`);

        try {
            const stats = await fsStat(resolved);
            if (stats.isDirectory()) return { success: false, error: 'É um diretório, use list_directory.' };

            if (encoding === 'base64') {
                const raw = await readBytes(resolved);
                const limitedBuffer = truncateBuffer(raw.content, FILE_TOOLS_OUTPUT_POLICY.maxContentBytes);
                const truncated = limitedBuffer.length < raw.content.length;
                if (truncated) {
                    log(
                        'INFO',
                        `[copilot/read_file_content] conteúdo binário truncado por política (${FILE_TOOLS_OUTPUT_POLICY.maxContentBytes} bytes) em ${resolved}`,
                    );
                }
                return withIoMeta(
                    {
                        success: true,
                        path: resolved,
                        size: stats.size,
                        encoding: 'base64',
                        content: limitedBuffer.toString('base64'),
                        truncated,
                        ...(truncated
                            ? {
                                  configuredLimitBytes: FILE_TOOLS_OUTPUT_POLICY.maxContentBytes,
                                  originalContentBytes: raw.content.length,
                              }
                            : {}),
                    },
                    raw.io,
                );
            }

            const text = await readText(resolved, { startLine, endLine });
            const readThrough =
                stats.size >= MIN_READ_THROUGH_BYTES
                    ? await warmReadThroughContext(resolved, {
                          workspaceRoot: WORKSPACE_ROOT,
                          relatedImports: true,
                          concurrency: 4,
                          silent: true,
                      })
                    : null;
            const sanitized = sanitizeIoTextOutput({ text: text.content });
            const contentOutput = truncateUtf8Text(
                sanitized.text,
                FILE_TOOLS_OUTPUT_POLICY.maxContentBytes,
                Number.isFinite(FILE_TOOLS_OUTPUT_POLICY.maxContentBytes)
                    ? `\n\n⚠️ [conteúdo truncado por política COPILOT_FILE_TOOLS_MAX_CONTENT_BYTES=${FILE_TOOLS_OUTPUT_POLICY.maxContentBytes}]`
                    : undefined,
            );
            const truncated = contentOutput.truncated;
            if (truncated) {
                log(
                    'INFO',
                    `[copilot/read_file_content] conteúdo truncado por política (${FILE_TOOLS_OUTPUT_POLICY.maxContentBytes} bytes) em ${resolved}`,
                );
            }

            return withIoMeta(
                {
                    success: true,
                    path: resolved,
                    size: stats.size,
                    totalLines: text.totalLines,
                    returnedLines: text.returnedLines,
                    content: contentOutput.text,
                    readThrough,
                    sanitized: sanitized.sanitized,
                    redactions: sanitized.redactions,
                    truncated,
                    ...(truncated
                        ? {
                              configuredLimitBytes: FILE_TOOLS_OUTPUT_POLICY.maxContentBytes,
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

/**
 * Tool: list_directory — lista o conteúdo de um diretório.
 */
export const listDirectoryTool = buildTool({
    name: 'list_directory',
    description:
        'Lista o conteúdo de um diretório no workspace. Retorna nome, tipo (file/dir) e tamanho. ' +
        'Opcionalmente recursivo com limite de profundidade.',
    parameters: z.object({
        path: z.string().describe('Caminho do diretório (relativo ao workspace ou absoluto)'),
        recursive: z.boolean().optional().default(false).describe('Se true, lista recursivamente'),
        depth: z
            .number()
            .int()
            .min(1)
            .optional()
            .default(3)
            .describe('Profundidade máxima para listagem recursiva. Informativa e controlada pelo caller.'),
        showHidden: z.boolean().optional().default(false).describe('Incluir arquivos/diretórios ocultos (dotfiles)'),
        filter: z.string().optional().describe('Glob pattern para filtrar entradas (ex: *.js, *.md)'),
    }),
    handler: async ({ path: dirPath, recursive, depth, showHidden, filter }) => {
        const { ok, reason, resolved } = await validatePath(dirPath, { mode: 'read' });
        if (!ok) return { success: false, error: reason };

        log('INFO', `[copilot/list_directory] ${resolved} (recursive=${recursive}, depth=${depth})`);

        /**
         * @typedef {object} DirEntry
         * @property {string} name
         * @property {string} type
         * @property {number} [size]
         * @property {string} path
         * @property {DirEntry[]} [children]
         */

        try {
            const stats = await fsStat(resolved);
            if (!stats.isDirectory()) return { success: false, error: 'Não é um diretório, use read_file_content.' };
            const scan = await scanDirectory(resolved, {
                workspaceRoot: WORKSPACE_ROOT,
                recursive,
                depth,
                showHidden,
                filter,
            });

            /**
             * @param {IoScanEntry} entry
             * @returns {DirEntry}
             */
            const toLegacyEntry = (entry) => {
                const legacy = /** @type {DirEntry} */ ({
                    name: entry.name,
                    type: entry.type === 'directory' ? 'dir' : entry.type,
                    path: entry.path,
                });
                if (entry.size !== undefined) legacy.size = entry.size;
                if (entry.children) legacy.children = entry.children.map(toLegacyEntry);
                return legacy;
            };
            const entries = scan.entries.map(toLegacyEntry);
            const limitedEntries = applyEntryLimit(entries, FILE_TOOLS_OUTPUT_POLICY.maxListEntries);
            if (limitedEntries.truncated) {
                log(
                    'INFO',
                    `[copilot/list_directory] saída truncada por política (${FILE_TOOLS_OUTPUT_POLICY.maxListEntries} entries) em ${resolved}`,
                );
            }
            return withIoMeta(
                {
                    success: true,
                    path: resolved,
                    count: limitedEntries.entries.length,
                    truncated: limitedEntries.truncated,
                    scannedBudget: scan.scannedEntries,
                    totalEntries: limitedEntries.totalEntries,
                    ...(limitedEntries.truncated
                        ? { configuredLimitEntries: FILE_TOOLS_OUTPUT_POLICY.maxListEntries }
                        : {}),
                    entries: limitedEntries.entries,
                },
                { ...scan.io, truncated: limitedEntries.truncated },
            );
        } catch (err) {
            return { success: false, error: toError(err).message };
        }
    },
});

/**
 * Tool: search_in_files — busca texto/regex em arquivos do workspace.
 */
export const searchInFilesTool = buildTool({
    name: 'search_in_files',
    description:
        'Busca texto ou regex em arquivos do workspace usando o plano canônico de I/O/search. ' +
        'Retorna correspondências com número de linha e contexto.',
    parameters: z.object({
        pattern: z.string().describe('Padrão de busca (texto literal ou regex)'),
        path: z.string().optional().default('.').describe('Diretório ou arquivo onde buscar (relativo ao workspace)'),
        isRegex: z.boolean().optional().default(false).describe('Se true, trata pattern como expressão regular'),
        caseSensitive: z.boolean().optional().default(false).describe('Busca sensível a maiúsculas'),
        includePattern: z.string().optional().describe('Filtro de arquivos a incluir (ex: *.js, *.ts)'),
        excludePattern: z.string().optional().describe('Filtro de arquivos a excluir (ex: node_modules, dist)'),
        contextLines: z
            .number()
            .int()
            .min(0)
            .optional()
            .default(2)
            .describe('Linhas de contexto ao redor de cada match.'),
        maxResults: z.number().int().min(1).optional().describe('Número máximo sugerido de resultados.'),
    }),
    handler: async ({
        pattern,
        path: searchPath,
        isRegex,
        caseSensitive,
        includePattern,
        excludePattern,
        contextLines,
        maxResults,
    }) => {
        const { ok, reason, resolved } = await validatePath(searchPath ?? '.', { mode: 'read' });
        if (!ok) return { success: false, error: reason };

        log('INFO', `[copilot/search_in_files] pattern="${pattern}" in ${resolved}`);

        try {
            const result = await searchText(resolved, {
                workspaceRoot: WORKSPACE_ROOT,
                pattern,
                isRegex,
                caseSensitive,
                includePattern,
                excludePattern,
                contextLines,
                maxResults,
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
                    `[copilot/search_in_files] saída truncada por política (${FILE_TOOLS_OUTPUT_POLICY.maxSearchOutputBytes} bytes) em ${resolved}`,
                );
            }
            return withIoMeta(
                {
                    success: true,
                    pattern,
                    searchPath: resolved,
                    output: output.text,
                    truncated: output.truncated,
                    engine: result.engine,
                    matchCount: result.matchCount,
                    sanitized: result.sanitized,
                    redactions: result.redactions,
                    ...(output.truncated
                        ? {
                              configuredLimitBytes: FILE_TOOLS_OUTPUT_POLICY.maxSearchOutputBytes,
                              originalOutputBytes: output.originalBytes,
                          }
                        : {}),
                },
                { ...result.io, truncated: output.truncated },
            );
        } catch (err) {
            return { success: false, error: toError(err).message };
        }
    },
});

/**
 * Tool: diff_files — exibe diferença unificada entre dois arquivos.
 */
export const diffFilesTool = buildTool({
    name: 'diff_files',
    description:
        'Exibe a diferença unificada (unified diff) entre dois arquivos do workspace. ' +
        'Útil para comparar versões ou verificar mudanças antes de aplicar patches.',
    parameters: z.object({
        path_a: z.string().describe('Caminho do primeiro arquivo (linha base / original)'),
        path_b: z.string().describe('Caminho do segundo arquivo (linha modificada / nova versão)'),
        context_lines: z
            .number()
            .int()
            .min(0)
            .optional()
            .default(3)
            .describe('Número de linhas de contexto exibidas ao redor de cada mudança (padrão histórico: 3)'),
    }),
    handler: async ({ path_a, path_b, context_lines }) => {
        const va = await validatePath(path_a, { mode: 'read' });
        if (!va.ok) return { success: false, error: `path_a: ${va.reason}` };
        const vb = await validatePath(path_b, { mode: 'read' });
        if (!vb.ok) return { success: false, error: `path_b: ${vb.reason}` };

        try {
            const diff = await diffText(va.resolved, vb.resolved, { contextLines: context_lines ?? 3 });
            const diffOutput = truncateUtf8Text(
                diff.diff,
                FILE_TOOLS_OUTPUT_POLICY.maxDiffOutputBytes,
                Number.isFinite(FILE_TOOLS_OUTPUT_POLICY.maxDiffOutputBytes)
                    ? `\n\n⚠️ [diff truncado por política COPILOT_FILE_TOOLS_MAX_DIFF_OUTPUT_BYTES=${FILE_TOOLS_OUTPUT_POLICY.maxDiffOutputBytes}]`
                    : undefined,
            );
            if (diffOutput.truncated) {
                log(
                    'INFO',
                    `[copilot/diff_files] diff truncado por política (${FILE_TOOLS_OUTPUT_POLICY.maxDiffOutputBytes} bytes) entre ${va.resolved} e ${vb.resolved}`,
                );
            }
            return withIoMeta(
                {
                    success: true,
                    path_a: va.resolved,
                    path_b: vb.resolved,
                    diff: diffOutput.text,
                    identical: diff.identical,
                    engine: diff.io.engine,
                    truncated: diffOutput.truncated,
                    ...(diffOutput.truncated
                        ? {
                              configuredLimitBytes: FILE_TOOLS_OUTPUT_POLICY.maxDiffOutputBytes,
                              originalDiffBytes: diffOutput.originalBytes,
                          }
                        : {}),
                },
                { ...diff.io, truncated: diffOutput.truncated },
            );
        } catch (err) {
            return { success: false, error: toError(err).message };
        }
    },
});

/**
 * Tool: workspace_symbol_search — busca símbolos no workspace via infraestrutura canônica de search.
 */
export const workspaceSymbolSearchTool = buildTool({
    name: 'workspace_symbol_search',
    description:
        'Busca símbolos (funções, classes, exports, variáveis, tipos) no workspace usando ripgrep. ' +
        'Equivalente ao “Go to Symbol in Workspace” do VS Code — retorna arquivo, linha e trecho da declaração.',
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
    }),
    handler: async ({ name: symbolName, kind, path: searchPath, includePattern, caseSensitive, maxResults }) => {
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
                includePattern,
                caseSensitive,
                maxResults,
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
                    truncated: output.truncated,
                    ...(output.truncated
                        ? {
                              configuredLimitBytes: FILE_TOOLS_OUTPUT_POLICY.maxSearchOutputBytes,
                              originalOutputBytes: output.originalBytes,
                          }
                        : {}),
                    ...(result.message ? { message: result.message } : {}),
                },
                { ...result.io, truncated: output.truncated },
            );
        } catch (err) {
            return { success: false, error: toError(err).message };
        }
    },
});

export const symbolSearchTools = [workspaceSymbolSearchTool];

/**
 * @type {import('#copilot/sdk/types').Tool<any>[]}
 */
export const fileReadTools = [
    withSkipPermission(readFileContentTool),
    listDirectoryTool,
    searchInFilesTool,
    diffFilesTool,
    withSkipPermission(workspaceSymbolSearchTool),
];
