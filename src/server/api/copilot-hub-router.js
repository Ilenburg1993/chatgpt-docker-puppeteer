// @ts-check
/**
 * src/server/api/copilot-hub-router.js
 *
 * Router REST para o ConversationHub — ambiente permanente LLM-A ↔ LLM-B ↔ Usuário.
 *
 * Endpoints: GET /api/hub/sessions — lista hub_sessions (paginado) POST /api/hub/sessions — criar nova hub_session GET
 * /api/hub/sessions/:id — detalhes de uma sessão GET /api/hub/sessions/:id/turns — histórico de turns (paginado) POST
 * /api/hub/sessions/:id/inject — injeta mensagem do usuário na sessão POST /api/hub/sessions/:id/close — encerra sessão
 * GET /api/hub/status — status do hub (pronto/degraded)
 *
 * @module server/api/copilot-hub-router
 */

import { log } from '#core/logger';
import express from 'express';

const router = express.Router();

// ─── Importação lazy do hub (não bloqueia se COPILOT_SDK_ENABLED=false) ────────

/** @type {import('#copilot/conversation-hub/hub').ConversationHub | null} */
let _hubModule = null;

/**
 * Obtém o módulo do hub de forma lazy.
 *
 * @returns {Promise<import('#copilot/conversation-hub/hub').ConversationHub | null>}
 */
async function getHub() {
    if (process.env.COPILOT_SDK_ENABLED === 'false') return null;

    try {
        if (!_hubModule) {
            _hubModule = (await import('#copilot/conversation-hub/hub')).conversationHub;
        }
        return _hubModule;
    } catch (/** @type {any} */ err) {
        log('WARN', `[copilot-hub-router] Hub indisponível: ${err.message}`);
        return null;
    }
}

// ─── Middleware de verificação ────────────────────────────────────────────────

/**
 * Verifica se o hub está disponível e inicializado.
 *
 * @param {express.Request} req
 * @param {express.Response} res
 * @param {express.NextFunction} next
 * @returns {Promise<void>}
 */
async function requireHub(req, res, next) {
    const hub = await getHub();
    if (!hub || !hub.isReady) {
        res.status(503).json({
            error: 'ConversationHub não está disponível.',
            hint: 'Verifique COPILOT_SDK_ENABLED e COPILOT_GITHUB_TOKEN.',
        });
        return;
    }
    /** @type {any} */ (req).hub = hub;
    next();
}

// ─── GET /api/hub/status ──────────────────────────────────────────────────────

router.get('/status', async (_req, res) => {
    const hub = await getHub();
    res.json({
        ready: hub?.isReady ?? false,
        sdkEnabled: process.env.COPILOT_SDK_ENABLED !== 'false',
    });
});

// ─── GET /api/hub/sessions ────────────────────────────────────────────────────

router.get('/sessions', requireHub, (req, res) => {
    try {
        const hub = /** @type {any} */ (req).hub;
        const limit = Math.min(Number(req.query.limit) || 20, 100);
        const offset = Number(req.query.offset) || 0;
        const status = /** @type {string | undefined} */ (req.query.status);

        const sessions = hub.store.listHubSessions({ limit, offset, status: status || undefined });
        res.json({ sessions, limit, offset });
    } catch (/** @type {any} */ err) {
        log('ERROR', `[copilot-hub-router] GET /sessions: ${err.message}`);
        res.status(500).json({ error: err.message });
    }
});

// ─── POST /api/hub/sessions ───────────────────────────────────────────────────

router.post('/sessions', requireHub, (req, res) => {
    try {
        const hub = /** @type {any} */ (req).hub;
        const title = String(req.body?.title ?? '').slice(0, 200) || undefined;
        const metadata = req.body?.metadata ?? undefined;

        const hubSessionId = hub.createSession({ title, metadata });
        const session = hub.store.getHubSession(hubSessionId);

        res.status(201).json({ session });
    } catch (/** @type {any} */ err) {
        log('ERROR', `[copilot-hub-router] POST /sessions: ${err.message}`);
        res.status(500).json({ error: err.message });
    }
});

// ─── GET /api/hub/sessions/:id ────────────────────────────────────────────────

