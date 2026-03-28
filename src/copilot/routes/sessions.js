// @ts-check
/**
 * src/copilot/routes/sessions.js
 *
 * Rotas de gerenciamento de sessões SDK.
 *
 * Montadas em /api/sdk/* via sdk-api.js.
 *
 * Endpoints:
 *
 * - GET /sessions/active — Lista sessões ativas no registry
 * - GET /sessions/last — Retorna ID da última sessão modificada
 * - GET /sessions/foreground — Obtém sessionId em foreground
 * - PUT /sessions/foreground/:id — Define sessão em foreground
 * - GET /sessions — Lista todas as sessões (disco + memória)
 * - POST /sessions — Cria nova sessão
 * - GET /sessions/:id — Detalhes de uma sessão
 * - DELETE /sessions/:id — Deleta sessão do disco (irreversível)
 * - POST /sessions/:id/resume — Retoma sessão existente
 * - POST /sessions/:id/disconnect — Desconecta sessão ativa
 * - POST /sessions/:id/send — Envia mensagem (sync ou async)
 * - GET /sessions/:id/stream — SSE stream de eventos da sessão
 * - POST /sessions/:id/model — Altera modelo da sessão ativa
 * - POST /sessions/:id/abort — Aborta processamento em andamento
 * - GET /sessions/:id/messages — Lista histórico de mensagens
 *
 * @module copilot/routes/sessions
 */

import { log } from '#core/logger';
import { approveAll } from '@github/copilot-sdk';
import { Router } from 'express';
import {
    createClientSession as createSdkSession,
    disconnectClientSession as disconnectSdkSession,
    getClient,
    getClientSession as getSdkSession,
    incrementSessionMessageCount as incrementMessageCount,
    listActiveClientSessions as listActiveSessions,
    resumeClientSession as resumeSdkSession,
} from '../lib/client.js';

/**
 * @typedef {import('express').Request} Req
 *
 * @typedef {import('express').Response} Res
 *
 * @typedef {import('@github/copilot-sdk').SessionMetadata} SessionMetadata
 *
 * @typedef {import('@github/copilot-sdk').SessionListFilter} SessionListFilter
 */

const router = Router();

// SEC-N05/N06 (fix): validação de model — prevenir injeção e garantir formato kosher
const MODEL_SAFE_RE = /^[a-zA-Z0-9]([a-zA-Z0-9._-]{0,99})$/;

/**
 * Valida e sanitiza o campo `model` recebido do body HTTP. Retorna o model normalizado (trim) ou null se inválido.
 *
 * @param {unknown} model
 * @returns {{ ok: true; model: string } | { ok: false; error: string }}
 */
