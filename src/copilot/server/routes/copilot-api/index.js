// @ts-check
/**
 * src/copilot/server/routes/copilot-api/index.js
 *
 * Router canônico do AlwaysAliveAgent — agrega os sub-módulos de rota no servidor.
 *
 * Onda 4.2 — L64.3: criação do router consolidado. Onda 4.8 — migração completa: sub-módulos agora em
 * `server/routes/copilot-api/` (anteriormente em `api/bridge/`).
 *
 * Rotas expostas (montadas sem prefixo — o caller pode usar app.use('/agent', ...)): GET /status — snapshot de status
 * do agente GET /health — health check para orquestradores GET /session — info da sessão ativa POST /start — inicia o
 * agente (requer admin token) POST /stop — para o agente graciosamente (requer admin token) GET /permissions — lista
 * permissões do agente POST /permissions — atualiza permissões (requer admin token) POST /steer — steering imediato
 * (GAP-SE-001b) POST /send — enfileira mensagem ao agente (async) POST /answer — responde pergunta pendente do modelo
 * GET /stream — SSE global do AlwaysAliveAgent GET /stream/tasks — SSE filtrado somente tarefas POST /dialog/start —
 * inicia Dialog Loop (§15.8) POST /dialog/turn — envia turno de diálogo POST /dialog/stop — encerra Dialog Loop
 *
 * @module copilot/server/routes/copilot-api
 */

import { ALWAYS_ALIVE_AGENT } from '#copilot/agent';
import { container } from '#copilot/core';
import { Router } from 'express';
import { registerControlRoutes } from './control.js';
import { registerDialogRoutes } from './dialog.js';
import { registerStreamRoutes } from './stream.js';
import { registerTaskRoutes } from './tasks.js';

/**
 * Cria o router do AlwaysAliveAgent usando os sub-módulos canônicos de `server/routes/copilot-api/`.
 *
 * @returns {import('express').Router}
 */
export function createCopilotApiRouter() {
    const router = Router();

    const agent = container.resolve(ALWAYS_ALIVE_AGENT);

    registerControlRoutes(router, agent);
    registerTaskRoutes(router, agent);
    registerStreamRoutes(router, agent);
    registerDialogRoutes(router, agent);

    return router;
}
