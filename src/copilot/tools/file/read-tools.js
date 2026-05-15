// @ts-check
import { toError, withIoMeta } from '#copilot/core';
import { diffText, scanDirectory, searchText, searchWorkspaceSymbols } from '#copilot/infra/public/io';
import { stat as fsStat } from 'node:fs/promises';
import { z } from 'zod';
import { log } from '../infra/logger.js';
import { buildTool, withSkipPermission } from '../infra/tool-factory.js';
import { readFileContentTool } from './read/index.js';
/**
 * src/copilot/tools/file/read-tools.js
 *
 * Superfície canônica unificada das file read tools.
 *
 * Este arquivo concentra a composição pública das tools de leitura/busca/símbolo do subdomínio `file`, evitando a
 * fragmentação histórica entre superfícies concorrentes.
 *
 * Princípios:
 *
 * - uma única superfície pública de leitura (`fileReadTools`);
 * - todas as tools expõem metadados de I/O canônicos;
 * - implementações grandes podem viver em subdomínios internos com barrel próprio, mantendo este módulo como facade.
 *
 * @module copilot/tools/file/read-tools
 */

import {
    applyEntryLimit,
    applyEntryWindow,
    FILE_TOOLS_OUTPUT_POLICY,
    truncateUtf8Text,
    validatePath,
    WORKSPACE_ROOT,
} from './shared.js';

export { readFileContentTool } from './read/index.js';

