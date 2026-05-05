// @ts-check
/**
 * @module copilot/server/routes/agent
 * @file Router Express para rotas de agente e injeção.
 *
 *   Rotas: POST /inject, POST /pipeline, GET /context, GET /quota, GET /pr-budget, POST /dialog/pause, POST
 *   /dialog/resume, GET /handoff, POST /handoff/:id/accept, POST /handoff/:id/reject
 *
 *   Onda 3.1 — L55.2.
 *
 *   src/copilot/server/routes/agent.js
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
} from '../../presentation/agent-control.js';
import { handleGetPrBudget, handleGetQuota } from '../../presentation/system-metrics.js';
import { injectRateMiddleware, writeRateMiddleware } from '../middleware/rate-limiter.js';
import { validate } from '../middleware/validate.js';
import { createPresentationRoute } from './presentation-route.js';

// ── Zod schemas (S-C-03 fix) ──────────────────────────────────────────────
const injectBodyBaseSchema = z
    .object({
        message: z.string().trim().min(1).max(64_000).optional(),
        content: z.string().trim().min(1).max(64_000).optional(),
        from: z.string().optional(),
        timeout: z.number().int().min(0).max(300_000).nullable().optional(),
        context_files: z.array(z.string().min(1)).max(32).optional(),
        attachments: z.array(z.object({}).passthrough()).max(32).optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
    })
    .passthrough();

const injectBodySchema = injectBodyBaseSchema.refine(
    (/** @type {{ message?: unknown; content?: unknown }} */ body) =>
        typeof body.message === 'string' || typeof body.content === 'string',
    {
        message: 'Campo "message" ou "content" é obrigatório.',
        path: ['message'],
    },
);

const pipelineBodySchema = z
    .object({
        from: z.string().optional(),
        steps: z
            .array(
                z
                    .object({
                        prompt: z.string().trim().min(1).max(64_000),
                        from: z.string().optional(),
                        waitMs: z.number().int().min(0).max(30_000).optional(),
                    })
                    .passthrough(),
            )
            .min(1)
            .max(20),
    })
    .passthrough();

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
    router.get('/context', createPresentationRoute(handleGetContext));
    router.get('/quota', createPresentationRoute(handleGetQuota));
    router.get('/pr-budget', createPresentationRoute(handleGetPrBudget));
    router.get('/handoff', createPresentationRoute(handleGetHandoffs));

    // POST /inject — rate limit inject
    router.post(
        '/inject',
        injectRateMiddleware,
        validate({ body: injectBodySchema }),
        createPresentationRoute(handleInject),
    );

    // POST /pipeline — rate limit write
    router.post(
        '/pipeline',
        writeRateMiddleware,
        validate({ body: pipelineBodySchema }),
        createPresentationRoute(handlePipeline),
    );

    // POST /dialog
    router.post('/dialog/pause', createPresentationRoute(handleDialogPause));
    router.post('/dialog/resume', createPresentationRoute(handleDialogResume));

    // Handoff com parâmetro de rota
    router.post(
        '/handoff/:handoffId/accept',
        validate({ params: handoffParamsSchema }),
        createPresentationRoute(handleAcceptHandoff, (req) => ({ handoffId: req.params['handoffId'] ?? '' })),
    );
    router.post(
        '/handoff/:handoffId/reject',
        validate({ params: handoffParamsSchema, body: rejectBodySchema }),
        createPresentationRoute(handleRejectHandoff, (req) => ({
            handoffId: req.params['handoffId'] ?? '',
            body: req.body,
        })),
    );

    return router;
}
