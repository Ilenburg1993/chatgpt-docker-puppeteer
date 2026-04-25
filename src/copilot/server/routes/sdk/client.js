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

import { toolsList } from '#copilot/sdk';
import { Router } from 'express';
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
 * @property {ReturnType<import('./deps.js').buildDefaultSdkRouteSharedDeps>['sdkRuntimeProjection']} sdkRuntimeProjection
 * @property {ReturnType<import('./deps.js').buildDefaultSdkRouteSharedDeps>['sdkSessionOwnership']} sdkSessionOwnership
 * @property {ReturnType<import('./deps.js').buildDefaultSdkRouteSharedDeps>['sdkObservability']} sdkObservability
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

/** @type {ReadonlySet<string>} */
const DEPRECATED_CUSTOM_TOOL_NAMES = new Set(['legacy_web_fetch', 'legacy_report_intent']);

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
            const { agent, getClient, getClientState, runtimeId, sdkSessionOwnership } = resolveClientRouterDeps(
                deps,
                req,
            );
            const state = getClientState();
            if (state !== 'connected') {
                const runtimeProjection = await sdkSessionOwnership.resolveSdkRuntimeProjection(agent, null, state);
                res.json({ ok: true, status: null, ...(runtimeId ? { runtimeId } : {}), ...runtimeProjection });
                return;
            }
            const client = await getClient();
            const status = await client.getStatus();
            const runtimeProjection = await sdkSessionOwnership.resolveSdkRuntimeProjection(agent, client, state);
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
            const { agent, getClient, runtimeId, sdkSessionOwnership } = resolveClientRouterDeps(deps, req);
            const client = await getClient();
            const state = client.getState();
            const runtimeProjection = await sdkSessionOwnership.resolveSdkRuntimeProjection(agent, client, state);
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
            const { stopClient, sdkSessionOwnership } = resolveClientRouterDeps(deps, req);
            await stopClient();
            const sharedBinding = sdkSessionOwnership.clearSdkRuntimeBinding();
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
            const { forceStopClient, sdkSessionOwnership, sdkObservability } = resolveClientRouterDeps(deps, req);
            await forceStopClient();
            const sharedBinding = sdkSessionOwnership.clearSdkRuntimeBinding();
            sdkObservability.log('INFO', '[sdk-api] CopilotClient force-stop executado');
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
        void withErrorHandler(/** @type {Req} */ (_req), res, async () => {
            const { agent, allTools, sdkRuntimeProjection, getClientState, getClient, sdkObservability } =
                resolveClientRouterDeps(deps, /** @type {Req} */ (_req));
            const projection = sdkRuntimeProjection.readAgentRuntimeToolsProjection(agent, { allTools });

            /** @type {{ name: string; description?: string; hasParameters: boolean }[]} */
            let cliBuiltins = [];
            let cliToolsSource = 'unavailable';
            const state = getClientState();
            if (state === 'connected') {
                try {
                    const client = await getClient();
                    const builtins = await toolsList(client, {});
                    cliBuiltins = (builtins.tools ?? []).map((tool) => ({
                        name: tool.name,
                        ...(tool.description ? { description: tool.description } : {}),
                        hasParameters:
                            tool.parameters !== undefined &&
                            tool.parameters !== null &&
                            typeof tool.parameters === 'object',
                    }));
                    cliToolsSource = 'rpc';
                } catch (error) {
                    sdkObservability.log(
                        'WARN',
                        `[sdk-api/tools] Falha ao consultar built-ins via RPC: ${error instanceof Error ? error.message : String(error)}`,
                    );
                }
            }

            const cliNames = new Set(cliBuiltins.map((tool) => tool.name));
            const deprecatedCustomTools = projection.tools.filter((tool) =>
                DEPRECATED_CUSTOM_TOOL_NAMES.has(tool.name),
            );
            const collisions = projection.tools
                .filter((tool) => cliNames.has(tool.name))
                .map((tool) => ({
                    name: tool.name,
                    resolution: 'cli_precedence',
                }));

            res.json({
                ...projection,
                catalog: {
                    policy: {
                        cliBuiltinsPrecedeCustomTools: true,
                        deprecatedCustomOverrides: [...DEPRECATED_CUSTOM_TOOL_NAMES],
                    },
                    cli: {
                        source: cliToolsSource,
                        count: cliBuiltins.length,
                        tools: cliBuiltins,
                    },
                    custom: {
                        source: projection.source,
                        count: projection.tools.length,
                        tools: projection.tools,
                    },
                    deprecatedCustomTools,
                    collisions,
                },
            });
        });
    });

    return router;
}
