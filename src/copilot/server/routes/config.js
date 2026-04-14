// @ts-check
/**
 * @module copilot/server/routes/config
 * @file Router Express para rotas de configuração do servidor copilot.
 *
 *   Rotas: GET /config, GET /config/skills, GET /config/tools, GET /config/tools/custom, PUT /config/infinite-session,
 *   PUT /config/skills, PUT /config/tools, POST /config/tools/custom, DELETE /config/tools/custom/:name
 *
 *   Onda 3.1 — L55.3.
 *
 *   src/copilot/server/routes/config.js
 */

import { Router } from 'express';
import { z } from 'zod';
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
import { validate } from '../middleware/validate.js';

// ── Zod schemas (S-C-03 fix) ──────────────────────────────────────────────
const infiniteSessionBodySchema = z.object({
    enabled: z.boolean(),
});

const skillsBodySchema = z.object({
    skills: z.array(z.string()).min(0),
});

const toolsConfigBodySchema = z.object({
    allowlist: z.array(z.string()).nullable().optional(),
    denylist: z.array(z.string()).optional(),
});

const customToolBodySchema = z.object({
    name: z.string().min(1).max(128),
    description: z.string().max(1024).optional(),
    schema: z.record(z.unknown()).optional(),
});

const customToolParamsSchema = z.object({
    name: z.string().min(1),
});

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
    router.put(
        '/infinite-session',
        validate({ body: infiniteSessionBodySchema }),
        bridgeHandler(handleSetInfiniteSessionConfig),
    );
    router.put('/skills', validate({ body: skillsBodySchema }), bridgeHandler(handleSetSkills));
    router.put('/tools', validate({ body: toolsConfigBodySchema }), bridgeHandler(handleSetToolsConfig));

    // POST
    router.post('/tools/custom', validate({ body: customToolBodySchema }), bridgeHandler(handleRegisterCustomTool));

    // DELETE /tools/custom/:name — nome pode conter chars especiais, usa decodeURIComponent
    router.delete(
        '/tools/custom/:name',
        validate({ params: customToolParamsSchema }),
        bridgeHandler(handleDeleteCustomTool, (req) => ({
            name: decodeURIComponent(String(req.params['name'] ?? '')),
        })),
    );

    return router;
}
