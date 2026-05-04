// @ts-check
/**
 * @module copilot/server/routes/memory
 * @file Router Express para rotas de memória do servidor copilot.
 *
 *   Rotas: GET /memory, POST /memory, DELETE /memory/:memoryId
 *
 *   Onda 3.1 — L55.4.
 *
 *   src/copilot/server/routes/memory.js
 */

import { Router } from 'express';
import { z } from 'zod';
import { handleDeleteMemory, handleRecallMemories, handleStoreMemory } from '../../presentation/conversation-hub.js';
import { writeRateMiddleware } from '../middleware/rate-limiter.js';
import { validate } from '../middleware/validate.js';
import { createPresentationRoute } from './presentation-route.js';

// ── Zod schemas (S-C-03 fix) ──────────────────────────────────────────────
const storeMemoryBodySchema = z.object({
    content: z.string().min(1).max(32_000),
    tag: z.string().max(128).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
});

const memoryParamsSchema = z.object({
    memoryId: z.string().min(1),
});

/**
 * Cria o router de memória do servidor copilot.
 *
 * @returns {import('express').Router}
 */
export function createMemoryRouter() {
    const router = Router();

    // GET /memory?tag=&search=&limit=
    router.get(
        '/',
        createPresentationRoute(handleRecallMemories, (req) => ({
            tag: req.query['tag'] ?? null,
            search: req.query['search'] ?? null,
            limit: Number(req.query['limit'] ?? 20),
        })),
    );

    // POST /memory — rate limit write
    router.post(
        '/',
        writeRateMiddleware,
        validate({ body: storeMemoryBodySchema }),
        createPresentationRoute(handleStoreMemory),
    );

    // DELETE /memory/:memoryId
    router.delete(
        '/:memoryId',
        validate({ params: memoryParamsSchema }),
        createPresentationRoute(
            /** @type {import('./presentation-route.js').PresentationHandler} */ (handleDeleteMemory),
            (req) => ({
                memoryId: req.params['memoryId'] ?? '',
            }),
        ),
    );

    return router;
}
