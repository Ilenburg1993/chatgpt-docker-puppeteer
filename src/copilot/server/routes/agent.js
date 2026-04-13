// @ts-check
/**
 * @module copilot/server/routes/agent
 * @file Router Express para rotas de agente e injeção.
 *
 * Rotas: POST /inject, POST /pipeline, GET /context, GET /quota,
 *   GET /pr-budget, POST /dialog/pause, POST /dialog/resume,
 *   GET /handoff, POST /handoff/:id/accept, POST /handoff/:id/reject
 *
 * Onda 3.1 — L55.2.
 *
 * src/copilot/server/routes/agent.js
 */

import { Router } from 'express';
import {
    handleAcceptHandoff,
    handleDialogPause,
    handleDialogResume,
    handleGetContext,
    handleGetHandoffs,
    handleInject,
    handlePipeline,
    handleRejectHandoff,
} from '../../terminal/handlers/agent.js';
import { handleGetPrBudget, handleGetQuota } from '../../terminal/handlers/system-metrics.js';
import { bridgeHandler } from '../handler-bridge.js';
import { injectRateMiddleware, writeRateMiddleware } from '../middleware/rate-limiter.js';

/**
 * Cria o router de agente do servidor copilot.
 *
 * @returns {import('express').Router}
 */
export function createAgentRouter() {
    const router = Router();

    // GET — sem body
    router.get('/context', bridgeHandler(handleGetContext));
    router.get('/quota', bridgeHandler(handleGetQuota));
    router.get('/pr-budget', bridgeHandler(handleGetPrBudget));
    router.get('/handoff', bridgeHandler(handleGetHandoffs));

    // POST /inject — rate limit inject
    router.post('/inject', injectRateMiddleware, bridgeHandler(handleInject));

    // POST /pipeline — rate limit write
    router.post('/pipeline', writeRateMiddleware, bridgeHandler(handlePipeline));

    // POST /dialog
    router.post('/dialog/pause', bridgeHandler(handleDialogPause));
    router.post('/dialog/resume', bridgeHandler(handleDialogResume));

    // Handoff com parâmetro de rota
    router.post(
        '/handoff/:handoffId/accept',
        bridgeHandler(handleAcceptHandoff, (req) => ({ handoffId: req.params['handoffId'] ?? '' })),
    );
    router.post(
        '/handoff/:handoffId/reject',
        bridgeHandler(handleRejectHandoff, (req) => ({
            handoffId: req.params['handoffId'] ?? '',
            body: req.body,
        })),
    );

    return router;
}
