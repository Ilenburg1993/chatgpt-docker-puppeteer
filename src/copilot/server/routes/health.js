// @ts-check
/**
 * @module copilot/server/routes/health
 * @file Router Express para rotas de health check do servidor copilot.
 *
 *   Rotas auth-exempt (skipAuth): GET /health, GET /hub-health Onda 3.1 — L55.1. Onda 3.4 — L58.3: GET /ws/info (info
 *   sobre conexões socket ativas)
 *
 *   src/copilot/server/routes/health.js
 */

import { Router } from 'express';
import { handleHubHealth } from '../../terminal/handlers/dialog.js';
import { handleHealth } from '../../terminal/handlers/system-config.js';
import { callHandler } from '../handler-bridge.js';
import { getCopilotNamespace } from '../socket/hub-ns.js';

/**
 * Cria o router de health do servidor copilot. Rotas: GET /health, GET /hub-health, GET /ws/info
 *
 * @returns {import('express').Router}
 */
export function createHealthRouter() {
    const router = Router();

    // Auth-exempt: skipAuth no route-table original
    router.get('/health', (req, res, next) => callHandler(handleHealth, req, res, next));
    router.get('/hub-health', (req, res, next) => callHandler(handleHubHealth, req, res, next));

    // Onda 3.4: informações sobre conexões socket ativas
    router.get('/ws/info', (req, res) => {
        const ns = getCopilotNamespace();
        if (!ns) {
            res.json({ ok: true, connected: 0, namespaces: ['/copilot'], socketMounted: false });
            return;
        }
        ns.fetchSockets()
            .then((sockets) => {
                res.json({
                    ok: true,
                    connected: sockets.length,
                    namespaces: ['/copilot'],
                    socketMounted: true,
                    socketIds: sockets.map((s) => s.id),
                });
            })
            .catch(() => {
                res.json({
                    ok: true,
                    connected: 0,
                    namespaces: ['/copilot'],
                    socketMounted: true,
                    error: 'namespace query failed',
                });
            });
    });

    return router;
}
