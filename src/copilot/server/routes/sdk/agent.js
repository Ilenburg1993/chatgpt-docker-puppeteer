// @ts-check
/**
 * src/copilot/routes/agent.js
 *
 * Rotas de inspeção e controle do agente Always-Alive.
 *
 * Montadas em /api/sdk/* via sdk-api.js.
 *
 * Endpoints:
 *
 * - GET /agent/info — Info do agente (status, uptime, PID, sessionId)
 * - GET /agent/tools — ToolsRegistry rico com metadados
 * - GET /agent/telemetry — Resumo de telemetria (sessões, erros)
 * - POST /agent/telemetry/clear — Reseta store de telemetria
 * - GET /agent/state — Estado de conexão do CopilotClient
 * - GET /agent/stream — SSE de eventos de ciclo de vida do cliente
 *
 * @module copilot/routes/agent
 * @see EventBus
 */

import { log } from '#copilot/observability';
import { Router } from 'express';
import { SseReplayBuffer } from '../../../infra/sse/replay-buffer.js';
import {
    createEventFilter,
    createSseWriter,
    SseConnectionTracker,
    standardizeSsePayload,
} from '../../../infra/sse/utils.js';
import {
    paginateAgentRuntimeToolsProjection,
    readAgentRuntimeToolsProjection,
} from '../../../presentation/runtime-tools.js';
import { resolveSdkRuntimeProjection } from '../../../presentation/sdk-sessions.js';
import { withErrorHandler as _withErrorHandler } from './middleware.js';

/** GAP-EVARCH-01 (fix): tracker centralizado para /agent/stream. */
const _agentTracker = new SseConnectionTracker('agent/stream');

/** FASE-11.2: replay buffer global para agent/stream. */
const _agentReplayBuffer = new SseReplayBuffer();

/**
 * @typedef {import('express').Request} Req
 *
 * @typedef {import('express').Response} Res
 */

/**
 * Dependências injetáveis do router de agente.
 *
 * @typedef {object} AgentRouterDeps
 * @property {import('#copilot/agent').AlwaysAliveAgent} agent - Instância do agente AlwaysAlive.
 * @property {import('#copilot/observability/metrics.js').MetricsStore} metrics - Store de métricas.
 * @property {() => Promise<import('@github/copilot-sdk').CopilotClient>} getClient - Factory do SDK client.
 * @property {string} [runtimeId] - Runtime alvo resolvido na borda.
 */

/** @typedef {AgentRouterDeps | ((req: Req) => AgentRouterDeps)} AgentRouterBinding */

/**
 * @param {AgentRouterBinding} binding
 * @param {Req} req
 * @returns {AgentRouterDeps}
 */
function resolveAgentRouterDeps(binding, req) {
    return typeof binding === 'function' ? binding(req) : binding;
}

/**
 * Factory que cria o router de rotas `/agent/*` com dependências injetadas.
 *
 * @param {AgentRouterBinding} deps
 * @returns {import('express').Router}
 */
