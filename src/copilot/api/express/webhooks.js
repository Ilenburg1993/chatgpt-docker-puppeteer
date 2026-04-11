// @ts-check
/**
 * src/copilot/routes/webhooks.js
 *
 * Rotas de gerenciamento de webhooks do agente Always-Alive.
 *
 * Montadas em /api/sdk/* via sdk-api.js.
 *
 * Endpoints:
 *
 * - GET /webhooks — Lista webhooks registrados
 * - POST /webhooks — Registra nova URL de webhook
 * - DELETE /webhooks/:id — Remove webhook registrado
 *
 * @module copilot/routes/webhooks
 */

import { validateUrlString } from '#copilot/core/security/url-validator';
import { Router } from 'express';

/**
 * @typedef {import('express').Request} Req
 *
 * @typedef {import('express').Response} Res
 */

/**
 * Dependências injetáveis do router de webhooks.
 *
 * @typedef {object} WebhooksRouterDeps
 * @property {import('#copilot/agent').AlwaysAliveAgent} agent - Instância do agente.
 */

/**
 * Factory que cria o router de rotas `/webhooks/*` com dependências injetadas.
 *
 * @param {WebhooksRouterDeps} deps
 * @returns {import('express').Router}
 */
export default function createWebhooksRouter(deps) {
    const { agent } = deps;
    const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// GET /webhooks
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lista todos os webhooks registrados no agente Always-Alive.
 */
router.get('/webhooks', (_req, res) => {
    const list = agent.listWebhooks();
    res.json({ ok: true, count: list.length, webhooks: list });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /webhooks
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Registra uma nova URL de webhook para receber notificações de eventos de sessão.
 *
 * Body: { url: string } Response: { ok: true, id: string, url: string }
 */
router.post('/webhooks', (req, res) => {
    const { url } = /** @type {{ url?: string }} */ (req.body ?? {});
    if (!url || typeof url !== 'string') {
        res.status(400).json({ ok: false, error: 'Campo "url" é obrigatório e deve ser string' });
        return;
    }

    // UPG-P2-01: validação centralizada via lib/url-validator.js
    const validation = validateUrlString(url);
    if (!validation.safe) {
        res.status(400).json({ ok: false, error: validation.reason });
        return;
    }

    const result = agent.registerWebhook(url);
    res.status(201).json({ ok: true, ...result });
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /webhooks/:id
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Remove um webhook previamente registrado.
 */
router.delete('/webhooks/:id', (req, res) => {
    const { id } = req.params;
    const removed = agent.unregisterWebhook(id);
    if (!removed) {
        res.status(404).json({ ok: false, error: `Webhook '${id}' não encontrado` });
        return;
    }
    res.json({ ok: true, id });
});

    return router;
}
