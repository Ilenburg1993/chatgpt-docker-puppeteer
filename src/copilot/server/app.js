// @ts-check
/**
 * @module copilot/server/app
 * @file Factory Express para o servidor copilot dedicado.
 *
 * Cria e configura o app Express com todos os middlewares globais.
 * As rotas são montadas separadamente por `mountCopilotRoutes()` (Onda 3.1).
 * Onda 3.0 — L54.6.
 *
 * src/copilot/server/app.js
 */

import express from 'express';
import { createAuthMiddleware } from './middleware/auth.js';
import { createCorsMiddleware } from './middleware/cors.js';
import { copilotErrorHandler } from './middleware/error-handler.js';
import { requestIdMiddleware } from './middleware/request-id.js';

/**
 * Opções para criação do app Express copilot.
 *
 * @typedef {object} CopilotAppOptions
 * @property {string} [token] - Token bearer override (para testes)
 * @property {boolean} [skipAuth] - Desabilitar auth globalmente (dev/test)
 * @property {string | string[]} [corsOrigin] - Origem(ns) CORS. Default: '*' (loopback seguro)
 */

/**
 * Cria e configura o app Express do servidor copilot.
 *
 * Ordem de middlewares:
 * 1. requestId — gera/propaga X-Request-ID
 * 2. cors — headers CORS + preflight OPTIONS
 * 3. express.json — parse body JSON (2MB max, alinhado com terminal/server.js)
 * 4. auth — verifica Bearer token (pula rotas skipAuth)
 *
 * O error handler é registrado por último (após rotas) em `app.js`.
 * Chame `mountCopilotRoutes(app)` separadamente para adicionar as rotas.
 *
 * @param {CopilotAppOptions} [opts]
 * @returns {import('express').Application}
 */
export function createCopilotApp(opts) {
    const app = express();

    // 1. Rastreabilidade: X-Request-ID
    app.use(requestIdMiddleware);

    // 2. CORS: wildcard seguro (bind 127.0.0.1 only)
    app.use(createCorsMiddleware({ origin: opts?.corsOrigin ?? '*' }));

    // 3. Body parsing: JSON, limite 2MB (alinhado com terminal/server.js readBody MAX_BODY_BYTES)
    app.use(express.json({ limit: '2mb' }));
    app.use(express.urlencoded({ extended: false, limit: '2mb' }));

    // 4. Auth: Bearer token timing-safe (aplicado globalmente; rotas skipAuth usam middleware local)
    if (!opts?.skipAuth) {
        app.use(createAuthMiddleware({ token: opts?.token }));
    }

    // Error handler — DEVE ser registrado após todas as rotas (montado no final pelo createCopilotServer)
    // Chamada: app.use(copilotErrorHandler) após mountCopilotRoutes(app)
    app.set('_copilotErrorHandler', copilotErrorHandler);

    return app;
}

/**
 * Registra o error handler global no app (deve ser chamado após mountCopilotRoutes).
 *
 * @param {import('express').Application} app
 * @returns {void}
 */
export function registerErrorHandler(app) {
    app.use(copilotErrorHandler);
}
