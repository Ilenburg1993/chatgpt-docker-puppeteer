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

import { CONVERSATION_STORE } from '#copilot/conversation-hub';
import { container } from '#copilot/core';
import { Router } from 'express';
import { z } from 'zod';
import { handleListSessions, handleListTurns } from '../../terminal/handlers/dialog.js';
import { bridgeHandler } from '../handler-bridge.js';
import { validate } from '../middleware/validate.js';

/**
 * @typedef {import('express').Request} Req
 *
 * @typedef {import('express').Response} Res
 *
 * @typedef {import('express').NextFunction} NextFn
 */

/** Statuses válidos para filtragem de sessions. */
const VALID_STATUS = /** @type {const} */ (['active', 'closed', 'error']);

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
        bridgeHandler(handleListSessions, (req) => ({
            limit: req.query['limit'] !== undefined ? Number(req.query['limit']) : 20,
            offset: req.query['offset'] !== undefined ? Number(req.query['offset']) : 0,
            status: typeof req.query['status'] === 'string' ? req.query['status'] : undefined,
        })),
    );

    // ── GET /sessions/:sessionId — obtém session individual ───────────────────
    router.get('/sessions/:sessionId', (/** @type {Req} */ req, /** @type {Res} */ res) => {
        const sessionId = String(req.params['sessionId'] ?? '');
        if (!sessionId) {
            res.status(400).json({ ok: false, error: 'sessionId obrigatório' });
            return;
        }
        try {
            const sessionField = container.resolve(CONVERSATION_STORE).getHubSession(sessionId);
            if (!sessionField) {
                res.status(404).json({ ok: false, error: `Session não encontrada: ${sessionId}` });
                return;
            }
            res.json({ ok: true, session: sessionField });
        } catch (/** @type {any} */ e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    const createSessionSchema = z.object({
        title: z.string().optional(),
        sdkSessionId: z.string().optional(),
        metadata: z.record(z.unknown()).optional(),
    });

    // ── POST /sessions — cria nova session ────────────────────────────────────
    router.post(
        '/sessions',
        validate({ body: createSessionSchema }),
        (/** @type {Req} */ req, /** @type {Res} */ res) => {
            const { title, sdkSessionId, metadata } =
                /** @type {{ title?: string; sdkSessionId?: string; metadata?: Record<string, unknown> }} */ (req.body);
            try {
                /** @type {{ title?: string; sdkSessionId?: string; metadata?: object }} */
                const hubOpts = {};
                if (title) hubOpts.title = title;
                if (sdkSessionId) hubOpts.sdkSessionId = sdkSessionId;
                if (metadata) hubOpts.metadata = metadata;
                const id = container.resolve(CONVERSATION_STORE).createHubSession(hubOpts);
                res.status(201).json({ ok: true, id });
            } catch (/** @type {any} */ e) {
                res.status(500).json({ ok: false, error: e.message });
            }
        },
    );

    const sessionParamsSchema = z.object({ sessionId: z.string().min(1) });

    // ── DELETE /sessions/:sessionId — fecha session (soft-close) ──────────────
    router.delete(
        '/sessions/:sessionId',
        validate({ params: sessionParamsSchema }),
        (/** @type {Req} */ req, /** @type {Res} */ res) => {
            const sessionId = String(req.params['sessionId'] ?? '');
            try {
                const existing = container.resolve(CONVERSATION_STORE).getHubSession(sessionId);
                if (!existing) {
                    res.status(404).json({ ok: false, error: `Session não encontrada: ${sessionId}` });
                    return;
                }
                container.resolve(CONVERSATION_STORE).closeHubSession(sessionId);
                res.json({ ok: true, closed: sessionId });
            } catch (/** @type {any} */ e) {
                res.status(500).json({ ok: false, error: e.message });
            }
        },
    );

    // ── GET /sessions/:sessionId/turns — lista turnos paginados ───────────────
    router.get(
        '/sessions/:sessionId/turns',
        bridgeHandler(handleListTurns, (req) => ({
            sessionId: req.params['sessionId'] ?? '',
            limit: req.query['limit'] !== undefined ? Number(req.query['limit']) : 50,
            offset: req.query['offset'] !== undefined ? Number(req.query['offset']) : 0,
        })),
    );

    void VALID_STATUS; // referência simbólica — usado pelo handleListSessions via bridge

    return router;
}
