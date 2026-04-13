// @ts-check
/**
 * src/copilot/terminal/route-table.js
 *
 * Tabela declarativa de rotas para o terminal server HTTP. Centraliza method, path, handler, auth bypass, rate limiter
 * e body parsing numa estrutura de dados inspecionável — reduzindo a lógica imperativa em server.js.
 *
 * @deprecated Onda 3.3 — substituído por `src/copilot/server/routes/` (Express routers).
 *   Mantido como implementação de fallback. Remover na Onda 3.9.
 *
 * - `method` — método HTTP (GET, POST, PUT, DELETE)
 * - `path` — pathname exato (ex: '/health') ou regex (ex: /^/sessions/[^/]+/turns$/)
 * - `handler` — função handler de http-handlers.js
 * - `skipAuth` — (opcional) true para rotas isentas de autenticação
 * - `body` — (opcional) tipo de parsing: 'json' para ler + parse JSON antes de chamar handler
 * - `rateLimiter` — (opcional) 'inject' | 'write' | 'sse' para aplicar rate limiting
 * - `rateLimiterKey` — (opcional) sufixo para a chave do rate limiter (ex: 'memory', 'pipeline')
 * - `params` — (opcional) função para extrair parâmetros de URL/query
 * - `async` — (opcional) true se o handler retorna Promise
 * - `custom` — (opcional) true para rotas que requerem handling especial (SSE, metrics)
 *
 * @module copilot/terminal/route-table
 * @see EventBus
 */

import {
    handleAcceptHandoff,
    handleDialogPause,
    handleDialogResume,
    handleGetContext,
    handleGetHandoffs,
    handleInject,
    handlePipeline,
    handleRejectHandoff,
} from './handlers/agent.js';
import {
    handleDeleteMemory,
    handleHubHealth,
    handleListSessions,
    handleListTurns,
    handleRecallMemories,
    handleStoreMemory,
} from './handlers/dialog.js';
import {
    handleDeleteCustomTool,
    handleGetConfig,
    handleGetCustomTools,
    handleGetSkills,
    handleGetToolsConfig,
    handleHealth,
    handleRegisterCustomTool,
    handleSetInfiniteSessionConfig,
    handleSetSkills,
    handleSetToolsConfig,
} from './handlers/system-config.js';
import {
    handleGetAudit,
    handleGetErrors,
    handleGetHistory,
    handleGetPrBudget,
    handleGetQuota,
    handleGetToolStats,
    handleGhCi,
    handleGhIssues,
    handleGhPrs,
    handleGitLog,
    handleGitStatus,
    handleMetrics,
    handleSystemReset,
} from './handlers/system-metrics.js';

/**
 * @typedef {Object} RouteEntry
 * @property {string} method
 * @property {string | RegExp} path
 * @property {Function} handler
 * @property {boolean} [skipAuth]
 * @property {'json'} [body]
 * @property {'inject' | 'write' | 'sse'} [rateLimiter]
 * @property {string} [rateLimiterKey]
 * @property {(url: URL, pathname: string) => Record<string, unknown>} [params]
 * @property {boolean} [async]
 * @property {boolean} [custom] - Rota com handling especial (SSE, metrics com contentType diferente)
 */

