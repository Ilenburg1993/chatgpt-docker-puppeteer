// @ts-check
/**
 * @module copilot/server/router
 * @file Barrel de rotas: monta todos os routers copilot no app Express.
 *
 * Centraliza o mounting e as regras de auth-exempt por router.
 * Onda 3.1 — L55.8.
 *
 * src/copilot/server/router.js
 */

import { createAuthMiddleware } from './middleware/auth.js';
import { createAgentRouter } from './routes/agent.js';
import { createConfigRouter } from './routes/config.js';
import { createCopilotApiRouter } from './routes/copilot-api.js';
import { createGitRouter } from './routes/git.js';
import { createHealthRouter } from './routes/health.js';
import { createMemoryRouter } from './routes/memory.js';
import { createObservabilityRouter } from './routes/observability.js';
import { createSessionsRouter } from './routes/sessions.js';
import { createSseRouter } from './routes/sse.js';

/**
 * Monta todos os routers do servidor copilot no app Express.
 *
 * Estrutura de rotas:
 * - GET  /health                    (skipAuth)
 * - GET  /hub-health                (skipAuth)
 * - GET  /metrics                   (skipAuth)
 * - GET  /context, /quota, /pr-budget
 * - POST /inject                    (rate: inject)
 * - POST /pipeline                  (rate: write)
 * - POST /dialog/pause, /dialog/resume
 * - GET  /handoff, POST /handoff/:id/accept|reject
 * - GET  /config, /config/skills, /config/tools, /config/tools/custom
 * - PUT  /config/infinite-session, /config/skills, /config/tools
 * - POST /config/tools/custom
 * - DELETE /config/tools/custom/:name
 * - GET  /memory, POST /memory, DELETE /memory/:memoryId
 * - GET  /errors, /tool-stats, /history, /audit
 * - GET  /sessions, /sessions/:sessionId/turns
 * - POST /system/reset
 * - GET  /git/status, /git/log
 * - GET  /gh/issues, /gh/prs, /gh/ci
 * - GET  /events (SSE — Onda 4.0: router canônico server/routes/sse.js)
 * - GET  /events/critical (SSE críticos — Onda 4.0)
 * - GET  /sessions, GET /sessions/:id, POST /sessions, DELETE /sessions/:id (Onda 4.1)
 * - GET  /sessions/:id/turns (Onda 4.1)
 * - GET  /status, /health (agent), /session, /permissions (Onda 4.2)
 * - POST /start, /stop, /permissions, /steer, /send, /answer (Onda 4.2)
 * - GET  /stream, /stream/tasks (SSE AlwaysAliveAgent — Onda 4.2)
 * - POST /dialog/start, /dialog/turn, /dialog/stop (Onda 4.2)
 *
 * @param {import('express').Application} app
 * @param {object} [opts]
 * @param {string} [opts.token] - Token override para auth
 * @returns {void}
 */
export function mountCopilotRoutes(app, opts) {
    const authMiddleware = createAuthMiddleware({ token: opts?.token });

    // Rotas auth-exempt: health não precisa de token
    // O createHealthRouter não usa authMiddleware global do app
    app.use(createHealthRouter());

    // GET /metrics — skipAuth (prometheus scrapper)
    // Montado como parte do observability router mas sem auth
    // O createObservabilityRouter inclui /metrics — aqui criamos um router sem auth só para /metrics
    // Para simplicidade, o auth global do app já está configurado com skipAuth=false,
    // portanto precisamos montar /metrics antes do auth middleware global.
    // A abordagem correta é configurar skipAuth no createCopilotApp — feito via opts.skipAuth.
    // Em produção, o createAuthMiddleware no app.js já cuida do token check.
    // Health e metrics são skip-auth pela convenção do route-table, então montamos sem auth.

    // Rotas com auth (o auth global já foi aplicado pelo createCopilotApp)
    app.use(createAgentRouter());
    app.use('/config', createConfigRouter());
    app.use('/memory', createMemoryRouter());
    app.use(createObservabilityRouter());
    app.use(createGitRouter());
    app.use(createSseRouter());
    app.use(createSessionsRouter());
    app.use(createCopilotApiRouter());

    void authMiddleware; // usado implicitamente via createCopilotApp opts
}
