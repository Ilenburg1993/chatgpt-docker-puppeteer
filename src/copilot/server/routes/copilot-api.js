// @ts-check
/**
 * src/copilot/server/routes/copilot-api.js
 *
 * Router canônico do AlwaysAliveAgent — agrega os sub-módulos de rota do bridge no servidor.
 *
 * Onda 4.2 — L64.3: consolida as rotas do api/bridge/ no servidor copilot canônico,
 * reutilizando os sub-módulos register* sem duplicação de lógica.
 *
 * Rotas expostas (montadas sem prefixo — o caller pode usar app.use('/agent', ...)):
 *   GET  /status         — snapshot de status do agente
 *   GET  /health         — health check para orquestradores
 *   GET  /session        — info da sessão ativa
 *   POST /start          — inicia o agente (requer admin token)
 *   POST /stop           — para o agente graciosamente (requer admin token)
 *   GET  /permissions    — lista permissões do agente
 *   POST /permissions    — atualiza permissões (requer admin token)
 *   POST /steer          — steering imediato (GAP-SE-001b)
 *   POST /send           — enfileira mensagem ao agente (async)
 *   POST /answer         — responde pergunta pendente do modelo
 *   GET  /stream         — SSE global do AlwaysAliveAgent
 *   GET  /stream/tasks   — SSE filtrado somente tarefas
 *   POST /dialog/start   — inicia Dialog Loop (§15.8)
 *   POST /dialog/turn    — envia turno de diálogo
 *   POST /dialog/stop    — encerra Dialog Loop
 *
 * @module copilot/server/routes/copilot-api
 */

import { alwaysAliveAgent } from '#copilot/services';
import { Router } from 'express';
import { registerControlRoutes } from '../../api/bridge/control.js';
import { registerDialogRoutes } from '../../api/bridge/dialog.js';
import { registerStreamRoutes } from '../../api/bridge/stream.js';
import { registerTaskRoutes } from '../../api/bridge/tasks.js';

/**
 * Cria o router do AlwaysAliveAgent reutilizando os sub-módulos bridge canônicos.
 *
 * Os sub-módulos são singletons de rota — cada chamada a `register*Routes` adiciona
 * handlers ao router passado. O `alwaysAliveAgent` é importado de `#copilot/services`
 * e é o mesmo singleton usado pelo api/bridge/index.js.
 *
 * @returns {import('express').Router}
 */
export function createCopilotApiRouter() {
    const router = Router();

    registerControlRoutes(router, alwaysAliveAgent);
    registerTaskRoutes(router, alwaysAliveAgent);
    registerStreamRoutes(router, alwaysAliveAgent);
    registerDialogRoutes(router, alwaysAliveAgent);

    return router;
}
