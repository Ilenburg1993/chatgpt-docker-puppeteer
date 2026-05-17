// @ts-check
import { z } from 'zod/v3';
import { buildTool } from '../infra/tool-factory.js';
import { validatePath } from './shared.js';
/**
 * Tools canônicas para o índice L2 de arquivos.
 *
 * O índice complementa `search_in_files`: ele é ótimo quando está disponível/fresco; `rg` continua fallback explícito
 * para regex complexa, workspaces ainda não indexados ou auditoria por fonte bruta.
 *
 * @module copilot/tools/file/index-tools
 */

import {
    buildIoIndexForDirectory,
    filterIndexRowsByGlob,
    findIoIndexImports,
    findIoIndexSymbol,
    formatIndexImportRows,
    formatIndexSearchRows,
    formatIndexSymbolRows,
    getIoIndexStats,
    invalidateIoIndexPath,
    normalizeSearchWindow,
    paginateSearchItems,
    searchIoIndex,
} from '#copilot/infra/public/indexing';

const IndexBuildParameters = z.object({
    directory: z.string().min(1).describe('Diretório local a indexar.'),
    recursive: z.boolean().optional().describe('Indexa recursivamente. Default: true.'),
    depth: z.number().int().positive().optional().describe('Profundidade sugerida/advisory do scan.'),
    respectGitignore: z.boolean().optional().describe('Respeita .gitignore. Default: true.'),
    include: z.array(z.string().min(1)).optional().describe('Padrões include para scan.'),
    exclude: z.array(z.string().min(1)).optional().describe('Padrões exclude para scan.'),
    extensions: z.array(z.string().min(1)).optional().describe('Extensões textuais a indexar.'),
    concurrency: z.number().int().positive().optional().describe('Concorrência sugerida/advisory.'),
    pruneMissing: z
        .boolean()
        .optional()
        .describe('Remove do índice arquivos ausentes no filesystem quando o build representa uma fatia completa.'),
});

const IndexSearchParameters = z.object({
    query: z.string().min(1).describe('Consulta textual para FTS5.'),
    maxResults: z.number().int().positive().max(500).optional().describe('Janela máxima de resultados. Default: 50.'),
    cursor: z.string().optional().describe('Cursor numérico retornado por chamada anterior.'),
    includePattern: z.string().optional().describe('Filtro glob de arquivos a incluir (ex: *.ts, src/**/*.js).'),
    excludePattern: z.string().optional().describe('Filtro glob de arquivos a excluir (ex: node_modules, dist).'),
});

const IndexSymbolParameters = z.object({
    symbol: z.string().min(1).describe('Nome ou substring do símbolo.'),
    maxResults: z.number().int().positive().max(500).optional().describe('Janela máxima de resultados. Default: 50.'),
    cursor: z.string().optional().describe('Cursor numérico retornado por chamada anterior.'),
    exactMatch: z
        .boolean()
        .optional()
        .describe('Se true, busca correspondência exata ao invés de substring. Default: false.'),
});

const IndexImportParameters = z.object({
    source: z
        .string()
        .min(1)
        .describe('Módulo importado a buscar (ex: "react", "#copilot/infra", "./utils"). Aceita substring.'),
    maxResults: z.number().int().positive().max(500).optional().describe('Janela máxima de resultados. Default: 50.'),
    cursor: z.string().optional().describe('Cursor numérico retornado por chamada anterior.'),
});

export const workspaceIndexBuildTool = buildTool({
    name: 'workspace_index_build',
    description:
        'Constrói/atualiza o índice L2 local de arquivos: metadados, FTS textual, símbolos Babel e imports. Não substitui rg; torna busca/indexação observáveis.',
    parameters: IndexBuildParameters,
    handler: async ({
        directory,
        recursive,
        depth,
        respectGitignore,
        include,
        exclude,
        extensions,
        concurrency,
        pruneMissing,
    }) => {
        const pathCheck = await validatePath(directory, { mode: 'read' });
        if (!pathCheck.ok) {
            return {
                available: false,
                success: false,
                indexed: 0,
                skipped: 0,
                failed: 0,
                durationMs: 0,
                error: pathCheck.reason,
            };
        }
        /** @type {Parameters<typeof buildIoIndexForDirectory>[1]} */
        const options = {};
        if (recursive !== undefined) options.recursive = recursive;
        if (depth !== undefined) options.depth = depth;
        if (respectGitignore !== undefined) options.respectGitignore = respectGitignore;
        if (include !== undefined) options.include = include;
        if (exclude !== undefined) options.exclude = exclude;
        if (extensions !== undefined) options.extensions = extensions;
        if (concurrency !== undefined) options.concurrency = concurrency;
        if (pruneMissing !== undefined) options.pruneMissing = pruneMissing;
        return buildIoIndexForDirectory(pathCheck.resolved, options);
    },
});

export const workspaceIndexStatusTool = buildTool({
    name: 'workspace_index_status',
    description: 'Retorna disponibilidade e metadados do índice L2 local de arquivos.',
    parameters: z.object({}),
    handler: async () => getIoIndexStats(),
});

