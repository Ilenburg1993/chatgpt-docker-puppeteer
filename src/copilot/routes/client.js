// @ts-check
/**
 * src/copilot/routes/client.js
 *
 * Rotas de controle do CopilotClient e utilitários globais.
 *
 * Montadas em /api/sdk/* via sdk-api.js.
 *
 * Endpoints:
 *
 * - GET /ping — Ping ao CLI server
 * - GET /status — Estado da conexão + versão do CLI
 * - GET /auth — Status de autenticação GitHub
 * - GET /models — Lista modelos disponíveis
 * - GET /tools — Lista ferramentas (registry ou fallback estático)
 * - POST /client/start — Inicia CopilotClient
 * - POST /client/stop — Para CopilotClient (gracioso)
 * - POST /client/force-stop — Para CopilotClient forçadamente
 *
 * @module copilot/routes/client
 */

import { log } from '#copilot/observability/logger';
import { Router } from 'express';
import { alwaysAliveAgent } from '../agent/always-alive.js';
import { getClient, getClientState, stopClient } from '../lib/sdk-client.js';
import { allTools } from '../tools/index.js';
import { withErrorHandler as _withErrorHandler } from './middleware.js';

/**
 * @typedef {import('express').Request} Req
 *
 * @typedef {import('express').Response} Res
 */

const router = Router();

/**
 * Wrapper com prefixo de log para as rotas de cliente.
 *
 * @param {Req} req
 * @param {Res} res
 * @param {() => Promise<unknown>} fn
 * @returns {Promise<void>}
 */
const withErrorHandler = _withErrorHandler.bind(null, 'sdk-api/client');

// ─────────────────────────────────────────────────────────────────────────────
// GET /ping
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ping ao CLI server para verificar conectividade.
 */
router.get('/ping', (req, res) => {
    void withErrorHandler(req, res, async () => {
        const client = await getClient();
        const result = await client.ping();
        res.json({ ok: true, ...result });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /status
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Estado da conexão do client + versão do CLI.
 */
router.get('/status', (req, res) => {
    void withErrorHandler(req, res, async () => {
        const state = getClientState();
        if (state !== 'connected') {
            res.json({ ok: true, connectionState: state, status: null });
            return;
        }
        const client = await getClient();
        const status = await client.getStatus();
        res.json({ ok: true, connectionState: state, ...status });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /auth
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Status da autenticação GitHub do CLI.
 */
router.get('/auth', (req, res) => {
    void withErrorHandler(req, res, async () => {
        const client = await getClient();
        const auth = await client.getAuthStatus();
        res.json({ ok: true, ...auth });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /models
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lista modelos disponíveis com metadados de billing e capacidades.
 *
 * @example
 *     // GET /api/sdk/models
 *     // Response: { ok: true, models: [{ id, displayName, capabilities, billing }] }
 */
router.get('/models', (req, res) => {
    void withErrorHandler(req, res, async () => {
        const client = await getClient();
        const models = await client.listModels();
        res.json({ ok: true, count: models.length, models });
    });
});

// ─── Controle do cliente ──────────────────────────────────────────────────────

/**
 * POST /client/start
 *
 * Inicia (ou reconecta) o CopilotClient singleton.
 */
router.post('/client/start', (req, res) => {
    void withErrorHandler(req, res, async () => {
        const client = await getClient();
        const state = client.getState();
        res.json({ ok: true, state, message: 'CopilotClient iniciado.' });
    });
});

/**
 * POST /client/stop
 *
 * Para o CopilotClient singleton e limpa todas as sessões do registry.
 */
router.post('/client/stop', (req, res) => {
    void withErrorHandler(req, res, async () => {
        await stopClient();
        res.json({ ok: true, message: 'CopilotClient parado e sessões limpas.' });
    });
});

/**
 * POST /client/force-stop
 *
 * Para forçadamente o CopilotClient sem cleanup gracioso. Use quando `stop()` demora demais.
 */
router.post('/client/force-stop', (req, res) => {
    void withErrorHandler(req, res, async () => {
        const client = await getClient();
        // F6.8 (BUG-MOD-15): usar optional chaining para compatibilidade com versões SDK sem forceStop
        await /** @type {{ forceStop?: () => Promise<void> }} */ (client).forceStop?.();
        log('INFO', '[sdk-api] CopilotClient force-stop executado');
        res.json({ ok: true, message: 'CopilotClient force-stop executado.' });
    });
});

// ─── Ferramentas ─────────────────────────────────────────────────────────────

/**
 * GET /tools
 *
 * Lista as ferramentas disponíveis. Se o agente está iniciado, usa o ToolsRegistry rico (com categoria, tags, readOnly,
 * skipPermission). Caso contrário, usa allTools estático.
 */
router.get('/tools', (_req, res) => {
    const registry = /** @type {{ toolsRegistry?: { entries?: Map<string, Record<string, unknown>> } }} */ (
        alwaysAliveAgent
    ).toolsRegistry;

    if (registry?.entries instanceof Map && registry.entries.size > 0) {
        // Registry rico disponível
        const list = [];
        for (const [name, entry] of registry.entries) {
            const t = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (entry['tool']));
            list.push({
                name,
                description: /** @type {string | null} */ (t['description'] ?? null),
                category: /** @type {string} */ (entry['category'] ?? 'uncategorized'),
                tags: /** @type {string[]} */ (entry['tags'] ?? []),
                readOnly: /** @type {boolean} */ (entry['readOnly'] ?? false),
                skipPermission: /** @type {boolean} */ (t['skipPermission'] ?? false),
            });
        }
        res.json({ ok: true, source: 'registry', count: list.length, tools: list });
        return;
    }

    // Fallback: allTools estático (agente não iniciado)
    const list = allTools.map((tool) => {
        const t = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (tool));
        return {
            name: /** @type {string} */ (t['name'] ?? '(unknown)'),
            description: /** @type {string | null} */ (t['description'] ?? null),
            category: 'uncategorized',
            tags: /** @type {string[]} */ ([]),
            readOnly: false,
            skipPermission: /** @type {boolean} */ (t['skipPermission'] ?? false),
        };
    });
    res.json({ ok: true, source: 'static', count: list.length, tools: list });
});

export default router;
