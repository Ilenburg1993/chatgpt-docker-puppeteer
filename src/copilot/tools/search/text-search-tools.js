// @ts-check
/**
 * Search tools de texto: `search_in_files` e `find_symbol_usages`.
 *
 * Owner canônico das tools de busca textual do workspace. Extraído de `file/read-tools.js` para separar a superfície de
 * search da superfície de file-read com clareza arquitetural.
 *
 * @module copilot/tools/search/text-search-tools
 */

import { toError, withIoMeta } from '#copilot/core';
import { createWorkspaceIo } from '#copilot/infra/public/workspace-io';
import { z } from 'zod';
import { FILE_TOOLS_OUTPUT_POLICY, truncateUtf8Text, validatePath, WORKSPACE_ROOT } from '../file/shared.js';
import { log } from '../infra/logger.js';
import { buildTool } from '../infra/tool-factory.js';

const { searchText } = createWorkspaceIo({ workspaceRoot: WORKSPACE_ROOT });

/**
 * Escapes a string for use as a literal in a regex pattern.
 *
 * @param {string} s
 * @returns {string}
 */
export function escapeForRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Parses raw ripgrep output (contextLines=0) into structured match objects. Each line is expected to be in the format
 * `absolute/path:lineNum:text`.
 *
 * @param {string} output - Raw stdout from ripgrep
 * @param {string} workspaceRoot - Absolute workspace root to strip from paths
 * @returns {{ matches: { file: string; line: number; text: string }[]; fileCount: number }}
 */
export function parseUsageOutput(output, workspaceRoot) {
    /** @type {{ file: string; line: number; text: string }[]} */
    const matches = [];
    const files = new Set();
    const root = workspaceRoot.endsWith('/') ? workspaceRoot : `${workspaceRoot}/`;
    for (const rawLine of output.split('\n')) {
        if (!rawLine.trim() || rawLine === '--') continue;
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
 * @param {{ file: string; line: number; text: string }[]} matches
 * @returns {string}
 */
export function formatUsageMatches(matches) {
    return matches.map((match) => `${match.file}:${match.line}: ${match.text}`.trimEnd()).join('\n');
}

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
                    indexFallback: result.indexFallback ?? false,
                    indexFallbackReason: result.indexFallbackReason ?? null,
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
 * Tool: find_symbol_usages — encontra todos os usos de um símbolo no workspace.
 */
export const findSymbolUsagesTool = buildTool({
    name: 'find_symbol_usages',
    description:
        'Encontra todos os locais que referenciam ou importam um símbolo no workspace. ' +
        'Retorna lista estruturada de matches: arquivo, linha e trecho. ' +
        'Ideal para análise de impacto e rastreamento de dependências antes de refatorações.',
    parameters: z.object({
        symbol: z.string().min(1).describe('Nome do símbolo a buscar (ex: "bindAgentInfoProvider", "AgentContext")'),
        path: z.string().optional().default('.').describe('Diretório de busca (relativo ao workspace). Default: raiz.'),
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
                    output: formatUsageMatches(matches),
                    matchCount: matches.length,
                    fileCount,
                    matches,
                    engine: result.engine,
                    sanitized: result.sanitized,
                    truncated: Boolean(result.truncated),
                    nextCursor: result.nextCursor ?? null,
                },
                result.io,
            );
        } catch (err) {
            return { success: false, error: toError(err).message };
        }
    },
});
