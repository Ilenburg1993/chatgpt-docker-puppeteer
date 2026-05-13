// @ts-check
/**
 * src/copilot/server/routes/webhooks.js
 *
 * Router canônico para gerenciamento de webhooks do agente Always-Alive.
 *
 * Onda 5.2 — router canônico de webhooks em `server/routes/`. Endpoints:
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

import { projectAgentHttpError } from '../../presentation/agent/index.js';
import { buildMissingRuntimeRouteMeta } from '../../presentation/routing/index.js';
import { resolveRequestedRuntimeId } from '../../presentation/routing/index.js';
import {
    buildRuntimeWebhooksListHttpPayload,
    registerRuntimeWebhookHttp,
    unregisterRuntimeWebhookHttp,
} from '../../presentation/runtime/index.js';
import { validate } from '../middleware/validate.js';

/**
 * @typedef {import('express').Request} Req
 *
 * @typedef {import('express').Response} Res
 */

const router = Router();

/**
 * @param {unknown} error
 * @param {Req} req
 * @param {Res} res
 * @returns {boolean}
 */
function maybeSendRuntimeTargetingError(error, req, res) {
    const projection = projectAgentHttpError(error, {
        fallbackStatus: 500,
        statusByCode: { AGENT_RUNTIME_NOT_FOUND: 404 },
    });
    if (projection.body.code !== 'AGENT_RUNTIME_NOT_FOUND') return false;
    res.status(projection.status).json({
        ...projection.body,
        ...buildMissingRuntimeRouteMeta(resolveRequestedRuntimeId(req)),
    });
    return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /webhooks
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lista todos os webhooks registrados no agente Always-Alive.
 */
router.get('/webhooks', (/** @type {Req} */ req, /** @type {Res} */ res) => {
    try {
        res.json(buildRuntimeWebhooksListHttpPayload(resolveRequestedRuntimeId(req)));
    } catch (error) {
        if (!maybeSendRuntimeTargetingError(error, req, res)) throw error;
    }
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

    try {
        res.status(201).json(registerRuntimeWebhookHttp(url, runtimeId));
    } catch (error) {
        if (!maybeSendRuntimeTargetingError(error, req, res)) throw error;
    }
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
        let payload;
        try {
            payload = unregisterRuntimeWebhookHttp(id, resolveRequestedRuntimeId(req));
        } catch (error) {
            if (maybeSendRuntimeTargetingError(error, req, res)) return;
            throw error;
        }
        if (!payload) {
            res.status(404).json({ ok: false, error: `Webhook '${id}' não encontrado` });
            return;
        }
        res.json(payload);
    },
);

export { router as webhooksRouter };
export default router;
