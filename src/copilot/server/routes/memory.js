// @ts-check
/**
 * @module copilot/server/routes/memory
 * @file Router Express para rotas de memória do servidor copilot.
 *
 * Rotas: GET /memory, POST /memory, DELETE /memory/:memoryId
 *
 * Onda 3.1 — L55.4.
 *
 * src/copilot/server/routes/memory.js
 */

import { Router } from 'express';
import {
    handleDeleteMemory,
    handleRecallMemories,
    handleStoreMemory,
} from '../../terminal/handlers/dialog.js';
import { bridgeHandler } from '../handler-bridge.js';
import { writeRateMiddleware } from '../middleware/rate-limiter.js';

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
        bridgeHandler(handleRecallMemories, (req) => ({
            tag: req.query['tag'] ?? null,
            search: req.query['search'] ?? null,
            limit: Number(req.query['limit'] ?? 20),
        })),
    );

    // POST /memory — rate limit write
    router.post('/', writeRateMiddleware, bridgeHandler(handleStoreMemory));

    // DELETE /memory/:memoryId
    router.delete(
        '/:memoryId',
        bridgeHandler(/** @type {import('../handler-bridge.js').CopilotHandler} */ (handleDeleteMemory), (req) => ({
            memoryId: req.params['memoryId'] ?? '',
        })),
    );

    return router;
}
