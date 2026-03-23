// @ts-check
/**
 * src/copilot/sdk-api.js
 *
 * SDK API — rota Express que expõe as capacidades completas do GitHub Copilot SDK via REST.
 *
 * Montada em /api/sdk/* pelo router principal (quando COPILOT_SDK_ENABLED=true).
 *
 * Endpoints disponíveis: GET /api/sdk/ping — Ping ao CLI server GET /api/sdk/status — Estado da conexão + versão GET
 * /api/sdk/auth — Status de autenticação GitHub GET /api/sdk/models — Lista modelos disponíveis
 *
 * GET /api/sdk/sessions — Lista todas as sessões (disco + memória) POST /api/sdk/sessions — Cria nova sessão GET
 * /api/sdk/sessions/active — Lista sessões ativas no registry GET /api/sdk/sessions/:id — Detalhes de uma sessão DELETE
 * /api/sdk/sessions/:id — Deleta sessão do disco (irreversível) POST /api/sdk/sessions/:id/resume — Retoma sessão
 * existente POST /api/sdk/sessions/:id/disconnect — Desconecta sessão ativa POST /api/sdk/sessions/:id/send — Envia
 * mensagem (sync ou async) GET /api/sdk/sessions/:id/stream — SSE stream de eventos da sessão
 *
 * GET /api/sdk/webhooks — Lista webhooks registrados POST /api/sdk/webhooks — Registra novo webhook DELETE
 * /api/sdk/webhooks/:id — Remove webhook registrado
 *
 * @module copilot/sdk-api
 */

import { log } from '#core/logger';
import { Router } from 'express';
import { alwaysAliveAgent } from './always-alive.js';
import {
    createSdkSession,
    disconnectSdkSession,
    getClient,
    getClientState,
    getSdkSession,
    incrementMessageCount,
    listActiveSessions,
    resumeSdkSession,
    stopClient,
} from './sdk-client.js';
import { allTools } from './tools/index.js';

