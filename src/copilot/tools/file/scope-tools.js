// @ts-check
import { z } from 'zod/v3';
import { buildTool } from '../infra/tool-factory.js';
import { validatePath } from './shared.js';

import {
    closeScope,
    declareScope,
    findSymbol,
    getScopeContext,
    getScopeStats,
    listScopes,
    refreshScope,
} from '#copilot/infra/public/session';

const ScopeDeclareParameters = z.object({
    sessionId: z.string().min(1).describe('ID da sessão/escopo para rastreamento da LLM-B.'),
    scopeName: z.string().min(1).optional().describe('Nome lógico do escopo (opcional).'),
    directory: z
        .string()
        .min(1)
        .optional()
        .describe('Diretório base no workspace local para warm-up e parse simbólico.'),
    maxFiles: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('Quantidade sugerida/advisory para planejamento do escopo; não bloqueia a operação.'),
    parseSymbols: z.boolean().optional().describe('Executa parse simbólico com Babel parser (default: true).'),
    indexMode: z
        .enum(['auto', 'off'])
        .optional()
        .describe('Controla indexação L2/FTS do diretório declarado. Default: auto.'),
    concurrency: z.number().int().positive().optional().describe('Concorrência sugerida/advisory do warm-up.'),
    include: z.array(z.string().min(1)).optional().describe('Padrões include.'),
    exclude: z.array(z.string().min(1)).optional().describe('Padrões exclude.'),
    recursive: z.boolean().optional().describe('Mantido para compatibilidade (advisory).'),
    awaitReady: z.boolean().optional().describe('Aguarda warm-up terminar antes de retornar.'),
});

const ScopeIdParameters = z.object({
    sessionId: z.string().min(1).describe('ID retornado por workspace_scope_declare.'),
    modifiedPaths: z.array(z.string().min(1)).optional(),
});

const ScopeContextParameters = z.object({
    sessionId: z.string().min(1).describe('ID do escopo.'),
});

const ScopeListParameters = z.object({
    includeStats: z.boolean().optional().describe('Se true, inclui stats completas de cada escopo. Default: true.'),
});

const ScopeFindSymbolParameters = z.object({
    sessionId: z.string().min(1).describe('ID do escopo.'),
    symbol: z.string().min(1).describe('Nome do símbolo para lookup.'),
    exactMatch: z.boolean().optional(),
});

export const workspaceScopeDeclareTool = buildTool({
    name: 'workspace_scope_declare',
    description:
        'Declara um escopo de trabalho para a LLM-B no FS local, pré-aquecendo cache e parser para leituras recorrentes.',
    parameters: ScopeDeclareParameters,
    handler: async ({
        sessionId,
        scopeName,
        directory,
        maxFiles,
        parseSymbols,
        indexMode,
        concurrency,
        include,
        exclude,
        recursive,
        awaitReady,
    }) => {
        const effectiveSessionId = scopeName?.trim() ? scopeName.trim() : sessionId;
        let resolvedDirectory = directory;
        if (directory) {
            const pathCheck = await validatePath(directory, { mode: 'read' });
            if (!pathCheck.ok) {
                return {
                    success: false,
                    error: pathCheck.reason,
                    sessionId: effectiveSessionId,
                };
            }
            resolvedDirectory = pathCheck.resolved;
        }
        const scope = await Promise.resolve(
            declareScope({
                sessionId: effectiveSessionId,
                directory: resolvedDirectory,
                maxFiles,
                parseSymbols,
                indexMode,
                concurrency,
                include,
                exclude,
                recursive,
            }),
        );
        const advisoryLimits = {
            requestedMaxFiles: maxFiles ?? null,
            requestedConcurrency: concurrency ?? null,
            includePatternCount: include?.length ?? 0,
            excludePatternCount: exclude?.length ?? 0,
            recursive: recursive ?? true,
            limitMode: 'informative',
        };

        if (awaitReady && typeof scope.awaitReady === 'function') {
            const stats = await scope.awaitReady();
            return {
                sessionId: effectiveSessionId,
                scope,
                stats,
                advisoryLimits,
            };
        }

        return {
            sessionId: effectiveSessionId,
            scope,
            advisoryLimits,
        };
    },
});

export const workspaceScopeRefreshTool = buildTool({
    name: 'workspace_scope_refresh',
    description: 'Atualiza o escopo de trabalho declarado para refletir alterações recentes de arquivos.',
    parameters: ScopeIdParameters,
    handler: async ({ sessionId, modifiedPaths }) => {
        if (!modifiedPaths || modifiedPaths.length === 0) {
            return refreshScope(sessionId, modifiedPaths);
        }

        /** @type {string[]} */
        const resolvedPaths = [];
        for (const filePath of modifiedPaths) {
            const pathCheck = await validatePath(filePath, { mode: 'read' });
            if (!pathCheck.ok) {
                return {
                    success: false,
                    error: pathCheck.reason,
                    path: filePath,
                    refreshed: 0,
                    failed: 0,
                };
            }
            resolvedPaths.push(pathCheck.resolved);
        }
        return refreshScope(sessionId, resolvedPaths);
    },
});

export const workspaceScopeListTool = buildTool({
    name: 'workspace_scope_list',
    description: 'Lista escopos de trabalho ativos da LLM-B e seus stats de cache/parser quando solicitado.',
    parameters: ScopeListParameters,
    handler: async ({ includeStats = true }) => {
        const sessionIds = listScopes();
        if (!includeStats) return { sessionIds };
        return {
            sessionIds,
            scopes: sessionIds.map((sessionId) => getScopeStats(sessionId)).filter(Boolean),
        };
    },
});

export const workspaceScopeContextTool = buildTool({
    name: 'workspace_scope_context',
    description:
        'Retorna contexto resumido do escopo (arquivos quentes, símbolos e imports) para orientar próximas leituras da LLM-B.',
    parameters: ScopeContextParameters,
    handler: async ({ sessionId }) => {
        return getScopeContext(sessionId);
    },
});

export const workspaceScopeFindSymbolTool = buildTool({
    name: 'workspace_scope_find_symbol',
    description: 'Busca símbolo indexado no escopo ativo sem re-scan completo do diretório.',
    parameters: ScopeFindSymbolParameters,
    handler: async ({ sessionId, symbol, exactMatch }) => {
        return findSymbol(sessionId, symbol, { exactMatch });
    },
});

export const workspaceScopeCloseTool = buildTool({
    name: 'workspace_scope_close',
    description: 'Fecha um escopo de trabalho ativo e libera os recursos associados de prefetch/indexação.',
    parameters: ScopeContextParameters,
    handler: async ({ sessionId }) => {
        return closeScope(sessionId);
    },
});

export const scopeTools = [
    workspaceScopeDeclareTool,
    workspaceScopeListTool,
    workspaceScopeRefreshTool,
    workspaceScopeContextTool,
    workspaceScopeFindSymbolTool,
    workspaceScopeCloseTool,
];
