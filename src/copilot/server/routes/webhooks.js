// @ts-check
/**
 * src/copilot/server/routes/webhooks.js
 *
 * Router canônico para gerenciamento de webhooks do agente Always-Alive.
 *
 * Onda 5.2 — migrado de `api/express/webhooks.js`. Endpoints:
 *
 * - GET  /webhooks       — Lista webhooks registrados
 * - POST /webhooks       — Registra nova URL de webhook
 * - DELETE /webhooks/:id — Remove webhook registrado
 *
 * @module copilot/server/routes/webhooks
 */

import { validateUrlString } from '#copilot/core';
import { Router } from 'express';

import { alwaysAliveAgent } from '#copilot/services';

/**
 * @typedef {import('express').Request} Req
 * @typedef {import('express').Response} Res
 */

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// GET /webhooks
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lista todos os webhooks registrados no agente Always-Alive.
 */
router.get('/webhooks', (_req, /** @type {Res} */ res) => {
    const list = alwaysAliveAgent.listWebhooks();
    res.json({ ok: true, count: list.length, webhooks: list });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /webhooks
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Registra uma nova URL de webhook.
 *
 * Body: `{ url: string }`
 * Response: `{ ok: true, id: string, url: string }`
 */
router.post('/webhooks', (/** @type {Req} */ req, /** @type {Res} */ res) => {
    const { url } = /** @type {{ url?: string }} */ (req.body ?? {});
    if (!url || typeof url !== 'string') {
        res.status(400).json({ ok: false, error: 'Campo "url" é obrigatório e deve ser string' });
        return;
    }

    const validation = validateUrlString(url);
    if (!validation.safe) {
        res.status(400).json({ ok: false, error: validation.reason });
        return;
    }

    const result = alwaysAliveAgent.registerWebhook(url);
    res.status(201).json({ ok: true, ...result });
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /webhooks/:id
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Remove um webhook previamente registrado.
 */
router.delete('/webhooks/:id', (/** @type {Req} */ req, /** @type {Res} */ res) => {
    const id = /** @type {string} */ (req.params['id']);
    if (!id || typeof id !== 'string') {
        res.status(400).json({ ok: false, error: 'Parâmetro "id" é obrigatório' });
        return;
    }
    const removed = alwaysAliveAgent.unregisterWebhook(id);
    if (!removed) {
        res.status(404).json({ ok: false, error: `Webhook '${id}' não encontrado` });
        return;
    }
    res.json({ ok: true, id });
});

export { router as webhooksRouter };
export default router;