/**
 * @typedef {import('express').Request} Req
 *
 * @typedef {import('express').Response} Res
 *
 * @typedef {import('@github/copilot-sdk').SessionMetadata} SessionMetadata
 *
 * @typedef {import('@github/copilot-sdk').ModelInfo} ModelInfo
 *
 * @typedef {import('@github/copilot-sdk').SessionListFilter} SessionListFilter
 */

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// Funções auxiliares
// ─────────────────────────────────────────────────────────────────────────────

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
        log('ERROR', `[sdk-api] ${req.method} ${req.path} → ${e.message}`);
        if (!res.headersSent) {
            res.status(500).json({ ok: false, error: e.message });
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /ping
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ping ao CLI server para verificar conectividade.
 */
router.get('/ping', (req, res) => {
    void withErrorHandler(req, res, async () => {
        const client = await getClient();
        const result = await client.ping('sdk-api health check');
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

// ─────────────────────────────────────────────────────────────────────────────
// GET /sessions/active
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lista sessões ativas no registry em memória (sessões com conexão aberta neste processo).
 */
router.get('/sessions/active', (_req, res) => {
    const active = listActiveSessions().map(({ sessionId, model, createdAt, messagesCount }) => ({
        sessionId,
        model,
        createdAt,
        messagesCount,
        activeMs: Date.now() - createdAt,
    }));
    res.json({ ok: true, count: active.length, sessions: active });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /sessions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lista todas as sessões disponíveis no disco (via CopilotClient.listSessions).
 *
 * @example
 *     // GET /api/sdk/sessions?repository=owner/repo&branch=main
 */
router.get('/sessions', (req, res) => {
    void withErrorHandler(req, res, async () => {
        /** @type {SessionListFilter} */
        const filter = {};
        if (req.query['repository']) filter.repository = String(req.query['repository']);
        if (req.query['branch']) filter.branch = String(req.query['branch']);
        if (req.query['cwd']) filter.cwd = String(req.query['cwd']);

        const client = await getClient();
        const sessions = await client.listSessions(Object.keys(filter).length ? filter : undefined);
        const active = new Set(listActiveSessions().map((s) => s.sessionId));

        const enriched = sessions.map((s) => ({
            ...s,
            isActive: active.has(s.sessionId),
        }));
        res.json({ ok: true, count: enriched.length, sessions: enriched });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /sessions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cria uma nova sessão SDK.
 *
 * Body:
 *
 * ```json
 * {
 *     "model": "claude-sonnet-4-5", // OBRIGATÓRIO — nome do modelo
 *     "sessionId": "my-id", // opcional — ID customizado
 *     "systemMessage": { "content": "..." }, // opcional
 *     "infiniteSessions": { "enabled": true }, // opcional (padrão: habilitado)
 *     "workingDirectory": "/caminho/do/projeto", // opcional
 *     "streaming": true, // opcional — emite message_delta via SSE
 *     "provider": {
 *         // opcional — BYOK (Bring Your Own Key)
 *         "type": "openai",
 *         "baseUrl": "http://localhost:11434/v1"
 *     }
 * }
 * ```
 */
router.post('/sessions', (req, res) => {
    void withErrorHandler(req, res, async () => {
        const { model, sessionId, systemMessage, infiniteSessions, workingDirectory, streaming, provider } =
            req.body ?? {};

        if (!model || typeof model !== 'string') {
            res.status(400).json({ ok: false, error: 'Campo "model" (string) é obrigatório.' });
            return;
        }

        const session = await createSdkSession({
            model,
            ...(sessionId ? { sessionId } : {}),
            ...(systemMessage ? { systemMessage } : {}),
            ...(infiniteSessions !== undefined ? { infiniteSessions } : {}),
            ...(workingDirectory ? { workingDirectory } : {}),
            ...(streaming !== undefined ? { streaming } : {}),
            ...(provider ? { provider } : {}),
        });

        res.status(201).json({
            ok: true,
            sessionId: session.sessionId,
            model,
            workspacePath: session.workspacePath ?? null,
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /sessions/:id
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detalhes de uma sessão específica (combina metadata do disco + estado do registry).
 */
router.get('/sessions/:id', (req, res) => {
    void withErrorHandler(req, res, async () => {
        const { id } = req.params;
        const client = await getClient();

        // Busca todas as sessões no disco e filtra pela ID solicitada
        const all = await client.listSessions();
        const meta = all.find((s) => s.sessionId === id);

        const entry = getSdkSession(id);

        if (!meta && !entry) {
            res.status(404).json({ ok: false, error: `Sessão "${id}" não encontrada.` });
            return;
        }

        res.json({
            ok: true,
            sessionId: id,
            isActive: Boolean(entry),
            model: entry?.model ?? null,
            messagesCount: entry?.messagesCount ?? 0,
            activeMs: entry ? Date.now() - entry.createdAt : null,
            workspacePath: entry?.session.workspacePath ?? null,
            metadata: meta ?? null,
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /sessions/:id
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Deleta permanentemente uma sessão do disco (irreversível). Se a sessão estiver ativa no registry, desconecta antes de
 * deletar.
 */
router.delete('/sessions/:id', (req, res) => {
    void withErrorHandler(req, res, async () => {
        const { id } = req.params;

        // Desconectar do registry se ativo
        await disconnectSdkSession(id);

        const client = await getClient();
        await client.deleteSession(id);
        log('INFO', `[sdk-api] Sessão deletada: ${id}`);
        res.json({ ok: true, message: `Sessão "${id}" deletada permanentemente.` });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /sessions/:id/resume
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Retoma uma sessão existente (conecta ao histórico preservado no disco).
 *
 * Body:
 *
 * ```json
 * {
 *     "model": "gpt-4.1" // opcional — modelo para retomada
 * }
 * ```
 */
router.post('/sessions/:id/resume', (req, res) => {
    void withErrorHandler(req, res, async () => {
        const { id } = req.params;
        const { model } = req.body ?? {};

        const session = await resumeSdkSession(id, model ? { model } : {});
        res.json({
            ok: true,
            sessionId: session.sessionId,
            workspacePath: session.workspacePath ?? null,
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /sessions/:id/disconnect
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Desconecta uma sessão ativa (libera memória, preserva dados no disco para retomada).
 */
router.post('/sessions/:id/disconnect', (req, res) => {
    void withErrorHandler(req, res, async () => {
        const { id } = req.params;
        await disconnectSdkSession(id);
        res.json({ ok: true, message: `Sessão "${id}" desconectada (dados preservados no disco).` });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /sessions/:id/send
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Envia uma mensagem a uma sessão ativa (deve ter sido criada ou retomada anteriormente).
 *
 * Body:
 *
 * ```json
 * {
 *     "prompt": "Olá, qual é o status do projeto?", // OBRIGATÓRIO
 *     "waitForResponse": true, // padrão: true
 *     "timeoutMs": 60000, // padrão: 60s
 *     "attachments": [{ "type": "file", "path": "..." }] // opcional
 * }
 * ```
 *
 * Quando waitForResponse=true, aguarda a resposta completa do modelo (blocking). Quando waitForResponse=false,
 * enfileira e retorna imediatamente (messageId).
 */
router.post('/sessions/:id/send', (req, res) => {
    void withErrorHandler(req, res, async () => {
        const { id } = req.params;
        const { prompt, waitForResponse = true, timeoutMs = 60_000, attachments } = req.body ?? {};

        if (!prompt || typeof prompt !== 'string') {
            res.status(400).json({ ok: false, error: 'Campo "prompt" (string) é obrigatório.' });
            return;
        }

        const entry = getSdkSession(id);
        if (!entry) {
            res.status(404).json({
                ok: false,
                error: `Sessão "${id}" não está ativa. Use POST /api/sdk/sessions/${id}/resume primeiro.`,
            });
            return;
        }

        incrementMessageCount(id);

        /** @type {import('@github/copilot-sdk').MessageOptions} */
        const messageOptions = { prompt, ...(attachments ? { attachments } : {}) };

        if (waitForResponse) {
            const event = await Promise.race([
                entry.session.sendAndWait(messageOptions, timeoutMs),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error(`Timeout após ${timeoutMs}ms`)), timeoutMs + 5000),
                ),
            ]);
            const assistantEvent = /** @type {import('@github/copilot-sdk').AssistantMessageEvent | undefined} */ (
                event
            );
            res.json({
                ok: true,
                sessionId: id,
                content: assistantEvent?.data?.content ?? null,
                messageId: assistantEvent?.data?.messageId ?? null,
            });
        } else {
            const messageId = await entry.session.send(messageOptions);
            res.json({ ok: true, sessionId: id, messageId, enqueued: true });
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /sessions/:id/stream  (SSE)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Abre um stream SSE de eventos de uma sessão ativa.
 *
 * Eventos entregues:
 *
 * - `message` — todos os eventos do SDK (type + data JSON)
 * - `heartbeat` — keepalive a cada 15s
 *
 * @example
 *     const es = new EventSource('/api/sdk/sessions/my-id/stream');
 *     es.onmessage = (e) => {
 *         const event = JSON.parse(e.data);
 *         if (event.type === 'assistant.message') console.log(event.data.content);
 *     };
 */
router.get('/sessions/:id/stream', (req, res) => {
    const { id } = req.params;

    const entry = getSdkSession(id);
    if (!entry) {
        res.status(404).json({
            ok: false,
            error: `Sessão "${id}" não está ativa. Use POST /api/sdk/sessions/${id}/resume primeiro.`,
        });
        return;
    }

    // Configura headers SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    /**
     * Envia um evento SSE formatado.
     *
     * @param {string} eventType
     * @param {unknown} data
     */
    const sendEvent = (eventType, data) => {
        if (res.writableEnded) return;
        const payload = JSON.stringify(data);
        res.write(`event: ${eventType}\ndata: ${payload}\n\n`);
    };

    sendEvent('connected', { sessionId: id, timestamp: Date.now() });

    // Registra handler no SDK para encaminhar eventos
    const unsubscribe = entry.session.on((event) => {
        sendEvent('message', event);
    });

    // Heartbeat a cada 15s para manter a conexão aberta
    const heartbeatInterval = setInterval(() => {
        sendEvent('heartbeat', { ts: Date.now() });
    }, 15_000);

    // Limpeza quando cliente desconecta
    req.on('close', () => {
        clearInterval(heartbeatInterval);
        unsubscribe();
        log('INFO', `[sdk-api] SSE stream encerrado: sessão ${id}`);
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

// ─── Ferramentas ─────────────────────────────────────────────────────────────

/**
 * GET /tools
 *
 * Lista as ferramentas disponíveis registradas em src/copilot/tools/.
 */
router.get('/tools', (_req, res) => {
    const list = allTools.map((tool) => ({
        name: /** @type {any} */ (tool).name ?? '(unknown)',
        description: /** @type {any} */ (tool).description ?? null,
    }));
    res.json({ ok: true, count: list.length, tools: list });
});

// ─── Webhooks ──────────────────────────────────────────────────────────────

/**
 * GET /webhooks
 *
 * Lista todos os webhooks registrados no agente Always-Alive.
 */
router.get('/webhooks', (_req, res) => {
    const list = alwaysAliveAgent.listWebhooks();
    res.json({ ok: true, count: list.length, webhooks: list });
});

/**
 * POST /webhooks
 *
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
    } catch {
        res.status(400).json({ ok: false, error: 'URL inválida' });
        return;
    }

    const result = alwaysAliveAgent.registerWebhook(url);
    res.status(201).json({ ok: true, ...result });
});

/**
 * DELETE /webhooks/:id
 *
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
