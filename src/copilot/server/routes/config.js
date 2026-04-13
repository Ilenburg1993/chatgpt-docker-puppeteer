// @ts-check
/**
 * @module copilot/server/routes/config
 * @file Router Express para rotas de configuração do servidor copilot.
 *
 * Rotas: GET /config, GET /config/skills, GET /config/tools, GET /config/tools/custom,
 *   PUT /config/infinite-session, PUT /config/skills, PUT /config/tools,
 *   POST /config/tools/custom, DELETE /config/tools/custom/:name
 *
 * Onda 3.1 — L55.3.
 *
 * src/copilot/server/routes/config.js
 */

import { Router } from 'express';
import {
    handleDeleteCustomTool,
    handleGetConfig,
    handleGetCustomTools,
    handleGetSkills,
    handleGetToolsConfig,
    handleRegisterCustomTool,
    handleSetInfiniteSessionConfig,
    handleSetSkills,
    handleSetToolsConfig,
} from '../../terminal/handlers/system-config.js';
import { bridgeHandler } from '../handler-bridge.js';

/**
 * Cria o router de configuração do servidor copilot.
 *
 * @returns {import('express').Router}
 */
export function createConfigRouter() {
    const router = Router();

    // GET
    router.get('/', bridgeHandler(handleGetConfig));
    router.get('/skills', bridgeHandler(handleGetSkills));
    router.get('/tools', bridgeHandler(handleGetToolsConfig));
    router.get('/tools/custom', bridgeHandler(handleGetCustomTools));

    // PUT
    router.put('/infinite-session', bridgeHandler(handleSetInfiniteSessionConfig));
    router.put('/skills', bridgeHandler(handleSetSkills));
    router.put('/tools', bridgeHandler(handleSetToolsConfig));

    // POST
    router.post('/tools/custom', bridgeHandler(handleRegisterCustomTool));

    // DELETE /tools/custom/:name — nome pode conter chars especiais, usa decodeURIComponent
    router.delete(
        '/tools/custom/:name',
        bridgeHandler(handleDeleteCustomTool, (req) => ({
            name: decodeURIComponent(String(req.params['name'] ?? '')),
        })),
    );

    return router;
}