router.get('/sessions/:id', requireHub, (req, res) => {
    try {
        const hub = /** @type {any} */ (req).hub;
        const session = hub.store.getHubSession(req.params.id);

        if (!session) {
            res.status(404).json({ error: `Sessão '${req.params.id}' não encontrada.` });
            return;
        }

        res.json({ session });
    } catch (/** @type {any} */ err) {
        log('ERROR', `[copilot-hub-router] GET /sessions/:id: ${err.message}`);
        res.status(500).json({ error: err.message });
    }
});

// ─── GET /api/hub/sessions/:id/turns ─────────────────────────────────────────

router.get('/sessions/:id/turns', requireHub, (req, res) => {
    try {
        const hub = /** @type {any} */ (req).hub;
        const limit = Math.min(Number(req.query.limit) || 50, 200);
        const offset = Number(req.query.offset) || 0;
        const after = req.query.after ? Number(req.query.after) : undefined;

        const turns = hub.store.readTurns(req.params.id, { limit, offset, after });
        const total = hub.store.countTurns(req.params.id);

        res.json({ turns, total, limit, offset });
    } catch (/** @type {any} */ err) {
        log('ERROR', `[copilot-hub-router] GET /sessions/:id/turns: ${err.message}`);
        res.status(500).json({ error: err.message });
    }
});

// ─── POST /api/hub/sessions/:id/inject ───────────────────────────────────────

router.post('/sessions/:id/inject', requireHub, (req, res) => {
    try {
        const hub = /** @type {any} */ (req).hub;
        const content = String(req.body?.content ?? '').trim();

        if (!content) {
            res.status(400).json({ error: "'content' é obrigatório e não pode ser vazio." });
            return;
        }

        const session = hub.store.getHubSession(req.params.id);
        if (!session) {
            res.status(404).json({ error: `Sessão '${req.params.id}' não encontrada.` });
            return;
        }
        if (session.status !== 'active') {
            res.status(409).json({ error: `Sessão '${req.params.id}' não está ativa (${session.status}).` });
            return;
        }

        const turnId = hub.injectUserMessage(req.params.id, content, {
            metadata: { source: 'rest-api' },
        });

        res.status(201).json({ turnId, hubSessionId: req.params.id });
    } catch (/** @type {any} */ err) {
        log('ERROR', `[copilot-hub-router] POST /sessions/:id/inject: ${err.message}`);
        res.status(500).json({ error: err.message });
    }
});

// ─── POST /api/hub/sessions/:id/close ────────────────────────────────────────

router.post('/sessions/:id/close', requireHub, (req, res) => {
    try {
        const hub = /** @type {any} */ (req).hub;
        const session = hub.store.getHubSession(req.params.id);

        if (!session) {
            res.status(404).json({ error: `Sessão '${req.params.id}' não encontrada.` });
            return;
        }

        hub.orchestrator.closeSession(req.params.id);
        res.json({ closed: true, hubSessionId: req.params.id });
    } catch (/** @type {any} */ err) {
        log('ERROR', `[copilot-hub-router] POST /sessions/:id/close: ${err.message}`);
        res.status(500).json({ error: err.message });
    }
});

// ─── POST /api/hub/sessions/:id/send ─────────────────────────────────────────

/**
 * Envia mensagem de LLM-A para LLM-B e retorna a resposta (síncrono).
 *
 * Body: { message: string, useStructured?: boolean, timeoutMs?: number } Response: { turnId, content, durationMs,
 * hubSessionId, turnNumber }
 */
router.post('/sessions/:id/send', requireHub, async (req, res) => {
    try {
        const hub = /** @type {any} */ (req).hub;
        const message = String(req.body?.message ?? '').trim();
        const timeoutMs = Number(req.body?.timeoutMs) || 120_000;
        const useStructured = Boolean(req.body?.useStructured ?? false);

        if (!message) {
            res.status(400).json({ error: "'message' é obrigatório e não pode ser vazio." });
            return;
        }

        const session = hub.store.getHubSession(req.params.id);
        if (!session) {
            res.status(404).json({ error: `Sessão '${req.params.id}' não encontrada.` });
            return;
        }
        if (session.status !== 'active') {
            res.status(409).json({ error: `Sessão '${req.params.id}' não está ativa (${session.status}).` });
            return;
        }

        const result = await hub.sendToLlmB(req.params.id, message, { useStructured, timeoutMs });
        res.json(result);
    } catch (/** @type {any} */ err) {
        log('ERROR', `[copilot-hub-router] POST /sessions/:id/send: ${err.message}`);
        res.status(500).json({ error: err.message });
    }
});

