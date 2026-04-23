// @ts-check
/**
 * src/copilot/routes/client.js
 *
 * Rotas de controle do CopilotClient e utilitários globais.
 *
 * Montadas em /api/sdk/* via sdk-api.js.
 *
 * Endpoints:
 *
 * - GET /ping — Ping ao CLI server
 * - GET /status — Estado da conexão + versão do CLI
 * - GET /auth — Status de autenticação GitHub
 * - GET /models — Lista modelos disponíveis
 * - GET /tools — Lista ferramentas (registry ou fallback estático)
 * - POST /client/start — Inicia CopilotClient
 * - POST /client/stop — Para CopilotClient (gracioso)
 * - POST /client/force-stop — Para CopilotClient forçadamente
 *
 * @module copilot/routes/client
 * @see EventBus
 */

import { log } from '#copilot/observability';
import { Router } from 'express';
import { readAgentRuntimeToolsProjection } from '../../../presentation/runtime-tools.js';
import { clearSdkRuntimeBinding, resolveSdkRuntimeProjection } from '../../../presentation/sdk-sessions.js';
import { withErrorHandler as _withErrorHandler } from './middleware.js';

/**
 * @typedef {import('express').Request} Req
 *
 * @typedef {import('express').Response} Res
 */

/**
 * Dependências injetáveis do router de client.
 *
 * @typedef {object} ClientRouterDeps
 * @property {import('#copilot/agent').AlwaysAliveAgent} agent - Instância do agente.
 * @property {() => Promise<import('@github/copilot-sdk').CopilotClient>} getClient - Factory do SDK client.
 * @property {() => string} getClientState - Estado de conexão.
 * @property {() => Promise<void | Error[]>} stopClient - Para o client.
 * @property {() => Promise<void>} forceStopClient - Para o client forçadamente.
 * @property {import('#copilot/sdk/types').Tool[]} allTools - Ferramentas estáticas.
 * @property {string} [runtimeId] - Runtime alvo resolvido na borda.
 */

/**
 * @typedef {ClientRouterDeps | ((req: Req) => ClientRouterDeps)} ClientRouterBinding
 */

/**
 * @param {ClientRouterBinding} binding
 * @param {Req} req
 * @returns {ClientRouterDeps}
 */
function resolveClientRouterDeps(binding, req) {
    return typeof binding === 'function' ? binding(req) : binding;
}

/**
 * Factory que cria o router de rotas `/client/*` com dependências injetadas.
 *
 * @param {ClientRouterBinding} deps
 * @returns {import('express').Router}
 */
export default function createClientRouter(deps) {
    const router = Router();

    /**
     * Wrapper com prefixo de log para as rotas de cliente.
     *
     * @param {Req} req
     * @param {Res} res
     * @param {() => Promise<unknown>} fn
     * @returns {Promise<void>}
     */
    const withErrorHandler = _withErrorHandler.bind(null, 'sdk-api/client');

    // ─────────────────────────────────────────────────────────────────────────────
    // GET /ping
    // ─────────────────────────────────────────────────────────────────────────────

    /**
     * Ping ao CLI server para verificar conectividade.
     */
    router.get('/ping', (req, res) => {
        void withErrorHandler(req, res, async () => {
            const { getClient } = resolveClientRouterDeps(deps, req);
            const client = await getClient();
            const result = await client.ping();
            res.json({ ok: true, ...result });
        });
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // GET /status
    // ─────────────────────────────────────────────────────────────────────────────

    /**
     * Estado da conexão do client + versão do CLI.
     */
    router.get('/status', (req, res) => {
        void withErrorHandler(req, res, async () => {
            const { agent, getClient, getClientState, runtimeId } = resolveClientRouterDeps(deps, req);
            const state = getClientState();
            if (state !== 'connected') {
                const runtimeProjection = await resolveSdkRuntimeProjection(agent, null, state);
                res.json({ ok: true, status: null, ...(runtimeId ? { runtimeId } : {}), ...runtimeProjection });
                return;
            }
            const client = await getClient();
            const status = await client.getStatus();
            const runtimeProjection = await resolveSdkRuntimeProjection(agent, client, state);
            res.json({ ok: true, ...(runtimeId ? { runtimeId } : {}), ...status, ...runtimeProjection });
        });
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // GET /auth
    // ─────────────────────────────────────────────────────────────────────────────

    /**
     * Status da autenticação GitHub do CLI.
     */
    router.get('/auth', (req, res) => {
        void withErrorHandler(req, res, async () => {
            const { getClient } = resolveClientRouterDeps(deps, req);
            const client = await getClient();
            const auth = await client.getAuthStatus();
            res.json({ ok: true, ...auth });
        });
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // GET /models
    // ─────────────────────────────────────────────────────────────────────────────

    /**
     * Lista modelos disponíveis com metadados de billing e capacidades.
     *
     * @example
     *     // GET /api/sdk/models
     *     // Response: { ok: true, models: [{ id, displayName, capabilities, billing }] }
     */
    router.get('/models', (req, res) => {
        void withErrorHandler(req, res, async () => {
            const { getClient } = resolveClientRouterDeps(deps, req);
            const client = await getClient();
            const models = await client.listModels();
            res.json({ ok: true, count: models.length, models });
        });
    });

    // ─── Controle do cliente ──────────────────────────────────────────────────────

    /**
     * POST /client/start
     *
     * Inicia (ou reconecta) o CopilotClient singleton.
     */
    router.post('/client/start', (req, res) => {
        void withErrorHandler(req, res, async () => {
            const { agent, getClient, runtimeId } = resolveClientRouterDeps(deps, req);
            const client = await getClient();
            const state = client.getState();
            const runtimeProjection = await resolveSdkRuntimeProjection(agent, client, state);
            res.json({
                ok: true,
                state,
                message: 'CopilotClient iniciado.',
                ...(runtimeId ? { runtimeId } : {}),
                ...runtimeProjection,
            });
        });
    });

    /**
     * POST /client/stop
     *
     * Para o CopilotClient singleton e limpa todas as sessões do registry.
     */
    router.post('/client/stop', (req, res) => {
        void withErrorHandler(req, res, async () => {
            const { stopClient } = resolveClientRouterDeps(deps, req);
            await stopClient();
            const sharedBinding = clearSdkRuntimeBinding();
            res.json({ ok: true, message: 'CopilotClient parado e sessões limpas.', sharedBinding });
        });
    });

    /**
     * POST /client/force-stop
     *
     * Para forçadamente o CopilotClient sem cleanup gracioso. Use quando `stop()` demora demais.
     */
    router.post('/client/force-stop', (req, res) => {
        void withErrorHandler(req, res, async () => {
            const { forceStopClient } = resolveClientRouterDeps(deps, req);
            await forceStopClient();
            const sharedBinding = clearSdkRuntimeBinding();
            log('INFO', '[sdk-api] CopilotClient force-stop executado');
            res.json({ ok: true, message: 'CopilotClient force-stop executado.', sharedBinding });
        });
    });

    // ─── Ferramentas ─────────────────────────────────────────────────────────────

    /**
     * GET /tools
     *
     * Lista as ferramentas disponíveis. Se o agente está iniciado, usa o ToolsRegistry rico (com categoria, tags,
     * readOnly, skipPermission). Caso contrário, usa allTools estático.
     */
    router.get('/tools', (_req, res) => {
        const { agent, allTools } = resolveClientRouterDeps(deps, /** @type {Req} */ (_req));
        res.json(readAgentRuntimeToolsProjection(agent, { allTools }));
    });

    return router;
}
