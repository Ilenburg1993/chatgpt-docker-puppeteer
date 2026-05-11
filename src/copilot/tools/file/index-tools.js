// @ts-check
/**
 * Tools canônicas para o índice L2 de arquivos.
 *
 * O índice complementa `search_in_files`: ele é ótimo quando está disponível/fresco; `rg` continua fallback explícito
 * para regex complexa, workspaces ainda não indexados ou auditoria por fonte bruta.
 *
 * @module copilot/tools/file/index-tools
 */

import { z } from 'zod/v3';
import { buildIoIndexForDirectory, findIoIndexSymbol, getIoIndexStats, searchIoIndex } from '../../infra/index.js';
import { buildTool } from '../infra/tool-factory.js';

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
});

const IndexSymbolParameters = z.object({
    symbol: z.string().min(1).describe('Nome ou substring do símbolo.'),
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
        return buildIoIndexForDirectory(directory, options);
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
    handler: async ({ query }) => {
        return {
            query,
            stats: getIoIndexStats(),
            results: searchIoIndex(query),
        };
    },
});

export const workspaceIndexFindSymbolTool = buildTool({
    name: 'workspace_index_find_symbol',
    description: 'Busca símbolos persistidos no índice L2 local.',
    parameters: IndexSymbolParameters,
    handler: async ({ symbol }) => {
        return {
            symbol,
            stats: getIoIndexStats(),
            results: findIoIndexSymbol(symbol),
        };
    },
});

export const indexTools = [
    workspaceIndexBuildTool,
    workspaceIndexStatusTool,
    workspaceIndexSearchTool,
    workspaceIndexFindSymbolTool,
];
