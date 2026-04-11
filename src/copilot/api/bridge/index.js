// @ts-check
/**
 * src/copilot/api/http-bridge.js
 *
 * HTTP Bridge — agrega sub-módulos de rota e expõe o Always-Alive Agent via API REST.
 *
 * Rotas montadas em /api/copilot/* pelo router principal:
 *
 * GET /api/copilot/status — Status do agente + pergunta pendente GET /api/copilot/health — Health check para
 * orquestradores e load balancers GET /api/copilot/session — Info sobre a sessão ativa POST /api/copilot/start — Inicia
 * o agente (se parado) POST /api/copilot/stop — Para o agente graciosamente POST /api/copilot/send — Envia mensagem ao
 * agente (async) POST /api/copilot/answer — Responde pergunta pendente do modelo GET /api/copilot/stream — SSE global
 * de eventos em tempo real POST /api/copilot/dialog/start — Inicia Dialog Loop (padrão §15.8 — 0 PR por turno) POST
 * /api/copilot/dialog/turn — Envia turno de diálogo POST /api/copilot/dialog/stop — Encerra Dialog Loop
 *
 * Implementação distribuída em sub-módulos (Fase R):
 *
 * - bridge-control.js → GET /status, /health, /session · POST /start, /stop
 * - bridge-tasks.js → POST /send, /answer
 * - bridge-stream.js → GET /stream (SSE)
 * - bridge-dialog.js → POST /dialog/start, /dialog/turn, /dialog/stop
 *
 * @module copilot/api/http-bridge
 * @see EventBus
 */

import { alwaysAliveAgent } from '#copilot/services';
import { Router } from 'express';
import { registerControlRoutes } from './control.js';
import { registerDialogRoutes } from './dialog.js';
import { registerStreamRoutes } from './stream.js';
import { registerTaskRoutes } from './tasks.js';

const bridge = Router();

registerControlRoutes(bridge, alwaysAliveAgent);
registerTaskRoutes(bridge, alwaysAliveAgent);
registerStreamRoutes(bridge, alwaysAliveAgent);
registerDialogRoutes(bridge, alwaysAliveAgent);

export default bridge;
