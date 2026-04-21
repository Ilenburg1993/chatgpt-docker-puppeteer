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

import { validateUrlString } from '#copilot/core';
import { Router } from 'express';
import { z } from 'zod';

import { resolveRequestedRuntimeId } from '../../presentation/runtime-request.js';
import {
    listRuntimeWebhooks,
    registerRuntimeWebhook,
    resolveRuntimeWebhookSelection,
    unregisterRuntimeWebhook,
} from '../../presentation/runtime-webhooks.js';
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
router.get('/webhooks', (/** @type {Req} */ req, /** @type {Res} */ res) => {
    const selection = resolveRuntimeWebhookSelection(resolveRequestedRuntimeId(req));
    const list = listRuntimeWebhooks(selection.requestedRuntimeId ?? selection.runtimeId);
    res.json({
        ok: true,
        runtimeId: selection.runtimeId,
        requestedRuntimeId: selection.requestedRuntimeId,
        runtimeFound: selection.runtimeFound,
        usedDefaultRuntimeFallback: selection.usedDefaultRuntimeFallback,
        count: list.length,
        webhooks: list,
    });
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
    const runtimeId = resolveRequestedRuntimeId(req);

    const validation = validateUrlString(url);
    if (!validation.safe) {
        res.status(400).json({ ok: false, error: validation.reason });
        return;
    }

    const selection = resolveRuntimeWebhookSelection(runtimeId);
    const result = registerRuntimeWebhook(url, selection.requestedRuntimeId ?? selection.runtimeId);
    res.status(201).json({
        ok: true,
        runtimeId: selection.runtimeId,
        requestedRuntimeId: selection.requestedRuntimeId,
        runtimeFound: selection.runtimeFound,
        usedDefaultRuntimeFallback: selection.usedDefaultRuntimeFallback,
        ...result,
    });
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
        const selection = resolveRuntimeWebhookSelection(resolveRequestedRuntimeId(req));
        const removed = unregisterRuntimeWebhook(id, selection.requestedRuntimeId ?? selection.runtimeId);
        if (!removed) {
            res.status(404).json({ ok: false, error: `Webhook '${id}' não encontrado` });
            return;
        }
        res.json({
            ok: true,
            runtimeId: selection.runtimeId,
            requestedRuntimeId: selection.requestedRuntimeId,
            runtimeFound: selection.runtimeFound,
            usedDefaultRuntimeFallback: selection.usedDefaultRuntimeFallback,
            id,
        });
    },
);

export { router as webhooksRouter };
export default router;
