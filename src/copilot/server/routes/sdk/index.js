// @ts-check
/**
 * src/copilot/server/routes/sdk/index.js
 *
 * Router canônico da SDK API — monta sub-routers modulares do GitHub Copilot SDK sob /sdk.
 *
 * Rotas expostas (com prefixo /sdk):
 * - GET /sdk/ping, /sdk/status, /sdk/auth, /sdk/models, /sdk/tools, /sdk/client/*
 * - GET /sdk/sessions, /sdk/sessions/active, /sdk/sessions/last, /sdk/sessions/:id e sub-rotas
 * - GET /sdk/agent/info, /sdk/agent/tools, /sdk/agent/telemetry, /sdk/agent/state, /sdk/agent/stream
 * - GET /sdk/hooks (introspecção de hooks)
 * - GET /sdk/metrics, /sdk/errors, /sdk/health, /sdk/log-level
 *
 * Ativado apenas quando COPILOT_SDK_ENABLED=true (verificado em createCopilotApp).
 *
 * @module copilot/server/routes/sdk
 */

import { ALWAYS_ALIVE_AGENT } from '#copilot/agent';
import { container } from '#copilot/core';
import { METRICS_STORE } from '#copilot/observability';
import { createSessionService } from '../../../services/session-service.js';
import { createToolService } from '../../../services/tool-service.js';
import { Router } from 'express';
import createAgentRouter from './agent.js';
import createClientRouter from './client.js';
import hooksRouter from './hooks.js';
import createObservabilityRouter from './observability.js';
import sessionsRouter from './sessions.js';

/**
 * Cria o router principal da SDK API com injeção de dependências.
 *
 * Os sub-routers recebem dependências explícitas em vez de importar singletons,
 * facilitando testes e desacoplamento.
 *
 * @returns {import('express').Router}
 */
function createSdkApiRouter() {
    const router = Router();

    const _sessionService = createSessionService();
    const _toolService = createToolService();

    const sharedDeps = {
        agent: container.resolve(ALWAYS_ALIVE_AGENT),
        metrics: container.resolve(METRICS_STORE),
        getClient: () => _sessionService.getClient(),
        getClientState: () => _sessionService.getClientState(),
        stopClient: () => _sessionService.stopClient(),
        allTools: _toolService.listAll(),
    };

    router.use('/', createClientRouter(sharedDeps));
    router.use('/', sessionsRouter);
    router.use('/', createAgentRouter(sharedDeps));
    router.use('/', hooksRouter);
    router.use('/', createObservabilityRouter(sharedDeps));

    return router;
}

/**
 * Cria o router do SDK API com prefixo /sdk.
 *
 * @returns {import('express').Router}
 */
export function createSdkRouter() {
    const outer = Router();
    outer.use('/sdk', createSdkApiRouter());
    return outer;
}