/**
 * @typedef {object} IoScanEntry
 * @property {string} name
 * @property {'file' | 'directory' | 'symlink' | 'other'} type
 * @property {string} path
 * @property {number} [size]
 * @property {IoScanEntry[]} [children]
 */

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
        maxEntries: z.number().int().positive().optional().describe('Máximo de entradas de topo a retornar.'),
        cursor: z.string().optional().describe('Cursor numérico retornado por chamada anterior.'),
    }),
    handler: async ({ path: dirPath, recursive, depth, showHidden, filter, maxEntries, cursor }) => {
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
            const configuredMaxEntries = maxEntries ?? FILE_TOOLS_OUTPUT_POLICY.maxListEntries;
            const limitedEntries =
                cursor !== undefined || maxEntries !== undefined
                    ? applyEntryWindow(entries, { maxEntries: configuredMaxEntries, cursor })
                    : applyEntryLimit(entries, configuredMaxEntries);
            if (limitedEntries.truncated) {
                log(
                    'INFO',
                    `[copilot/list_directory] saída truncada por política (${configuredMaxEntries} entries) em ${resolved}`,
                );
            }
            return withIoMeta(
                {
                    success: true,
                    path: resolved,
                    count: limitedEntries.entries.length,
                    truncated: limitedEntries.truncated,
                    nextCursor: 'nextCursor' in limitedEntries ? limitedEntries.nextCursor : null,
                    cursorOffset: 'cursorOffset' in limitedEntries ? limitedEntries.cursorOffset : 0,
                    scannedBudget: scan.scannedEntries,
                    totalEntries: limitedEntries.totalEntries,
                    ...(limitedEntries.truncated ? { configuredLimitEntries: configuredMaxEntries } : {}),
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
        cursor: z.string().optional().describe('Cursor numérico retornado por chamada anterior.'),
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
        cursor,
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
                    `[copilot/search_in_files] saída truncada por política (${FILE_TOOLS_OUTPUT_POLICY.maxSearchOutputBytes} bytes) em ${resolved}`,
                );
            }
            return withIoMeta(
                {
                    success: true,
                    pattern,
                    searchPath: resolved,
                    output: output.text,
                    truncated: output.truncated || Boolean(result.truncated),
                    nextCursor: result.nextCursor ?? null,
                    cursorOffset: result.cursorOffset ?? 0,
                    totalMatches: result.totalMatches ?? result.matchCount,
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
                { ...result.io, truncated: output.truncated || Boolean(result.truncated) },
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
        cursor: z.string().optional().describe('Cursor numérico retornado por chamada anterior.'),
    }),
    handler: async ({
        name: symbolName,
        kind,
        path: searchPath,
        includePattern,
        caseSensitive,
        maxResults,
        cursor,
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

/**
 * Escapes a string for use as a literal in a regex pattern.
 * @param {string} s
 * @returns {string}
 */
function escapeForRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Parses raw ripgrep output (contextLines=0) into structured match objects.
 * Each line is expected to be in the format `absolute/path:lineNum:text`.
 * @param {string} output - Raw stdout from ripgrep
 * @param {string} workspaceRoot - Absolute workspace root to strip from paths
 * @returns {{ matches: Array<{file: string, line: number, text: string}>, fileCount: number }}
 */
function parseUsageOutput(output, workspaceRoot) {
    /** @type {Array<{file: string, line: number, text: string}>} */
    const matches = [];
    const files = new Set();
    const root = workspaceRoot.endsWith('/') ? workspaceRoot : `${workspaceRoot}/`;
    for (const rawLine of output.split('\n')) {
        if (!rawLine.trim() || rawLine === '--') continue;
        // Non-greedy path group finds the first `:digit:` split → line number
        const m = rawLine.match(/^(.+?):(\d+):(.*)$/);
        if (!m) continue;
        const filePath = m[1];
        const lineStr = m[2];
        if (!filePath || !lineStr) continue;
        const lineNum = Number(lineStr);
        const text = (m[3] ?? '').trimEnd();
        const rel = filePath.startsWith(root) ? filePath.slice(root.length) : filePath;
        files.add(rel);
        matches.push({ file: rel, line: lineNum, text });
    }
    return { matches, fileCount: files.size };
}

/**
 * Tool: find_symbol_usages — encontra todos os usos de um símbolo no workspace.
 */
export const findSymbolUsagesTool = buildTool({
    name: 'find_symbol_usages',
    description:
        'Encontra todos os locais que referenciam ou importam um símbolo no workspace. ' +
        'Retorna lista estruturada de matches: arquivo, linha e trecho. ' +
        'Ideal para análise de impacto e rastreamento de dependências antes de refatorações.',
    parameters: z.object({
        symbol: z
            .string()
            .min(1)
            .describe('Nome do símbolo a buscar (ex: "bindAgentInfoProvider", "AgentContext")'),
        path: z
            .string()
            .optional()
            .default('.')
            .describe('Diretório de busca (relativo ao workspace). Default: raiz.'),
        includePattern: z
            .string()
            .optional()
            .default('*.{js,ts,mjs,cjs}')
            .describe('Glob de arquivos a incluir. Default: arquivos JS/TS.'),
        excludePattern: z.string().optional().describe('Glob de arquivos a excluir (ex: "node_modules,dist").'),
        wholeWord: z
            .boolean()
            .optional()
            .default(true)
            .describe('Se true, busca somente o símbolo como palavra inteira (\\bsymbol\\b). Default: true.'),
        caseSensitive: z
            .boolean()
            .optional()
            .default(true)
            .describe('Busca sensível a maiúsculas. Default: true para símbolos.'),
        maxResults: z.number().int().min(1).optional().describe('Máximo de matches a retornar.'),
        cursor: z
            .string()
            .optional()
            .describe(
                'Cursor de paginação retornado em chamada anterior (campo nextCursor). ' +
                    'Omitir para iniciar da primeira página.',
            ),
    }),
    handler: async ({
        symbol,
        path: searchPath,
        includePattern,
        excludePattern,
        wholeWord,
        caseSensitive,
        maxResults,
        cursor,
    }) => {
        const { ok, reason, resolved } = await validatePath(searchPath ?? '.', { mode: 'read' });
        if (!ok) return { success: false, error: reason };

        const escaped = escapeForRegex(symbol);
        const pattern = wholeWord !== false ? `\\b${escaped}\\b` : escaped;

        log('INFO', `[copilot/find_symbol_usages] symbol="${symbol}" wholeWord=${wholeWord} in ${resolved}`);

        try {
            const result = await searchText(resolved, {
                workspaceRoot: WORKSPACE_ROOT,
                pattern,
                isRegex: true,
                caseSensitive: caseSensitive !== false,
                withLineNumbers: true,
                contextLines: 0,
                includePattern: includePattern ?? '*.{js,ts,mjs,cjs}',
                ...(excludePattern ? { excludePattern } : {}),
                ...(maxResults ? { maxResults } : {}),
                ...(cursor ? { cursor } : {}),
            });

            const { matches, fileCount } = parseUsageOutput(result.output, WORKSPACE_ROOT);
            return withIoMeta(
                {
                    success: true,
                    symbol,
                    searchPath: resolved,
                    matchCount: matches.length,
                    fileCount,
                    matches,
                    engine: result.engine,
                    sanitized: result.sanitized,
                    ...(result.truncated ? { truncated: result.truncated } : {}),
                    ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
                },
                result.io,
            );
        } catch (err) {
            return { success: false, error: toError(err).message };
        }
    },
});

export const symbolSearchTools = [workspaceSymbolSearchTool, findSymbolUsagesTool];

/**
 * @type {import('#copilot/sdk/types').Tool<any>[]}
 */
export const fileReadTools = [
    withSkipPermission(readFileContentTool),
    listDirectoryTool,
    searchInFilesTool,
    diffFilesTool,
    withSkipPermission(workspaceSymbolSearchTool),
    withSkipPermission(findSymbolUsagesTool),
];
