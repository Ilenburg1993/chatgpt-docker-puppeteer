// @ts-check
/**
 * @module copilot/server/routes/observability
 * @file Router Express para rotas de observabilidade do servidor copilot.
 *
 * Rotas: GET /errors, GET /tool-stats, GET /history, GET /audit,
 *   GET /sessions, GET /sessions/:sessionId/turns,
 *   POST /system/reset, GET /metrics (custom: text/plain)
 *
 * Onda 3.1 — L55.5.
 *
 * src/copilot/server/routes/observability.js
 */

import { Router } from 'express';
import {
    handleListSessions,
    handleListTurns
} from '../../terminal/handlers/dialog.js';
import {
    handleGetAudit,
    handleGetErrors,
    handleGetHistory,
    handleGetToolStats,
    handleMetrics,
    handleSystemReset,
} from '../../terminal/handlers/system-metrics.js';
import { bridgeHandler } from '../handler-bridge.js';
import { writeRateMiddleware } from '../middleware/rate-limiter.js';

/**
 * Cria o router de observabilidade do servidor copilot.
 *
 * @returns {import('express').Router}
 */
export function createObservabilityRouter() {
    const router = Router();

    // GET /errors — rate limited (F14.1/F15.2)
    router.get('/errors', writeRateMiddleware, bridgeHandler(handleGetErrors));

    // GET /tool-stats — rate limited (F14.3/F15.2)
    router.get('/tool-stats', writeRateMiddleware, bridgeHandler(handleGetToolStats));

    // GET /history?limit=
    router.get(
        '/history',
        bridgeHandler(handleGetHistory, (req) => ({
            limit: Number(req.query['limit'] ?? 50),
        })),
    );

    // GET /audit?summary=&limit=&sessionId= — rate limited (F14.2/F15.2)
    router.get(
        '/audit',
        writeRateMiddleware,
        bridgeHandler(handleGetAudit, (req) => ({
            summary: Number(req.query['summary'] ?? 0),
            limit: Number(req.query['limit'] ?? 50),
            ...(req.query['sessionId'] ? { sessionId: String(req.query['sessionId']) } : {}),
        })),
    );

    // GET /sessions?limit=&offset=&status=
    router.get(
        '/sessions',
        bridgeHandler(handleListSessions, (req) => ({
            limit: Number(req.query['limit'] ?? 20),
            offset: Number(req.query['offset'] ?? 0),
            ...(req.query['status'] ? { status: String(req.query['status']) } : {}),
        })),
    );

    // GET /sessions/:sessionId/turns?limit=&offset=
    router.get(
        '/sessions/:sessionId/turns',
        bridgeHandler(
            /** @type {import('../handler-bridge.js').CopilotHandler} */ (handleListTurns),
            (req) => ({
                sessionId: req.params['sessionId'] ?? '',
                limit: Number(req.query['limit'] ?? 50),
                offset: Number(req.query['offset'] ?? 0),
            }),
        ),
    );

    // POST /system/reset — emergency reset (limpa rate limiters e error tracker)
    router.post('/system/reset', bridgeHandler(handleSystemReset));

    // GET /metrics — skipAuth, retorna texto (custom: prometheus ou plain)
    // Nota: handleMetrics pode retornar text/plain; a bridge usa res.json() que pode não ser ideal.
    // A rota fica aqui como placeholder — server/sse/ trata o caso custom completo em Onda 3.6.
    router.get('/metrics', bridgeHandler(handleMetrics));

    return router;
}
