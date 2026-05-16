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
    findIoIndexImports,
    findIoIndexSymbol,
    getIoIndexStats,
    invalidateIoIndexPath,
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
});

const IndexSymbolParameters = z.object({
    symbol: z.string().min(1).describe('Nome ou substring do símbolo.'),
    maxResults: z.number().int().positive().max(500).optional().describe('Janela máxima de resultados. Default: 50.'),
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
    description: 'Busca textual no índice FTS5 local quando ele está disponível.',
    parameters: IndexSearchParameters,
    handler: async ({ query, maxResults }) => {
        return {
            query,
            maxResults: maxResults ?? 50,
            stats: getIoIndexStats(),
            results: searchIoIndex(query, { maxResults }),
        };
    },
});

const IndexImportParameters = z.object({
    source: z
        .string()
        .min(1)
        .describe('Módulo importado a buscar (ex: "react", "#copilot/infra", "./utils"). Aceita substring.'),
    maxResults: z.number().int().positive().max(500).optional().describe('Janela máxima de resultados. Default: 50.'),
});

export const workspaceIndexFindSymbolTool = buildTool({
    name: 'workspace_index_find_symbol',
    description: 'Busca símbolos persistidos no índice L2 local.',
    parameters: IndexSymbolParameters,
    handler: async ({ symbol, maxResults }) => {
        return {
            symbol,
            maxResults: maxResults ?? 50,
            stats: getIoIndexStats(),
            results: findIoIndexSymbol(symbol, { maxResults }),
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
        'Encontra todos os locais que referenciam ou importam um símbolo no workspace. Retorna lista estruturada de matches: arquivo, linha e trecho. Ideal para análise de impacto e rastreamento de dependências antes de refatorações.',
    parameters: IndexImportParameters,
    handler: async ({ source, maxResults }) => {
        return {
            source,
            maxResults: maxResults ?? 50,
            stats: getIoIndexStats(),
            results: findIoIndexImports(source, { maxResults }),
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
