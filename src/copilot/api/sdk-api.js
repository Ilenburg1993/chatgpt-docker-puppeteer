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
 * @module copilot/api/sdk-api
 */

import { Router } from 'express';
import agentRouter from '../routes/agent.js';
import clientRouter from '../routes/client.js';
import sessionsRouter from '../routes/sessions.js';
import webhooksRouter from '../routes/webhooks.js';

const router = Router();

// Sub-routers modulares — cada arquivo é responsável por um domínio
router.use('/', clientRouter);
router.use('/', sessionsRouter);
router.use('/', agentRouter);
router.use('/', webhooksRouter);

export default router;
