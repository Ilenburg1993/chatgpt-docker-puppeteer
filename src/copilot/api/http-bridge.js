// @ts-check
/**
 * src/copilot/api/http-bridge.js
 *
 * HTTP Bridge — rota Express para expor o Always-Alive Agent via API REST.
 *
 * Rotas montadas em /api/copilot/* pelo router principal:
 *
 * GET /api/copilot/status — Status do agente + pergunta pendente POST /api/copilot/send — Envia mensagem ao agente
 * (async) POST /api/copilot/answer — Responde pergunta pendente do modelo POST /api/copilot/start — Inicia o agente (se
 * parado) POST /api/copilot/stop — Para o agente graciosamente GET /api/copilot/session — Info sobre a sessão ativa GET
 * /api/copilot/health — Health check para orquestradores e load balancers POST /api/copilot/dialog/start — Inicia
 * Dialog Loop (padrão §15.8 — 0 PR por turno) POST /api/copilot/dialog/turn — Envia turno de diálogo POST
 * /api/copilot/dialog/stop — Encerra Dialog Loop
 *
 * @module copilot/api/http-bridge
 */

import { log } from '#core/logger';
import { AGENT_EVENTS } from '#copilot/core';
import { Router } from 'express';
import { alwaysAliveAgent } from '../always-alive.js';

/**
 * @typedef {import('express').Request} Req
 *
 * @typedef {import('express').Response} Res
 *
 * @typedef {{
 *     status: string;
 *     sessionId: string | null;
 *     model: string;
 *     queueSize: number;
 *     pendingQuestion: object | null;
 *     isResumed: boolean;
 *     resumeCount: number;
 *     sendCount: number;
 *     startedAt: number | null;
 * }} AgentSnap
 */

const bridge = Router();

// ─── GET /status ──────────────────────────────────────────────────────────────

/**
 * Retorna o estado atual do agente (status, pergunta pendente, fila, etc.).
 */
bridge.get('/status', (/** @type {Req} */ _req, /** @type {Res} */ res) => {
    res.json({ ok: true, ...alwaysAliveAgent.getStatusSnapshot() });
});

// ─── GET /health ──────────────────────────────────────────────────────────────

/**
 * Health check para orquestradores, load balancers e sistemas de monitoramento.
 *
 * Status HTTP 200 quando agente está operacional (idle | processing | waiting_for_input). Status HTTP 503 quando agente
 * está parado ou sem sessão.
 *
 * Body: { healthy: boolean, status, sessionId, queueSize, starvationAlert, uptime }
 */
bridge.get('/health', (/** @type {Req} */ _req, /** @type {Res} */ res) => {
    const snap = /** @type {AgentSnap & { starvationAlert: boolean; oldestTaskWaitMs: number }} */ (
        alwaysAliveAgent.getStatusSnapshot()
    );
    const healthy = snap.status === 'idle' || snap.status === 'processing' || snap.status === 'waiting_for_input';
    const httpStatus = healthy ? 200 : 503;
    res.status(httpStatus).json({
        healthy,
        status: snap.status,
        sessionId: snap.sessionId,
        queueSize: snap.queueSize,
        starvationAlert: snap.starvationAlert,
        uptime: snap.startedAt !== null ? Date.now() - snap.startedAt : null,
    });
});

// ─── GET /session ─────────────────────────────────────────────────────────────

/**
 * Informações sobre a sessão ativa.
 */
bridge.get('/session', (/** @type {Req} */ _req, /** @type {Res} */ res) => {
    const snap = /** @type {AgentSnap} */ (alwaysAliveAgent.getStatusSnapshot());
    res.json({
        ok: true,
        sessionId: snap.sessionId,
        model: snap.model,
        isResumed: snap.isResumed,
        resumeCount: snap.resumeCount,
        sendCount: snap.sendCount,
        startedAt: snap.startedAt,
    });
});

// ─── POST /start ──────────────────────────────────────────────────────────────

/**
 * Inicia o agente (cria ou retoma sessão). Idempotente se já estiver ativo.
 */