// ─── GET /api/hub/sessions/:id/stream ────────────────────────────────────────

/**
 * SSE para receber eventos em tempo real de uma hub session.
 *
 * Eventos emitidos:
 *
 * - `turn:sent` — turno LLM-A enviado
 * - `turn:delta` — chunk de streaming LLM-B
 * - `turn:complete` — turno LLM-B completo
 * - `error` — erro na sessão
 * - `keepalive` — heartbeat a cada 15s
 */
router.get('/sessions/:id/stream', requireHub, (req, res) => {
    const hub = /** @type {any} */ (req).hub;

    // Verifica se a sessão existe
    const session = hub.store.getHubSession(req.params.id);
    if (!session) {
        res.status(404).json({ error: `Sessão '${req.params.id}' não encontrada.` });
        return;
    }

    // Configura SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    /**
     * @param {string} event
     * @param {object} data
     */
    const send = (event, data) => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    // Heartbeat a cada 15s para manter conexão ativa
    const keepalive = setInterval(() => {
        send('keepalive', { ts: Date.now() });
    }, 15_000);

    // Listeners de eventos do orchestrator (filtrados pela sessão)
    const sessionId = req.params.id;

    /** @param {any} evt */
    const onSent = (evt) => {
        if (evt.hubSessionId === sessionId) send('turn:sent', evt);
    };
    /** @param {any} evt */
    const onDelta = (evt) => {
        if (evt.hubSessionId === sessionId) send('turn:delta', evt);
    };
    /** @param {any} evt */
    const onComplete = (evt) => {
        if (evt.hubSessionId === sessionId) send('turn:complete', evt);
    };
    /** @param {any} evt */
    const onError = (evt) => {
        if (evt.hubSessionId === sessionId) send('error', evt);
    };

    hub.orchestrator.on('turn:sent', onSent);
    hub.orchestrator.on('turn:delta', onDelta);
    hub.orchestrator.on('turn:complete', onComplete);
    hub.orchestrator.on('error', onError);

    // Envia estado inicial
    send('connected', { hubSessionId: sessionId, ts: Date.now() });

    // Cleanup ao desconectar
    req.on('close', () => {
        clearInterval(keepalive);
        hub.orchestrator.off('turn:sent', onSent);
        hub.orchestrator.off('turn:delta', onDelta);
        hub.orchestrator.off('turn:complete', onComplete);
        hub.orchestrator.off('error', onError);
    });
});

// ─── Proxy: terminal permanente LLM-B ──────────────────────────────────────────

/**
 * POST /inject
 *
 * Proxy para o servidor de injeção do Terminal Permanente LLM-B (porta `LLM_B_TERMINAL_PORT`, padrão 3009). Permite que
 * LLM-A ou o usuário enviem mensagens ao terminal sem conhecer a porta interna.
 *
 * Body JSON: `{ "message": string, "from"?: string }` Resposta: JSON retornado pelo terminal-server, ou 503 se o
 * terminal não estiver acessível.
 */
router.post('/inject', async (req, res) => {
    const terminalPort = Number(process.env.LLM_B_TERMINAL_PORT ?? 3009);
    const injectUrl = `http://127.0.0.1:${terminalPort}/inject`;

    const body = JSON.stringify(req.body ?? {});

    try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 10_000);

        const upstream = await fetch(injectUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
            signal: ctrl.signal,
        });
        clearTimeout(timer);

        const data = await upstream.json();
        res.status(upstream.status).json(data);
    } catch (/** @type {any} */ e) {
        if (e.name === 'AbortError') {
            res.status(504).json({ ok: false, error: 'Terminal LLM-B não respondeu a tempo' });
        } else {
            res.status(503).json({ ok: false, error: 'Terminal LLM-B inacessível', detail: e.message });
        }
    }
});

export default router;