export default function createAgentRouter(deps) {
    const router = Router();

    /**
     * Wrapper com prefixo de log para as rotas de agente.
     *
     * @param {Req} req
     * @param {Res} res
     * @param {() => Promise<unknown>} fn
     * @returns {Promise<void>}
     */
    const withErrorHandler = _withErrorHandler.bind(null, 'sdk-api/agent');

    // ─────────────────────────────────────────────────────────────────────────────
    // GET /agent/info
    // ─────────────────────────────────────────────────────────────────────────────

    /**
     * Retorna informações do agente Always-Alive: status, uptime, sessão ativa.
     */
    router.get('/agent/info', (_req, res) => {
        void (async () => {
            const { agent, getClient, runtimeId } = resolveAgentRouterDeps(deps, /** @type {Req} */ (_req));
            const client = agent.status !== 'stopped' ? await getClient() : null;
            const runtimeProjection = await resolveSdkRuntimeProjection(agent, client, client?.getState?.() ?? null);
            res.json({
                ok: true,
                ...(runtimeId ? { runtimeId } : {}),
                running: agent.status !== 'stopped',
                sessionId: agent.sessionId ?? null,
                uptime: Math.floor(process.uptime()),
                pid: process.pid,
                nodeVersion: process.version,
                env: process.env['NODE_ENV'] ?? 'development',
                ...runtimeProjection,
            });
        })().catch((error) => {
            res.status(500).json({ ok: false, error: /** @type {Error} */ (error).message });
        });
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // GET /agent/tools
    // ─────────────────────────────────────────────────────────────────────────────

    /**
     * Lista as ferramentas registradas no ToolsRegistry do agente, com metadados ricos. G2-API-11: suporta
     * ?category=hook&page=1&limit=20 para filtragem e paginação.
     */
    router.get('/agent/tools', (req, res) => {
        const { agent } = resolveAgentRouterDeps(deps, req);
        const projection = readAgentRuntimeToolsProjection(agent, { requireRegistry: true });
        if (!projection.ok) {
            res.status(503).json({ ok: false, error: projection.error });
            return;
        }

        res.json(
            paginateAgentRuntimeToolsProjection(projection, {
                category: req.query['category'],
                page: req.query['page'],
                limit: req.query['limit'],
            }),
        );
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // GET /agent/telemetry  +  GET /telemetry (alias retrocompatível)  +  POST /agent/telemetry/clear
    // ─────────────────────────────────────────────────────────────────────────────

    /**
     * Retorna o resumo de telemetria do agente (sessões, erros, latências). Alias /telemetry mantido para
     * compatibilidade retroativa (UPG-N08/GAP-N14).
     *
     * @param {import('express').Request} _req
     * @param {import('express').Response} res
     */
    function handleGetTelemetry(_req, res) {
        const { metrics, runtimeId } = resolveAgentRouterDeps(deps, /** @type {Req} */ (_req));
        res.json({ ok: true, ...(runtimeId ? { runtimeId } : {}), summary: metrics.getSummary() });
    }

    router.get('/agent/telemetry', handleGetTelemetry);
    router.get('/telemetry', handleGetTelemetry);

    /**
     * Reseta o store de telemetria do agente. Útil após deploy ou manutenção.
     */
    router.post('/agent/telemetry/clear', (_req, res) => {
        const { metrics } = resolveAgentRouterDeps(deps, /** @type {Req} */ (_req));
        metrics.reset();
        log('INFO', '[sdk-api] telemetria resetada via POST /agent/telemetry/clear');
        res.json({ ok: true, message: 'Telemetria resetada com sucesso' });
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // GET /agent/state
    // ─────────────────────────────────────────────────────────────────────────────

    /**
     * Retorna o estado de conexão atual do CopilotClient (ConnectionState).
     *
     * @example
     *     GET /api/sdk/agent/state
     *     → { ok: true, state: "connected" }
     */
    router.get('/agent/state', (req, res) => {
        void withErrorHandler(req, res, async () => {
            const { agent, getClient, runtimeId } = resolveAgentRouterDeps(deps, req);
            const client = await getClient();
            const state = client.getState();
            const runtimeProjection = await resolveSdkRuntimeProjection(agent, client, state);
            res.json({ ok: true, state, ...(runtimeId ? { runtimeId } : {}), ...runtimeProjection });
        });
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // GET /agent/stream  (SSE)
    // ─────────────────────────────────────────────────────────────────────────────

    /**
     * Abre um stream SSE de eventos de ciclo de vida do CopilotClient (conexão, desconexão, erros).
     *
     * Eventos entregues:
     *
     * - `lifecycle` — { type, data } de eventos do client.on()
     * - `heartbeat` — keepalive a cada 30s
     * - `connected` — enviado imediatamente ao conectar (com estado atual)
     *
     * @example
     *     const es = new EventSource('/api/sdk/agent/stream');
     *     es.addEventListener('lifecycle', (e) => console.log(JSON.parse(e.data)));
     */
    router.get('/agent/stream', (req, res) => {
        void withErrorHandler(req, res, async () => {
            const { getClient, runtimeId } = resolveAgentRouterDeps(deps, req);
            if (!_agentTracker.accept()) {
                res.status(429).json({ ok: false, error: 'Limite de clientes SSE atingido' });
                return;
            }
            const client = await getClient();

            // GAP-EVARCH-01 (fix): usar createSseWriter para setup padronizado
            // FASE-11.2/11.3/11.4: replay buffer + event filter + max lifetime
            const sse = createSseWriter(req, res, {
                heartbeatMs: 30_000,
                tracker: _agentTracker,
                replayBuffer: _agentReplayBuffer,
                maxLifetimeMs: 24 * 60 * 60 * 1000,
            });

            sse.send('connected', {
                ...(runtimeId ? { runtimeId } : {}),
                state: client.getState(),
                timestamp: Date.now(),
            });

            // FASE-11.3: filtro de eventos via ?events= query param
            const eventFilter = createEventFilter(
                typeof req.query['events'] === 'string' ? req.query['events'] : undefined,
            );

            // Inscreve nos eventos de ciclo de vida do client
            const unsubscribe = client.on((event) => {
                const type = /** @type {string} */ (event?.type ?? 'lifecycle');
                if (!eventFilter || eventFilter(type)) sse.send('lifecycle', standardizeSsePayload(event));
            });

            req.on('close', () => {
                unsubscribe();
                log('INFO', '[sdk-api] SSE agent/stream encerrado');
            });
        });
    });

    return router;
}
