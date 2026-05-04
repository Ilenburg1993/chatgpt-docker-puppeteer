// @ts-check
/**
 * @module copilot/server/routes/observability
 * @file Router Express para rotas de observabilidade do servidor copilot.
 *
 *   Rotas: GET /errors, GET /tool-stats, GET /history, GET /audit, POST /system/reset, GET /metrics (custom: text/plain)
 *
 *   Nota: GET /sessions e GET /sessions/:sessionId/turns foram movidos para server/routes/sessions.js na Onda 4.1
 *   (L64.2).
 *
 *   Onda 3.1 — L55.5.
 *
 *   src/copilot/server/routes/observability.js
 */

import { Router } from 'express';
import {
    handleGetAudit,
    handleGetErrors,
    handleGetHistory,
    handleGetThinkingEntry,
    handleGetThinkingHistory,
    handleGetToolStats,
    handleMetrics,
    handleSystemReset,
} from '../../presentation/system-metrics.js';
import { writeRateMiddleware } from '../middleware/rate-limiter.js';
import { createPresentationRoute } from './presentation-route.js';

/**
 * Cria o router de observabilidade do servidor copilot.
 *
 * @returns {import('express').Router}
 */
export function createObservabilityRouter() {
    const router = Router();

    // GET /errors — rate limited (F14.1/F15.2)
    router.get('/errors', writeRateMiddleware, createPresentationRoute(handleGetErrors));

    // GET /tool-stats — rate limited (F14.3/F15.2)
    router.get('/tool-stats', writeRateMiddleware, createPresentationRoute(handleGetToolStats));

    // GET /history?limit=
    router.get(
        '/history',
        createPresentationRoute(handleGetHistory, (req) => ({
            limit: Number(req.query['limit'] ?? 50),
        })),
    );

    // GET /thinking?limit= — lista thinkings capturados como artefatos colapsados.
    router.get(
        '/thinking',
        createPresentationRoute(handleGetThinkingHistory, (req) => ({
            limit: Number(req.query['limit'] ?? 20),
        })),
    );

    // GET /thinking/:thinkingId — abre um thinking completo (`latest` ou sufixo curto aceito).
    router.get(
        '/thinking/:thinkingId',
        createPresentationRoute(handleGetThinkingEntry, (req) => ({
            id: String(req.params['thinkingId'] ?? 'latest'),
        })),
    );

    // GET /audit?summary=&limit=&sessionId= — rate limited (F14.2/F15.2)
    router.get(
        '/audit',
        writeRateMiddleware,
        createPresentationRoute(handleGetAudit, (req) => ({
            summary: Number(req.query['summary'] ?? 0),
            limit: Number(req.query['limit'] ?? 50),
            ...(req.query['sessionId'] ? { sessionId: String(req.query['sessionId']) } : {}),
        })),
    );

    // GET /sessions?limit=&offset=&status= (movido para sessions.js na Onda 4.1)
    // GET /sessions/:sessionId/turns?limit=&offset= (movido para sessions.js na Onda 4.1)

    // POST /system/reset — emergency reset (limpa rate limiters e error tracker)
    router.post('/system/reset', createPresentationRoute(handleSystemReset));

    // GET /metrics — retorna texto (Prometheus/plain) preservando contentType do HandlerResult.
    router.get('/metrics', createPresentationRoute(handleMetrics));

    return router;
}