/** @type {RouteEntry[]} */
export const ROUTE_TABLE = [
    // ── Auth-exempt routes ────────────────────────────────────────────────
    { method: 'GET', path: '/health', handler: handleHealth, skipAuth: true },
    { method: 'GET', path: '/hub-health', handler: handleHubHealth, skipAuth: true },
    { method: 'GET', path: '/metrics', handler: handleMetrics, skipAuth: true, custom: true },

    // ── GET routes (simples, sem body) ────────────────────────────────────
    { method: 'GET', path: '/context', handler: handleGetContext },
    { method: 'GET', path: '/quota', handler: handleGetQuota },
    // F55 (PARTE-9): PR budget tracking
    { method: 'GET', path: '/pr-budget', handler: handleGetPrBudget },
    { method: 'GET', path: '/config', handler: handleGetConfig },
    { method: 'GET', path: '/config/skills', handler: handleGetSkills, async: true },
    { method: 'GET', path: '/config/tools', handler: handleGetToolsConfig },
    { method: 'GET', path: '/config/tools/custom', handler: handleGetCustomTools },
    // F14.1: error stats — F15.2: rate limited para evitar data mining
    { method: 'GET', path: '/errors', handler: handleGetErrors, rateLimiter: 'write', rateLimiterKey: 'errors' },
    // F14.3: tool stats — F15.2: rate limited
    {
        method: 'GET',
        path: '/tool-stats',
        handler: handleGetToolStats,
        rateLimiter: 'write',
        rateLimiterKey: 'tool-stats',
    },
    // F16.3: injection history
    {
        method: 'GET',
        path: '/history',
        handler: handleGetHistory,
        params: (url) => ({ limit: Number(url.searchParams.get('limit') ?? '50') }),
    },
    // F16.2: emergency reset — limpa rate limiters e error tracker
    { method: 'POST', path: '/system/reset', handler: handleSystemReset },

    // ── GET with query params ─────────────────────────────────────────────
    // F14.2: audit log (async + F15.2: rate limited para dados históricos sensíveis)
    {
        method: 'GET',
        path: '/audit',
        handler: handleGetAudit,
        async: true,
        rateLimiter: 'write',
        rateLimiterKey: 'audit',
        params: (url) => ({
            summary: Number(url.searchParams.get('summary') ?? '0'),
            limit: Number(url.searchParams.get('limit') ?? '50'),
            ...(url.searchParams.has('sessionId') ? { sessionId: url.searchParams.get('sessionId') } : {}),
        }),
    },
    {
        method: 'GET',
        path: '/sessions',
        handler: handleListSessions,
        params: (url) => ({
            limit: Number(url.searchParams.get('limit') ?? '20'),
            offset: Number(url.searchParams.get('offset') ?? '0'),
            ...(url.searchParams.has('status') ? { status: url.searchParams.get('status') } : {}),
        }),
    },
    {
        method: 'GET',
        path: /^\/sessions\/[^/]+\/turns$/,
        handler: handleListTurns,
        params: (_url, pathname) => ({
            sessionId: pathname.split('/')[2] ?? '',
            limit: Number(_url.searchParams.get('limit') ?? '50'),
            offset: Number(_url.searchParams.get('offset') ?? '0'),
        }),
    },
    {
        method: 'GET',
        path: '/memory',
        handler: handleRecallMemories,
        params: (url) => ({
            tag: url.searchParams.get('tag'),
            search: url.searchParams.get('search'),
            limit: Number(url.searchParams.get('limit') ?? '20'),
        }),
    },
    {
        method: 'GET',
        path: '/gh/issues',
        handler: handleGhIssues,
        async: true,
        params: (url) => ({
            state: url.searchParams.get('state') ?? 'open',
            limit: Number(url.searchParams.get('limit') ?? '15'),
        }),
    },
    {
        method: 'GET',
        path: '/gh/prs',
        handler: handleGhPrs,
        async: true,
        params: (url) => ({
            state: url.searchParams.get('state') ?? 'open',
            limit: Number(url.searchParams.get('limit') ?? '15'),
        }),
    },
    {
        method: 'GET',
        path: '/gh/ci',
        handler: handleGhCi,
        async: true,
        params: (url) => ({
            limit: Number(url.searchParams.get('limit') ?? '15'),
        }),
    },
    { method: 'GET', path: '/git/status', handler: handleGitStatus, async: true },
    {
        method: 'GET',
        path: '/git/log',
        handler: handleGitLog,
        async: true,
        params: (url) => ({
            n: Number(url.searchParams.get('n') ?? '20'),
        }),
    },

    // ── SSE (handled specially in server) ─────────────────────────────────
    { method: 'GET', path: '/events', handler: () => null, custom: true, rateLimiter: 'sse' },

    // ── PUT routes (body parsing) ─────────────────────────────────────────
    { method: 'PUT', path: '/config/infinite-session', handler: handleSetInfiniteSessionConfig, body: 'json' },
    { method: 'PUT', path: '/config/skills', handler: handleSetSkills, body: 'json', async: true },
    { method: 'PUT', path: '/config/tools', handler: handleSetToolsConfig, body: 'json' },

    // ── POST routes ───────────────────────────────────────────────────────
    { method: 'POST', path: '/config/tools/custom', handler: handleRegisterCustomTool, body: 'json' },
    {
        method: 'POST',
        path: '/memory',
        handler: handleStoreMemory,
        body: 'json',
        rateLimiter: 'write',
        rateLimiterKey: 'memory',
    },
    {
        method: 'POST',
        path: '/pipeline',
        handler: handlePipeline,
        body: 'json',
        async: true,
        rateLimiter: 'write',
        rateLimiterKey: 'pipeline',
    },
    { method: 'POST', path: '/inject', handler: handleInject, body: 'json', async: true, rateLimiter: 'inject' },
    { method: 'POST', path: '/dialog/pause', handler: handleDialogPause, async: true },
    { method: 'POST', path: '/dialog/resume', handler: handleDialogResume, async: true },
    // F45.3: Handoff API
    { method: 'GET', path: '/handoff', handler: handleGetHandoffs },
    {
        method: 'POST',
        path: /^\/handoff\/[^/]+\/accept$/,
        handler: handleAcceptHandoff,
        params: (_url, pathname) => ({ handoffId: pathname.split('/')[2] ?? '' }),
    },
    {
        method: 'POST',
        path: /^\/handoff\/[^/]+\/reject$/,
        handler: handleRejectHandoff,
        body: 'json',
        params: (_url, pathname) => ({ handoffId: pathname.split('/')[2] ?? '' }),
    },

    // ── DELETE routes ─────────────────────────────────────────────────────
    {
        method: 'DELETE',
        path: /^\/config\/tools\/custom\/.+$/,
        handler: handleDeleteCustomTool,
        params: (_url, pathname) => ({ name: decodeURIComponent(pathname.slice('/config/tools/custom/'.length)) }),
    },
    {
        method: 'DELETE',
        path: /^\/memory\/[^/]+$/,
        handler: handleDeleteMemory,
        params: (_url, pathname) => ({ memoryId: pathname.split('/')[2] ?? '' }),
    },
];

/**
 * Resolve a rota correspondente ao request.
 *
 * @param {string} method
 * @param {string} pathname
 * @returns {RouteEntry | undefined}
 */
export function matchRoute(method, pathname) {
    return ROUTE_TABLE.find((r) => {
        if (r.method !== method) return false;
        if (typeof r.path === 'string') return r.path === pathname;
        return r.path.test(pathname);
    });
}
