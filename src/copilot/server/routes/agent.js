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
import { z } from 'zod';
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
import { validate } from '../middleware/validate.js';

// ── Zod schemas (S-C-03 fix) ──────────────────────────────────────────────
const injectBodySchema = z.object({
    content: z.string().min(1).max(64_000),
    metadata: z.record(z.unknown()).optional(),
});

const pipelineBodySchema = z.object({
    steps: z.array(z.object({ type: z.string(), config: z.record(z.unknown()).optional() })).min(1),
});

const handoffParamsSchema = z.object({
    handoffId: z.string().min(1),
});

const rejectBodySchema = z.object({
    reason: z.string().optional(),
});

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
    router.post('/inject', injectRateMiddleware, validate({ body: injectBodySchema }), bridgeHandler(handleInject));

    // POST /pipeline — rate limit write
    router.post('/pipeline', writeRateMiddleware, validate({ body: pipelineBodySchema }), bridgeHandler(handlePipeline));

    // POST /dialog
    router.post('/dialog/pause', bridgeHandler(handleDialogPause));
    router.post('/dialog/resume', bridgeHandler(handleDialogResume));

    // Handoff com parâmetro de rota
    router.post(
        '/handoff/:handoffId/accept',
        validate({ params: handoffParamsSchema }),
        bridgeHandler(handleAcceptHandoff, (req) => ({ handoffId: req.params['handoffId'] ?? '' })),
    );
    router.post(
        '/handoff/:handoffId/reject',
        validate({ params: handoffParamsSchema, body: rejectBodySchema }),
        bridgeHandler(handleRejectHandoff, (req) => ({
            handoffId: req.params['handoffId'] ?? '',
            body: req.body,
        })),
    );

    return router;
}
