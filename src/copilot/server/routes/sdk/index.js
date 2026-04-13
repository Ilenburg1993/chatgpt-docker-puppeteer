// @ts-check
/**
 * src/copilot/server/routes/sdk/index.js
 *
 * Router canônico da SDK API — wrapper do api/express/index.js no servidor copilot.
 *
 * Onda 4.3 — L64.4: expõe o SDK API router (api/express) sob o servidor canônico,
 * adicionando o prefixo /sdk para isolamento de namespace.
 *
 * Rotas expostas (com prefixo /sdk):
 *   GET  /sdk/ping, /sdk/status, /sdk/auth, /sdk/models, /sdk/tools, /sdk/client/*
 *   GET  /sdk/sessions, /sdk/sessions/active, /sdk/sessions/last, /sdk/sessions/:id e sub-rotas
 *   GET  /sdk/agent/info, /sdk/agent/tools, /sdk/agent/telemetry, /sdk/agent/state, /sdk/agent/stream
 *   GET  /sdk/webhooks, /sdk/webhooks/:id
 *   GET  /sdk/hooks (introspecção de hooks)
 *   GET  /sdk/metrics, /sdk/errors, /sdk/health, /sdk/log-level
 *
 * Ativado apenas quando COPILOT_SDK_ENABLED=true (verificado em createCopilotApp).
 *
 * @module copilot/server/routes/sdk
 */

import { Router } from 'express';
import createSdkApiRouter from '../../../api/express/index.js';

/**
 * Cria o router do SDK API com prefixo /sdk.
 *
 * Delega toda a lógica ao `createSdkApiRouter()` de api/express/index.js.
 * O prefixo /sdk é aplicado aqui para isolar o namespace das rotas SDK
 * das rotas operacionais do servidor copilot.
 *
 * @returns {import('express').Router}
 */
export function createSdkRouter() {
    const outer = Router();
    outer.use('/sdk', createSdkApiRouter());
    return outer;
}
