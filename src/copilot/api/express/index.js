// @ts-check
/**
 * src/copilot/api/sdk-api.js
 *
 * SDK API — orquestrador Express que monta os sub-routers modulares do GitHub Copilot SDK.
 *
 * Montada em /api/sdk/* pelo router principal (quando COPILOT_SDK_ENABLED=true).
 *
 * Rotas organizadas em sub-módulos:
 *
 * - `routes/client.js` — /ping, /status, /auth, /models, /tools, /client/*
 * - `routes/sessions.js` — /sessions, /sessions/active, /sessions/last, /sessions/foreground, /sessions/:id, e sub-rotas
 * - `routes/agent.js` — /agent/info, /agent/tools, /agent/telemetry, /agent/state, /agent/stream
 * - `routes/webhooks.js` — /webhooks, /webhooks/:id
 *
 * @deprecated Onda 4.9 — O ponto canônico de montagem é `server/routes/sdk/index.js` (Onda 4.3).
 *   A lógica interna (sub-módulos) será migrada para `server/routes/sdk/` na Onda 5.
 *   Este barrel é invocado indiretamente via re-export do `server/routes/sdk/index.js`.
 * @module copilot/api/sdk-api
 * @see EventBus
 */

import { defaultMetrics } from '#copilot/observability';
import { alwaysAliveAgent, createSessionService, createToolService } from '#copilot/services';
import { Router } from 'express';
import createAgentRouter from './agent.js';
import createClientRouter from './client.js';
import hooksRouter from './hooks.js';
import createObservabilityRouter from './observability.js';
import sessionsRouter from './sessions.js';
import createWebhooksRouter from './webhooks.js';

/**
 * Cria o router principal da SDK API com injeção de dependências.
 *
 * Os sub-routers recebem dependências explícitas em vez de importar singletons, facilitando testes e desacoplamento.
 *
 * @returns {import('express').Router}
 */
export default function createSdkApiRouter() {
    const router = Router();

    const _sessionService = createSessionService();
    const _toolService = createToolService();

    // Dependências compartilhadas — resolvidas uma vez na raiz
    const sharedDeps = {
        agent: alwaysAliveAgent,
        metrics: defaultMetrics,
        getClient: () => _sessionService.getClient(),
        getClientState: () => _sessionService.getClientState(),
        stopClient: () => _sessionService.stopClient(),
        allTools: _toolService.listAll(),
    };

    // Sub-routers modulares — cada arquivo é responsável por um domínio
    router.use('/', createClientRouter(sharedDeps));
    router.use('/', sessionsRouter);
    router.use('/', createAgentRouter(sharedDeps));
    router.use('/', createWebhooksRouter(sharedDeps));
    // P.2: rotas de introspecção de hooks (registry + SSE events)
    router.use('/', hooksRouter);
    // Rotas de observabilidade (metrics, errors, logs, health, log-level)
    router.use('/', createObservabilityRouter(sharedDeps));

    return router;
}
