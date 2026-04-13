// @ts-check
/**
 * src/copilot/server/routes/sessions.js
 *
 * Router Express canônico para operações CRUD de hub sessions.
 *
 * Onda 4.1 — L64.2: consolida o CRUD completo de sessions em um módulo dedicado.
 * As rotas GET /sessions e GET /sessions/:id/turns foram movidas de observability.js
 * para cá, adicionando GET /sessions/:id, POST /sessions e DELETE /sessions/:id.
 *
 * Rotas expostas:
 *   GET    /sessions                       — lista sessions (paginada, filtro ?status=)
 *   GET    /sessions/:sessionId            — obtém uma session por ID
 *   POST   /sessions                       — cria uma nova session
 *   DELETE /sessions/:sessionId            — fecha (soft-delete) uma session
 *   GET    /sessions/:sessionId/turns      — lista turnos de uma session (paginada)
 *
 * @module copilot/server/routes/sessions
 */

import { conversationStore } from '#copilot/services';
import { Router } from 'express';
import { bridgeHandler } from '../handler-bridge.js';
import { handleListSessions, handleListTurns } from '../../terminal/handlers/dialog.js';

/**
 * @typedef {import('express').Request} Req
 * @typedef {import('express').Response} Res
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
            const sessionField = conversationStore.getHubSession(sessionId);
            if (!sessionField) {
                res.status(404).json({ ok: false, error: `Session não encontrada: ${sessionId}` });
                return;
            }
            res.json({ ok: true, session: sessionField });
        } catch (/** @type {any} */ e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // ── POST /sessions — cria nova session ────────────────────────────────────
    router.post('/sessions', (/** @type {Req} */ req, /** @type {Res} */ res) => {
        const { title, sdkSessionId, metadata } = /** @type {Record<string, unknown>} */ (req.body ?? {});
        try {
            /** @type {{ title?: string; sdkSessionId?: string; metadata?: object }} */
            const hubOpts = {};
            if (typeof title === 'string') hubOpts.title = title;
            if (typeof sdkSessionId === 'string') hubOpts.sdkSessionId = sdkSessionId;
            if (metadata && typeof metadata === 'object') hubOpts.metadata = /** @type {object} */ (metadata);
            const id = conversationStore.createHubSession(hubOpts);
            res.status(201).json({ ok: true, id });
        } catch (/** @type {any} */ e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // ── DELETE /sessions/:sessionId — fecha session (soft-close) ──────────────
    router.delete('/sessions/:sessionId', (/** @type {Req} */ req, /** @type {Res} */ res) => {
        const sessionId = String(req.params['sessionId'] ?? '');
        if (!sessionId) {
            res.status(400).json({ ok: false, error: 'sessionId obrigatório' });
            return;
        }
        try {
            const existing = conversationStore.getHubSession(sessionId);
            if (!existing) {
                res.status(404).json({ ok: false, error: `Session não encontrada: ${sessionId}` });
                return;
            }
            conversationStore.closeHubSession(sessionId);
            res.json({ ok: true, closed: sessionId });
        } catch (/** @type {any} */ e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

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