function validateModel(model) {
    if (!model || typeof model !== 'string') {
        return { ok: false, error: 'Campo "model" (string) é obrigatório.' };
    }
    const trimmed = model.trim();
    if (!MODEL_SAFE_RE.test(trimmed)) {
        return { ok: false, error: 'Campo "model" contém caracteres inválidos ou formato não permitido.' };
    }
    return { ok: true, model: trimmed };
}

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
        log('ERROR', `[sdk-api/sessions] ${req.method} ${req.path} → ${e.message}`);
        if (!res.headersSent) {
            res.status(500).json({ ok: false, error: e.message });
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /sessions/active  +  GET /sessions/last
// (devem aparecer ANTES de /sessions/:id para não serem capturadas pelo parâmetro)
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

/**
 * Retorna o ID da última sessão criada ou modificada (via CopilotClient.getLastSessionId).
 */
router.get('/sessions/last', (req, res) => {
    void withErrorHandler(req, res, async () => {
        const client = await getClient();
        const sessionId = await client.getLastSessionId();
        res.json({ ok: true, lastSessionId: sessionId ?? null });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /sessions/foreground  +  PUT /sessions/foreground/:id
// (devem aparecer ANTES de /sessions/:id para não serem capturadas pelo parâmetro)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Retorna o sessionId da sessão atualmente em foreground no CopilotClient.
 */
router.get('/sessions/foreground', (req, res) => {
    void withErrorHandler(req, res, async () => {
        const client = await getClient();
        const sessionId = await client.getForegroundSessionId();
        res.json({ ok: true, foregroundSessionId: sessionId ?? null });
    });
});

/**
 * Define qual sessão está em foreground no CopilotClient (a sessão que o CLI prioriza).
 */
router.put('/sessions/foreground/:id', (req, res) => {
    void withErrorHandler(req, res, async () => {
        const { id } = req.params;
        const client = await getClient();
        await client.setForegroundSessionId(id);
        log('INFO', `[sdk-api] foreground session definida: ${id}`);
        res.json({ ok: true, foregroundSessionId: id });
    });
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
 *     "reasoningEffort": "high", // opcional — "low" | "medium" | "high" | "xhigh"
 *     "availableTools": ["read_file"], // opcional — whitelist de tools
 *     "excludedTools": ["run_in_terminal"], // opcional — blacklist de tools
 *     "customAgents": [], // opcional — agentes customizados
 *     "clientName": "my-app", // opcional — identificador no User-Agent
 *     "provider": { "type": "openai", "baseUrl": "..." } // opcional — BYOK
 * }
 * ```
 */
router.post('/sessions', (req, res) => {
    void withErrorHandler(req, res, async () => {
        const {
            model,
            sessionId,
            systemMessage,
            infiniteSessions,
            workingDirectory,
            streaming,
            provider,
            reasoningEffort,
            availableTools,
            excludedTools,
            customAgents,
            clientName,
        } = req.body ?? {};

        const modelResult = validateModel(model);
        if (!modelResult.ok) {
            res.status(400).json({ ok: false, error: modelResult.error });
            return;
        }
        const safeModel = modelResult.model;

        const session = await createSdkSession({
            onPermissionRequest: approveAll,
            model: safeModel,
            ...(sessionId ? { sessionId } : {}),
            ...(systemMessage ? { systemMessage } : {}),
            ...(infiniteSessions !== undefined ? { infiniteSessions } : {}),
            ...(workingDirectory ? { workingDirectory } : {}),
            ...(streaming !== undefined ? { streaming } : {}),
            ...(provider ? { provider } : {}),
            ...(reasoningEffort ? { reasoningEffort } : {}),
            ...(availableTools ? { availableTools } : {}),
            ...(excludedTools ? { excludedTools } : {}),
            ...(customAgents ? { customAgents } : {}),
            ...(clientName ? { clientName } : {}),
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

        const session = await resumeSdkSession(
            id,
            model ? { onPermissionRequest: approveAll, model } : { onPermissionRequest: approveAll },
        );
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
        const { prompt, waitForResponse = true, attachments } = req.body ?? {};
        const rawTimeoutMs = (req.body ?? {}).timeoutMs;
        // NEW-03 (fix): validar timeoutMs para evitar NaN / Infinity / negativo no setTimeout
        const timeoutMs =
            rawTimeoutMs === undefined
                ? 60_000
                : typeof rawTimeoutMs === 'number' && isFinite(rawTimeoutMs) && rawTimeoutMs > 0
                  ? rawTimeoutMs
                  : null;

        if (timeoutMs === null) {
            res.status(400).json({ ok: false, error: 'Campo "timeoutMs" deve ser um número positivo finito.' });
            return;
        }

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

// ─────────────────────────────────────────────────────────────────────────────
// POST /sessions/:id/model
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Muda o modelo de uma sessão ativa em tempo real via CopilotSession.setModel().
 *
 * Body: { "model": "claude-sonnet-4-5" }
 */
router.post('/sessions/:id/model', (req, res) => {
    void withErrorHandler(req, res, async () => {
        const { id } = req.params;
        const { model } = req.body ?? {};
        const modelValidation = validateModel(model);
        if (!modelValidation.ok) {
            res.status(400).json({ ok: false, error: modelValidation.error });
            return;
        }
        const safeModel = modelValidation.model;
        const entry = getSdkSession(id);
        if (!entry) {
            res.status(404).json({
                ok: false,
                error: `Sessão "${id}" não está ativa. Use POST /api/sdk/sessions/${id}/resume primeiro.`,
            });
            return;
        }
        await entry.session.setModel(safeModel);
        log('INFO', `[sdk-api] modelo alterado: sessão ${id} → ${safeModel}`);
        res.json({ ok: true, sessionId: id, model: safeModel });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /sessions/:id/abort
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Aborta o processamento em andamento de uma sessão ativa. O modelo para de gerar tokens; a sessão permanece ativa e
 * pode receber novos prompts.
 */
router.post('/sessions/:id/abort', (req, res) => {
    void withErrorHandler(req, res, async () => {
        const { id } = req.params;
        const entry = getSdkSession(id);
        if (!entry) {
            res.status(404).json({
                ok: false,
                error: `Sessão "${id}" não está ativa. Use POST /api/sdk/sessions/${id}/resume primeiro.`,
            });
            return;
        }
        await entry.session.abort();
        log('INFO', `[sdk-api] abort solicitado: sessão ${id}`);
        res.json({ ok: true, sessionId: id, message: 'Processamento abortado.' });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /sessions/:id/messages
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Retorna o histórico completo de mensagens (eventos) armazenado na sessão.
 *
 * @example
 *     GET /api/sdk/sessions/my-session/messages
 *     → { ok: true, sessionId: "my-session", count: 12, messages: [...] }
 */
router.get('/sessions/:id/messages', (req, res) => {
    void withErrorHandler(req, res, async () => {
        const { id } = req.params;
        const entry = getSdkSession(id);
        if (!entry) {
            res.status(404).json({
                ok: false,
                error: `Sessão "${id}" não está ativa. Use POST /api/sdk/sessions/${id}/resume primeiro.`,
            });
            return;
        }
        const messages = await entry.session.getMessages();
        res.json({ ok: true, sessionId: id, count: messages.length, messages });
    });
});

export default router;
