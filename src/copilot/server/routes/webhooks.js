// @ts-check
/**
 * src/copilot/server/routes/webhooks.js
 *
 * Router canônico para gerenciamento de webhooks do agente Always-Alive.
 *
 * Onda 5.2 — migrado de `api/express/webhooks.js`. Endpoints:
 *
 * - GET /webhooks — Lista webhooks registrados
 * - POST /webhooks — Registra nova URL de webhook
 * - DELETE /webhooks/:id — Remove webhook registrado
 *
 * @module copilot/server/routes/webhooks
 */

import { container, validateUrlString } from '#copilot/core';
import { Router } from 'express';
import { z } from 'zod';

import { ALWAYS_ALIVE_AGENT } from '../../agent/di-tokens.js';
import { validate } from '../middleware/validate.js';

/**
 * @typedef {import('express').Request} Req
 *
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
    const agent = container.resolve(ALWAYS_ALIVE_AGENT);
    const list = agent.listWebhooks();
    res.json({ ok: true, count: list.length, webhooks: list });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /webhooks
// ─────────────────────────────────────────────────────────────────────────────

const webhookBodySchema = z.object({ url: z.string().url() });

/**
 * Registra uma nova URL de webhook.
 *
 * Body: `{ url: string }` Response: `{ ok: true, id: string, url: string }`
 */
router.post('/webhooks', validate({ body: webhookBodySchema }), (/** @type {Req} */ req, /** @type {Res} */ res) => {
    const { url } = /** @type {{ url: string }} */ (req.body);

    const validation = validateUrlString(url);
    if (!validation.safe) {
        res.status(400).json({ ok: false, error: validation.reason });
        return;
    }

    const result = container.resolve(ALWAYS_ALIVE_AGENT).registerWebhook(url);
    res.status(201).json({ ok: true, ...result });
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /webhooks/:id
// ─────────────────────────────────────────────────────────────────────────────

const webhookParamsSchema = z.object({ id: z.string().min(1) });

/**
 * Remove um webhook previamente registrado.
 */
router.delete(
    '/webhooks/:id',
    validate({ params: webhookParamsSchema }),
    (/** @type {Req} */ req, /** @type {Res} */ res) => {
        const id = /** @type {string} */ (req.params['id']);
        const removed = container.resolve(ALWAYS_ALIVE_AGENT).unregisterWebhook(id);
        if (!removed) {
            res.status(404).json({ ok: false, error: `Webhook '${id}' não encontrado` });
            return;
        }
        res.json({ ok: true, id });
    },
);

export { router as webhooksRouter };
export default router;