export const workspaceIndexSearchTool = buildTool({
    name: 'workspace_index_search',
    description:
        'Busca textual no índice FTS5 local quando ele está disponível. ' +
        'Retorna `output` string formatada com highlights (**match**), `matchCount`, `totalMatches` e `nextCursor` para paginação.',
    parameters: IndexSearchParameters,
    handler: async ({ query, maxResults, cursor, includePattern, excludePattern }) => {
        const stats = getIoIndexStats();
        if (!stats.available) {
            return { query, output: '', matchCount: 0, totalMatches: 0, truncated: false, nextCursor: null, engine: 'fts5-index', available: false, stats };
        }
        const window = normalizeSearchWindow({ maxResults, cursor });
        const rows = searchIoIndex(query, window.commandMaxCount != null ? { maxResults: window.commandMaxCount } : {});
        const filtered = filterIndexRowsByGlob(rows, includePattern, excludePattern);
        const paged = paginateSearchItems(filtered, window);
        return {
            query,
            output: formatIndexSearchRows(paged.items),
            matchCount: paged.items.length,
            totalMatches: paged.totalItems,
            truncated: paged.truncated,
            nextCursor: paged.nextCursor,
            cursorOffset: paged.cursorOffset,
            engine: 'fts5-index',
            stats,
        };
    },
});

export const workspaceIndexFindSymbolTool = buildTool({
    name: 'workspace_index_find_symbol',
    description:
        'Busca símbolos persistidos no índice L2 local. ' +
        'Retorna `output` string formatada com arquivo:linha e tipo de símbolo, `matchCount` e `nextCursor` para paginação.',
    parameters: IndexSymbolParameters,
    handler: async ({ symbol, maxResults, cursor, exactMatch }) => {
        const stats = getIoIndexStats();
        if (!stats.available) {
            return { symbol, output: '', matchCount: 0, totalMatches: 0, truncated: false, nextCursor: null, engine: 'fts5-index', available: false, stats };
        }
        const window = normalizeSearchWindow({ maxResults, cursor });
        const rows = findIoIndexSymbol(symbol, window.commandMaxCount != null ? { maxResults: window.commandMaxCount } : {});
        const filtered = exactMatch ? rows.filter((r) => r.symbolName === symbol) : rows;
        const paged = paginateSearchItems(filtered, window);
        return {
            symbol,
            output: formatIndexSymbolRows(paged.items),
            matchCount: paged.items.length,
            totalMatches: paged.totalItems,
            truncated: paged.truncated,
            nextCursor: paged.nextCursor,
            cursorOffset: paged.cursorOffset,
            engine: 'fts5-index',
            stats,
        };
    },
});

export const workspaceIndexInvalidateTool = buildTool({
    name: 'workspace_index_invalidate',
    description:
        'Invalida arquivo ou diretório no índice L2. ' +
        'Use após modificar arquivos para manter o índice fresco antes de buscas subsequentes.',
    parameters: z.object({
        path: z.string().min(1).describe('Caminho do arquivo ou diretório a invalidar no índice.'),
    }),
    handler: async ({ path }) => {
        const pathCheck = await validatePath(path, { mode: 'read' });
        if (!pathCheck.ok) return { success: false, error: pathCheck.reason };
        const invalidated = invalidateIoIndexPath(pathCheck.resolved);
        return {
            success: true,
            path: pathCheck.resolved,
            invalidated,
            stats: getIoIndexStats(),
        };
    },
});

export const workspaceIndexFindImportsTool = buildTool({
    name: 'workspace_find_imports',
    description:
        'Encontra todos os locais que referenciam ou importam um símbolo no workspace. ' +
        'Retorna `output` string formatada com arquivo:linha, especificadores e módulo do import, `matchCount` e `nextCursor`.',
    parameters: IndexImportParameters,
    handler: async ({ source, maxResults, cursor }) => {
        const stats = getIoIndexStats();
        if (!stats.available) {
            return { source, output: '', matchCount: 0, totalMatches: 0, truncated: false, nextCursor: null, engine: 'fts5-index', available: false, stats };
        }
        const window = normalizeSearchWindow({ maxResults, cursor });
        const rows = findIoIndexImports(source, window.commandMaxCount != null ? { maxResults: window.commandMaxCount } : {});
        const paged = paginateSearchItems(rows, window);
        return {
            source,
            output: formatIndexImportRows(paged.items),
            matchCount: paged.items.length,
            totalMatches: paged.totalItems,
            truncated: paged.truncated,
            nextCursor: paged.nextCursor,
            cursorOffset: paged.cursorOffset,
            engine: 'fts5-index',
            stats,
        };
    },
});

export const indexTools = [
    workspaceIndexBuildTool,
    workspaceIndexStatusTool,
    workspaceIndexSearchTool,
    workspaceIndexFindSymbolTool,
    workspaceIndexInvalidateTool,
    workspaceIndexFindImportsTool,
];
