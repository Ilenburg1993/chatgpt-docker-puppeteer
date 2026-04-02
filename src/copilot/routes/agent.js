// @ts-check
/**
 * src/copilot/routes/agent.js
 *
 * Rotas de inspeção e controle do agente Always-Alive.
 *
 * Montadas em /api/sdk/* via sdk-api.js.
 *
 * Endpoints:
 *
 * - GET /agent/info — Info do agente (status, uptime, PID, sessionId)
 * - GET /agent/tools — ToolsRegistry rico com metadados
 * - GET /agent/telemetry — Resumo de telemetria (sessões, erros)
 * - POST /agent/telemetry/clear — Reseta store de telemetria
 * - GET /agent/state — Estado de conexão do CopilotClient
 * - GET /agent/stream — SSE de eventos de ciclo de vida do cliente
 *
 * @module copilot/routes/agent
 */

import { log } from '#copilot/observability/logger';
import { Router } from 'express';
import { alwaysAliveAgent } from '../agent/always-alive.js';
import { MAX_SSE_CLIENTS } from '../core/constants.js';
import { getClient } from '../lib/sdk-client.js';
import { clearTelemetry, getSummary } from '../lib/telemetry.js';
import { withErrorHandler as _withErrorHandler } from './middleware.js';

/** Contador de clientes SSE ativos em /agent/stream. */
let _agentSseClients = 0;

/**
 * @typedef {import('express').Request} Req
 *
 * @typedef {import('express').Response} Res
 */

const router = Router();

/**
 * Wrapper com prefixo de log para as rotas de agente.
 *
 * @param {Req} req
 * @param {Res} res
 * @param {() => Promise<unknown>} fn
 * @returns {Promise<void>}
 */
const withErrorHandler = _withErrorHandler.bind(null, 'sdk-api/agent');

// ─────────────────────────────────────────────────────────────────────────────
// GET /agent/info
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Retorna informações do agente Always-Alive: status, uptime, sessão ativa.
 */
router.get('/agent/info', (_req, res) => {
    res.json({
        ok: true,
        running: alwaysAliveAgent.status !== 'stopped',
        sessionId: alwaysAliveAgent.sessionId ?? null,
        uptime: Math.floor(process.uptime()),
        pid: process.pid,
        nodeVersion: process.version,
        env: process.env['NODE_ENV'] ?? 'development',
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /agent/tools
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lista as ferramentas registradas no ToolsRegistry do agente, com metadados ricos. G2-API-11: suporta
 * ?category=hook&page=1&limit=20 para filtragem e paginação.
 */
router.get('/agent/tools', (req, res) => {
    const registry = alwaysAliveAgent.toolsRegistry;
    if (!registry) {
        res.status(503).json({ ok: false, error: 'ToolsRegistry não disponível (agente não iniciado)' });
        return;
    }

    let entries = [...registry.entries.values()];

    // G2-API-11: filtro por categoria
    const category = typeof req.query['category'] === 'string' ? req.query['category'].trim() : '';
    if (category) {
        entries = entries.filter((e) => e.category === category);
    }

    const total = entries.length;

    // G2-API-11: paginação
    const page = Math.max(1, parseInt(String(req.query['page'] ?? ''), 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(String(req.query['limit'] ?? ''), 10) || total));
    const start = (page - 1) * limit;
    const paged = entries.slice(start, start + limit);

    res.json({
        ok: true,
        total,
        page,
        limit,
        pages: Math.ceil(total / limit) || 1,
        tools: paged.map((e) => ({ name: e.tool.name, category: e.category, tags: e.tags, readOnly: e.readOnly })),
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /agent/telemetry  +  GET /telemetry (alias retrocompatível)  +  POST /agent/telemetry/clear
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Retorna o resumo de telemetria do agente (sessões, erros, latências). Alias /telemetry mantido para compatibilidade
 * retroativa (UPG-N08/GAP-N14).
 *
 * @param {import('express').Request} _req
 * @param {import('express').Response} res
 */
function handleGetTelemetry(_req, res) {
    const telemetry = alwaysAliveAgent.telemetry;
    if (!telemetry) {
        res.status(503).json({ ok: false, error: 'Telemetria não disponível (agente não iniciado)' });
        return;
    }
    res.json({ ok: true, summary: getSummary(telemetry), raw: telemetry });
}

router.get('/agent/telemetry', handleGetTelemetry);
router.get('/telemetry', handleGetTelemetry);

/**
 * Reseta o store de telemetria do agente. Útil após deploy ou manutenção.
 */
router.post('/agent/telemetry/clear', (req, res) => {
    void req;
    const telemetry = alwaysAliveAgent.telemetry;
    if (!telemetry) {
        res.status(503).json({ ok: false, error: 'Telemetria não disponível (agente não iniciado)' });
        return;
    }
    clearTelemetry(telemetry);
    log('INFO', '[sdk-api] telemetria resetada via POST /agent/telemetry/clear');
    res.json({ ok: true, message: 'Telemetria resetada com sucesso' });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /agent/state
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Retorna o estado de conexão atual do CopilotClient (ConnectionState).
 *
 * @example
 *     GET /api/sdk/agent/state
 *     → { ok: true, state: "connected" }
 */
router.get('/agent/state', (req, res) => {
    void withErrorHandler(req, res, async () => {
        const client = await getClient();
        const state = client.getState();
        res.json({ ok: true, state });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /agent/stream  (SSE)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Abre um stream SSE de eventos de ciclo de vida do CopilotClient (conexão, desconexão, erros).
 *
 * Eventos entregues:
 *
 * - `lifecycle` — { type, data } de eventos do client.on()
 * - `heartbeat` — keepalive a cada 30s
 * - `connected` — enviado imediatamente ao conectar (com estado atual)
 *
 * @example
 *     const es = new EventSource('/api/sdk/agent/stream');
 *     es.addEventListener('lifecycle', (e) => console.log(JSON.parse(e.data)));
 */
router.get('/agent/stream', (req, res) => {
    void withErrorHandler(req, res, async () => {
        if (_agentSseClients >= MAX_SSE_CLIENTS) {
            res.status(429).json({ ok: false, error: 'Limite de clientes SSE atingido' });
            return;
        }
        const client = await getClient();

        _agentSseClients++;
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders();

        /**
         * Envia evento SSE formatado.
         *
         * @param {string} eventType
         * @param {unknown} data
         */
        const sendEvent = (eventType, data) => {
            if (res.writableEnded) return;
            res.write(`event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`);
        };

        sendEvent('connected', { state: client.getState(), timestamp: Date.now() });

        // Inscreve nos eventos de ciclo de vida do client
        const unsubscribe = client.on((event) => {
            sendEvent('lifecycle', event);
        });

        const heartbeatInterval = setInterval(() => {
            sendEvent('heartbeat', { ts: Date.now() });
        }, 30_000);

        req.on('close', () => {
            _agentSseClients--;
            clearInterval(heartbeatInterval);
            unsubscribe();
            log('INFO', '[sdk-api] SSE agent/stream encerrado');
        });
        // G2-API-12: decrementar também em 'error' e 'finish' para evitar vazamento do contador
        res.on('error', () => _agentSseClients--);
        res.on('finish', () => _agentSseClients--);
    });
});

export default router;
