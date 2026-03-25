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

import { log } from '#core/logger';
import { Router } from 'express';
import { alwaysAliveAgent } from '../always-alive.js';
import { clearTelemetry, getSummary } from '../lib/telemetry.js';
import { getClient } from '../sdk-client.js';

/**
 * @typedef {import('express').Request} Req
 *
 * @typedef {import('express').Response} Res
 */

const router = Router();

/**
 * Wrapper que captura erros e retorna 500 padronizado.
 *
 * @param {Req} req
 * @param {Res} res
 * @param {() => Promise<unknown>} fn
 * @returns {Promise<void>}
 */
async function withErrorHandler(req, res, fn) {
    try {
        await fn();
    } catch (/** @type {any} */ e) {
        log('ERROR', `[sdk-api/agent] ${req.method} ${req.path} → ${e.message}`);
        if (!res.headersSent) {
            res.status(500).json({ ok: false, error: e.message });
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /agent/info
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Retorna informações do agente Always-Alive: status, uptime, sessão ativa.
 */
router.get('/agent/info', (_req, res) => {
    const agent = /** @type {any} */ (alwaysAliveAgent);
    res.json({
        ok: true,
        running: agent.isRunning?.() ?? false,
        sessionId: agent.currentSessionId ?? null,
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
 * Lista as ferramentas registradas no ToolsRegistry do agente, com metadados ricos.
 */
router.get('/agent/tools', (_req, res) => {
    const registry = /** @type {any} */ (alwaysAliveAgent).toolsRegistry;
    if (!registry) {
        res.status(503).json({ ok: false, error: 'ToolsRegistry não disponível (agente não iniciado)' });
        return;
    }
    res.json({ ok: true, ...registry });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /agent/telemetry  +  POST /agent/telemetry/clear
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Retorna o resumo de telemetria do agente (sessões, erros, latências).
 */
router.get('/agent/telemetry', (_req, res) => {
    const telemetry = /** @type {any} */ (alwaysAliveAgent).telemetry;
    if (!telemetry) {
        res.status(503).json({ ok: false, error: 'Telemetria não disponível (agente não iniciado)' });
        return;
    }
    res.json({ ok: true, summary: getSummary(telemetry), raw: telemetry });
});

/**
 * Reseta o store de telemetria do agente. Útil após deploy ou manutenção.
 */
router.post('/agent/telemetry/clear', (req, res) => {
    void req;
    const agent = /** @type {any} */ (alwaysAliveAgent);
    if (!agent.telemetry) {
        res.status(503).json({ ok: false, error: 'Telemetria não disponível (agente não iniciado)' });
        return;
    }
    clearTelemetry(agent.telemetry);
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
        const client = await getClient();

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
            clearInterval(heartbeatInterval);
            unsubscribe();
            log('INFO', '[sdk-api] SSE agent/stream encerrado');
        });
    });
});

export default router;
