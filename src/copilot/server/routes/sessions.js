// @ts-check
/**
 * src/copilot/server/routes/sessions.js
 *
 * Router Express canônico para operações CRUD de hub sessions.
 *
 * Onda 4.1 — L64.2: consolida o CRUD completo de sessions em um módulo dedicado. As rotas GET /sessions e GET
 * /sessions/:id/turns foram movidas de observability.js para cá, adicionando GET /sessions/:id, POST /sessions e DELETE
 * /sessions/:id.
 *
 * Rotas expostas: GET /sessions — lista sessions (paginada, filtro ?status=) GET /sessions/:sessionId — obtém uma
 * session por ID POST /sessions — cria uma nova session DELETE /sessions/:sessionId — fecha (soft-delete) uma session
 * GET /sessions/:sessionId/turns — lista turnos de uma session (paginada)
 *
 * @module copilot/server/routes/sessions
 */

import { Router } from 'express';
import { z } from 'zod';
import {
    handleCloseHubSession,
    handleCreateHubSession,
    handleGetHubSession,
    handleListSessions,
    handleListTurns,
} from '../../presentation/conversation-hub.js';
import { validate } from '../middleware/validate.js';
import { createPresentationRoute } from './presentation-route.js';

/**
 * Cria o router de gerenciamento de hub sessions.
 *
 * @returns {import('express').Router}
 */
export function createSessionsRouter() {
    const router = Router();

    // ── GET /sessions — lista sessions paginadas ──────────────────────────────
    router.get(
        '/sessions',
        createPresentationRoute(handleListSessions, (req) => ({
            limit: req.query['limit'] !== undefined ? Number(req.query['limit']) : 20,
            offset: req.query['offset'] !== undefined ? Number(req.query['offset']) : 0,
            status: typeof req.query['status'] === 'string' ? req.query['status'] : undefined,
        })),
    );

    // ── GET /sessions/:sessionId — obtém session individual ───────────────────
    router.get(
        '/sessions/:sessionId',
        createPresentationRoute(handleGetHubSession, (req) => ({ sessionId: req.params['sessionId'] ?? '' })),
    );

    const createSessionSchema = z.object({
        title: z.string().optional(),
        sdkSessionId: z.string().optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
    });

    // ── POST /sessions — cria nova session ────────────────────────────────────
    router.post(
        '/sessions',
        validate({ body: createSessionSchema }),
        createPresentationRoute(handleCreateHubSession, (req) => ({
            body: /** @type {{ title?: string; sdkSessionId?: string; metadata?: Record<string, unknown> }} */ (
                req.body
            ),
        })),
    );

    const sessionParamsSchema = z.object({ sessionId: z.string().min(1) });

    // ── DELETE /sessions/:sessionId — fecha session (soft-close) ──────────────
    router.delete(
        '/sessions/:sessionId',
        validate({ params: sessionParamsSchema }),
        createPresentationRoute(handleCloseHubSession, (req) => ({ sessionId: req.params['sessionId'] ?? '' })),
    );

    // ── GET /sessions/:sessionId/turns — lista turnos paginados ───────────────
    router.get(
        '/sessions/:sessionId/turns',
        createPresentationRoute(handleListTurns, (req) => ({
            sessionId: req.params['sessionId'] ?? '',
            limit: req.query['limit'] !== undefined ? Number(req.query['limit']) : 50,
            offset: req.query['offset'] !== undefined ? Number(req.query['offset']) : 0,
        })),
    );

    return router;
}
