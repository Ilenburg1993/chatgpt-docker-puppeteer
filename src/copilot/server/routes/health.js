// @ts-check
/**
 * @module copilot/server/routes/health
 * @file Router Express para rotas de health check do servidor copilot.
 *
 * Rotas auth-exempt (skipAuth): GET /health, GET /hub-health
 * Onda 3.1 — L55.1.
 *
 * src/copilot/server/routes/health.js
 */

import { Router } from 'express';
import { handleHubHealth } from '../../terminal/handlers/dialog.js';
import { handleHealth } from '../../terminal/handlers/system-config.js';
import { callHandler } from '../handler-bridge.js';

/**
 * Cria o router de health do servidor copilot.
 * Rotas: GET /health, GET /hub-health
 *
 * @returns {import('express').Router}
 */
export function createHealthRouter() {
    const router = Router();

    // Auth-exempt: skipAuth no route-table original
    router.get('/health', (req, res, next) => callHandler(handleHealth, req, res, next));
    router.get('/hub-health', (req, res, next) => callHandler(handleHubHealth, req, res, next));

    return router;
}
