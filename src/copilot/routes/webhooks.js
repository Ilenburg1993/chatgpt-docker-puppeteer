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

import { Router } from 'express';
import { alwaysAliveAgent } from '../agent/always-alive.js';

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
router.get('/webhooks', (_req, res) => {
    const list = alwaysAliveAgent.listWebhooks();
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

    try {
        // Validação básica de URL
        const parsed = new URL(url);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
            res.status(400).json({ ok: false, error: 'URL deve usar protocolo http ou https' });
            return;
        }
        // SEC-P2-03: bloquear hosts privados/internos (SSRF)
        const host = parsed.hostname.toLowerCase();
        if (
            host === 'localhost' ||
            host === '127.0.0.1' ||
            host === '::1' ||
            host === '0.0.0.0' ||
            host.endsWith('.local') ||
            host.startsWith('10.') ||
            host.startsWith('192.168.') ||
            /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
            host.startsWith('169.254.') ||
            host === '[::1]' ||
            host.startsWith('fd') ||
            host.startsWith('fe80')
        ) {
            res.status(400).json({ ok: false, error: 'URL não pode apontar para hosts privados/internos' });
            return;
        }
    } catch {
        res.status(400).json({ ok: false, error: 'URL inválida' });
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
router.delete('/webhooks/:id', (req, res) => {
    const { id } = req.params;
    const removed = alwaysAliveAgent.unregisterWebhook(id);
    if (!removed) {
        res.status(404).json({ ok: false, error: `Webhook '${id}' não encontrado` });
        return;
    }
    res.json({ ok: true, id });
});

export default router;
