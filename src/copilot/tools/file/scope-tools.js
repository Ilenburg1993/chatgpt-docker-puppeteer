// @ts-check
import { isAbsolute, relative } from 'node:path';
import { z } from 'zod/v3';
import { buildTool } from '../infra/tool-factory.js';
import { validatePath, WORKSPACE_ROOT } from './shared.js';

import {
    closeScope,
    declareScope,
    findSymbol,
    getScopeContext,
    getScopeStats,
    invalidateScopePath,
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
        .describe('Limite efetivo de arquivos selecionados quando directory é usado. Default: 500.'),
    parseSymbols: z.boolean().optional().describe('Executa parse simbólico com Babel parser (default: true).'),
    indexMode: z
        .enum(['auto', 'off'])
        .optional()
        .describe('auto converge somente os paths selecionados no índice global; off desativa indexação do scope.'),
    selectionMode: z
        .enum(['coverage', 'lexical'])
        .optional()
        .describe('Seleção bounded do diretório. Default: coverage; lexical preserva o prefixo histórico.'),
    seedPaths: z
        .array(z.string().min(1))
        .max(32)
        .optional()
        .describe('Arquivos preferenciais dentro do diretório, sempre contando no mesmo maxFiles.'),
    seedSymbols: z
        .array(z.string().min(1).max(256))
        .max(32)
        .optional()
        .describe('Símbolos exatos resolvidos pelo índice local para arquivos preferenciais dentro do mesmo maxFiles.'),
    concurrency: z.number().int().positive().optional().describe('Concorrência efetiva/bounded do warm-up e refresh.'),
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
    maxFiles: z.number().int().positive().max(200).optional().describe('Máximo de entries no manifest. Default: 40.'),
    maxBytes: z.number().int().positive().max(65536).optional().describe('Budget UTF-8 do manifest. Default: 16 KiB.'),
});

const ScopeInvalidatePathParameters = z.object({
    sessionId: z.string().min(1).describe('ID do escopo.'),
    path: z.string().min(1).describe('Arquivo do workspace a invalidar no cache e índice simbólico do escopo.'),
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
        selectionMode,
        seedPaths,
        seedSymbols,
        concurrency,
        include,
        exclude,
        recursive,
        awaitReady,
    }) => {
        // sessionId é o identificador canônico do escopo. scopeName é apenas um label display opcional.
        const effectiveSessionId = sessionId;
        const displayName = scopeName?.trim() || sessionId;
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
        if ((seedPaths?.length || seedSymbols?.length) && !resolvedDirectory) {
            return {
                success: false,
                error: 'seedPaths/seedSymbols exigem directory para manter containment e seleção bounded.',
                code: 'ERR_SCOPE_SEED_REQUIRES_DIRECTORY',
                sessionId: effectiveSessionId,
            };
        }
        /** @type {string[]} */
        const preferredPaths = [];
        for (const candidate of seedPaths ?? []) {
            const pathCheck = await validatePath(candidate, { mode: 'read' });
            if (!pathCheck.ok) {
                return {
                    success: false,
                    error: pathCheck.reason,
                    sessionId: effectiveSessionId,
                };
            }
            if (resolvedDirectory) {
                const fromRoot = relative(resolvedDirectory, pathCheck.resolved);
                if (
                    fromRoot === '..' ||
                    fromRoot.startsWith('../') ||
                    fromRoot.startsWith('..\\') ||
                    isAbsolute(fromRoot)
                ) {
                    return {
                        success: false,
                        error: 'seedPath deve permanecer dentro do directory declarado.',
                        code: 'ERR_SCOPE_SEED_OUTSIDE_ROOT',
                        sessionId: effectiveSessionId,
                    };
                }
            }
            preferredPaths.push(pathCheck.resolved);
        }
        const scope = await Promise.resolve(
            declareScope({
                sessionId: effectiveSessionId,
                directory: resolvedDirectory,
                workspaceRoot: WORKSPACE_ROOT,
                maxFiles,
                parseSymbols,
                indexMode,
                selectionMode,
                preferredPaths,
                seedSymbols,
                concurrency,
                include,
                exclude,
                recursive,
            }),
        );
        const advisoryLimits = {
            requestedMaxFiles: maxFiles ?? null,
            requestedConcurrency: concurrency ?? null,
            selectionMode: selectionMode ?? 'coverage',
            seedPathCount: seedPaths?.length ?? 0,
            seedSymbolCount: seedSymbols?.length ?? 0,
            includePatternCount: include?.length ?? 0,
            excludePatternCount: exclude?.length ?? 0,
            recursive: recursive ?? true,
            limitMode: directory ? 'enforced-max-files' : 'explicit-paths',
        };

        if (awaitReady && typeof scope.awaitReady === 'function') {
            const stats = await scope.awaitReady();
            return {
                sessionId: effectiveSessionId,
                scopeName: displayName,
                scope,
                stats,
                advisoryLimits,
            };
        }

        return {
            sessionId: effectiveSessionId,
            scopeName: displayName,
            scope,
            advisoryLimits,
        };
    },
});

export const workspaceScopeRefreshTool = buildTool({
    name: 'workspace_scope_refresh',
    description: 'Atualiza somente paths modificados/invalidados do escopo; sem delta conhecido é no-op.',
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

export const workspaceScopeInvalidatePathTool = buildTool({
    name: 'workspace_scope_invalidate_path',
    description: 'Invalida um path no cache e índice simbólico de um escopo sem re-parse imediato.',
    parameters: ScopeInvalidatePathParameters,
    handler: async ({ sessionId, path }) => {
        const pathCheck = await validatePath(path, { mode: 'read' });
        if (!pathCheck.ok) return { success: false, error: pathCheck.reason, path };
        invalidateScopePath(sessionId, pathCheck.resolved);
        return { success: true, sessionId, path: pathCheck.resolved };
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
    handler: async ({ sessionId, maxFiles, maxBytes }) => {
        return getScopeContext(sessionId, { maxFiles, maxBytes });
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
    workspaceScopeInvalidatePathTool,
    workspaceScopeContextTool,
    workspaceScopeFindSymbolTool,
    workspaceScopeCloseTool,
];