bridge.post('/start', async (/** @type {Req} */ _req, /** @type {Res} */ res) => {
    try {
        if (alwaysAliveAgent.status !== 'stopped') {
            return res.json({ ok: true, message: 'Agente já está ativo.', status: alwaysAliveAgent.status });
        }
        await alwaysAliveAgent.start();
        return res.json({ ok: true, sessionId: alwaysAliveAgent.sessionId, status: alwaysAliveAgent.status });
    } catch (/** @type {any} */ e) {
        log('ERROR', `[http-bridge/start] ${e.message}`);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

// ─── POST /stop ───────────────────────────────────────────────────────────────

/**
 * Para o agente graciosamente (preserva estado em disco para retomada).
 */
bridge.post('/stop', async (/** @type {Req} */ _req, /** @type {Res} */ res) => {
    try {
        await alwaysAliveAgent.stop();
        return res.json({ ok: true, message: 'Agente parado.' });
    } catch (/** @type {any} */ e) {
        log('ERROR', `[http-bridge/stop] ${e.message}`);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

// ─── POST /send ───────────────────────────────────────────────────────────────

/**
 * Enfileira uma mensagem para o agente processar. Retorna imediatamente com o taskId (processamento é assíncrono).
 *
 * Body: { message: string, waitForResponse?: boolean, timeoutMs?: number }
 */
bridge.post('/send', async (/** @type {Req} */ req, /** @type {Res} */ res) => {
    const { message, waitForResponse = false, timeoutMs = 30000 } = req.body ?? {};

    if (!message || typeof message !== 'string') {
        return res.status(400).json({ ok: false, error: 'Campo "message" (string) é obrigatório.' });
    }

    if (alwaysAliveAgent.status === 'stopped') {
        return res
            .status(503)
            .json({ ok: false, error: 'Agente não está ativo. Use POST /api/copilot/start primeiro.' });
    }

    try {
        if (waitForResponse) {
            const raceResult = await Promise.race([
                alwaysAliveAgent.sendMessage(message),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error(`Timeout após ${timeoutMs}ms`)), timeoutMs),
                ),
            ]);
            return res.json({ ok: true, response: raceResult });
        }

        // Enfileira sem aguardar
        alwaysAliveAgent.sendMessage(message).catch((e) => {
            log('WARN', `[http-bridge/send] Tarefa assíncrona falhou: ${e.message}`);
        });
        return res.json({ ok: true, message: 'Mensagem enfileirada.', status: alwaysAliveAgent.status });
    } catch (/** @type {any} */ e) {
        log('ERROR', `[http-bridge/send] ${e.message}`);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

// ─── POST /answer ─────────────────────────────────────────────────────────────

/**
 * Responde à pergunta pendente do modelo.
 *
 * Body: { answer: string }
 */
bridge.post('/answer', (/** @type {Req} */ req, /** @type {Res} */ res) => {
    const { answer } = req.body ?? {};

    if (!answer || typeof answer !== 'string') {
        return res.status(400).json({ ok: false, error: 'Campo "answer" (string) é obrigatório.' });
    }

    const answered = alwaysAliveAgent.answerPendingQuestion(answer);
    if (!answered) {
        return res.status(409).json({ ok: false, error: 'Não há pergunta pendente do modelo no momento.' });
    }
    return res.json({ ok: true, message: 'Resposta enviada ao modelo.' });
});

// ─── GET /stream ──────────────────────────────────────────────────────────────

/**
 * SSE global do AlwaysAliveAgent — push de eventos em tempo real para o cliente.
 *
 * Eventos emitidos:
 *
 * - `connected` — estado inicial do agente ao conectar
 * - `task.queued` / `task.started` / `task.completed` / `task.error` / `task.delta`
 * - `question.pending` / `question.answered`
 * - `status` / `stopped` / `ready`
 * - `session.compaction_start` / `session.compaction_complete`
 * - `dialog.ready` / `dialog.reply` / `dialog.stopped` — eventos do Dialog Loop §15.8
 * - `heartbeat` — sinal a cada 15 s para manter conexão viva
 *
 * Uso: `GET /api/copilot/stream` com `Accept: text/event-stream`
 */
bridge.get('/stream', (/** @type {Req} */ req, /** @type {Res} */ res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    /**
     * Envia um evento SSE para o cliente.
     *
     * @param {string} event - Nome do evento SSE
     * @param {object} data - Dados serializados em JSON
     * @returns {void}
     */
    const sendEvt = (event, data) => {
        if (!res.writableEnded) {
            res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        }
    };

    // Evento inicial com snapshot do estado atual
    sendEvt('connected', { ...alwaysAliveAgent.getStatusSnapshot(), timestamp: Date.now() });

    /** @type {Map<string, (data: any) => void>} */
    const handlers = new Map(AGENT_EVENTS.map((evt) => [evt, (/** @type {any} */ data) => sendEvt(evt, data ?? {})]));

    handlers.forEach((handler, evt) => alwaysAliveAgent.on(evt, handler));

    const heartbeat = setInterval(() => sendEvt('heartbeat', { ts: Date.now() }), 15_000);

    req.on('close', () => {
        clearInterval(heartbeat);
        handlers.forEach((handler, evt) => alwaysAliveAgent.off(evt, handler));
    });
});

// ─── POST /dialog/start ───────────────────────────────────────────────────────

/**
 * Inicia o modo Dialog Loop — LLM-B entra em loop ask_user para comunicação direta.
 *
 * Body: { bootPrompt?: string } Returns: { ok: true, message: string }
 *
 * Padrão §15.8: todas as iterações usam o mesmo PR (sem custo por turno).
 */
bridge.post('/dialog/start', async (/** @type {Req} */ req, /** @type {Res} */ res) => {
    const { bootPrompt } = req.body ?? {};

    if (alwaysAliveAgent.status !== 'idle') {
        return res
            .status(409)
            .json({ ok: false, error: `Agente não está idle. Status: '${alwaysAliveAgent.status}'.` });
    }

    try {
        await alwaysAliveAgent.startDialogLoop(bootPrompt ?? undefined);
        return res.json({ ok: true, message: 'Modo diálogo ativo. Use POST /dialog/turn para interagir.' });
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log('ERROR', `[HttpBridge] /dialog/start falhou: ${msg}`);
        return res.status(500).json({ ok: false, error: msg });
    }
});

// ─── POST /dialog/turn ────────────────────────────────────────────────────────

/**
 * Envia um turno de diálogo para o modelo suspenso no dialog loop.
 *
 * Body: { message: string, timeout?: number } Returns: { ok: true, reply: string }
 *
 * A LLM-B está suspensa em ask_user aguardando input; esta rota fornece o input, aguarda a resposta REPLY: e a retorna.
 */
bridge.post('/dialog/turn', async (/** @type {Req} */ req, /** @type {Res} */ res) => {
    const { message, timeout = 60_000 } = req.body ?? {};

    if (!message || typeof message !== 'string') {
        return res.status(400).json({ ok: false, error: 'Campo "message" (string) é obrigatório.' });
    }
    if (typeof timeout !== 'number' || timeout < 1_000 || timeout > 300_000) {
        return res.status(400).json({ ok: false, error: '"timeout" deve ser número entre 1000 e 300000.' });
    }

    try {
        const reply = await alwaysAliveAgent.sendDialogTurn(message, { timeout });
        return res.json({ ok: true, reply });
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const status = msg.includes('não está ativo') ? 409 : msg.includes('timeout') ? 504 : 500;
        log('WARN', `[HttpBridge] /dialog/turn falhou: ${msg}`);
        return res.status(status).json({ ok: false, error: msg });
    }
});

// ─── POST /dialog/stop ────────────────────────────────────────────────────────

/**
 * Encerra o modo Dialog Loop, sinalizando STOP_DIALOG para o modelo.
 *
 * Returns: { ok: true, message: string }
 */
bridge.post('/dialog/stop', async (/** @type {Req} */ _req, /** @type {Res} */ res) => {
    try {
        await alwaysAliveAgent.stopDialogLoop();
        return res.json({ ok: true, message: 'Modo diálogo encerrado.' });
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return res.status(500).json({ ok: false, error: msg });
    }
});

export default bridge;
