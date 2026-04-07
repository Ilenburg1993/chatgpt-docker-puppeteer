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

import { BRIDGE_ADMIN_TOKEN as _BRIDGE_ADMIN_TOKEN, SDK_API_TOKEN as _SDK_API_TOKEN } from '#copilot/config/env';
import { getCompactionHistory } from '#copilot/observability/event-collector';
import { log } from '#copilot/observability/logger';
import { approveAll } from '@github/copilot-sdk';
import { Router } from 'express';
import { SseReplayBuffer } from '../api/sse-replay-buffer.js';
import { createEventFilter, createSseWriter, SseConnectionTracker, standardizeSsePayload } from '../api/sse-utils.js';
import {
    createClientSession as createSdkSession,
    disconnectClientSession as disconnectSdkSession,
    getClient,
    getClientSession as getSdkSession,
    incrementSessionMessageCount as incrementMessageCount,
    listActiveClientSessions as listActiveSessions,
    resumeClientSession as resumeSdkSession,
} from '../lib/sdk-client.js';
import { pickDefined } from '../lib/utils.js';

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

// C14-03: limite de SSE streams simultâneos por /sessions/:id/stream
// INC-CORE-001/INC-CHAN-001 (fix): usar MAX_SSE_CLIENTS de core/constants.js em vez de definição local
// GAP-EVARCH-01 (fix): tracker centralizado para /sessions/:id/stream
const _sessionsTracker = new SseConnectionTracker('sessions/stream');

// UPG-SE-004: buffers de replay SSE por sessão
/** @type {Map<string, SseReplayBuffer>} */
const _sessionReplayBuffers = new Map();

// C14-04: limite máximo de bytes aceitos em prompt para evitar uso excessivo de tokens
const MAX_PROMPT_BYTES = 512_000;

// SEC-N06/UPG-N19 (fix): autenticação opcional por token Bearer para SDK routes
// Configurar via variável de ambiente SDK_API_TOKEN. Endpoints são públicos se não configurado.
const SDK_API_TOKEN = _SDK_API_TOKEN;

if (SDK_API_TOKEN) {
    router.use((req, res, next) => {
        const authHeader = req.headers['authorization'] ?? '';
        if (authHeader !== `Bearer ${SDK_API_TOKEN}`) {
            return res.status(401).json({ ok: false, error: 'Unauthorized' });
        }
        return next();
    });
}

// SEC-VULN-05 (fix): rate limiting para endpoints de criação/envio de sessão.
// Limite: 10 req/min por IP para criação e 30 req/min por IP para envio.
/** @type {Map<string, { count: number; bucketStart: number }>} */
const _rlWindowMap = new Map();

/**
 * Middleware de rate limiting simples por IP (em memória, por processo).
 *
 * @param {number} maxPerMinute - Máximo de requisições por minuto
 * @param {string} label - Label para log
 * @returns {import('express').RequestHandler}
 */
function rateLimitMiddleware(maxPerMinute, label) {
    const WINDOW_MS = 60_000;
    return (req, res, next) => {
        const ip = req.ip ?? 'unknown';
        const key = `${label}:${ip}`;
        const now = Date.now();
        // BUG-RF015 (fix): purgar entradas expiradas para evitar memory leak em uptime longo
        for (const [k, e] of _rlWindowMap) {
            if (now - e.bucketStart > WINDOW_MS) _rlWindowMap.delete(k);
        }
        const entry = _rlWindowMap.get(key);
        if (!entry || now - entry.bucketStart > WINDOW_MS) {
            _rlWindowMap.set(key, { count: 1, bucketStart: now });
            return next();
        }
        entry.count += 1;
        if (entry.count > maxPerMinute) {
            return res.status(429).json({ ok: false, error: 'Too many requests. Tente novamente em 1 minuto.' });
        }
        return next();
    };
}

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
router.post('/sessions', rateLimitMiddleware(10, 'create_session'), (req, res) => {
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
            ...pickDefined({
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
            }),
        });

        res.status(201).json({
            ok: true,
            sessionId: session.sessionId,
            model: safeModel,
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
 * SEC-ROUTE-001: Middleware interno para proteger endpoints destrutivos. Exige BRIDGE_ADMIN_TOKEN se configurado
 * (defesa em profundidade sobre SDK_API_TOKEN).
 *
 * @type {import('express').RequestHandler}
 */
function _requireAdminForDestructive(req, res, next) {
    const adminToken = _BRIDGE_ADMIN_TOKEN;
    if (!adminToken) return next(); // token não configurado — comportamento legado (dev)
    const authHeader = req.headers['x-admin-token'] ?? req.headers['authorization'] ?? '';
    const provided = String(authHeader).replace(/^Bearer\s+/i, '');
    if (provided !== adminToken) {
        res.status(403).json({ ok: false, error: 'Forbidden: token admin inválido ou ausente.' });
        return;
    }
    return next();
}

/**
 * Deleta permanentemente uma sessão do disco (irreversível). Se a sessão estiver ativa no registry, desconecta antes de
 * deletar.
 */
router.delete('/sessions/:id', _requireAdminForDestructive, (req, res) => {
    void withErrorHandler(req, res, async () => {
        const id = /** @type {string} */ (req.params['id']);

        // SEC-N10 (fix): exigir confirmação explícita para operação irreversível
        const confirmHeader = req.headers['x-confirm-delete'];
        if (confirmHeader !== 'true') {
            res.status(400).json({
                ok: false,
                error: 'Operação irreversível. Adicione o header "X-Confirm-Delete: true" para confirmar.',
            });
            return;
        }

        // Desconectar do registry se ativo
        await disconnectSdkSession(id);

        const client = await getClient();
        await client.deleteSession(id);
        log('INFO', `[sdk-api] Sessão deletada: ${id}`);
        res.json({ ok: true, message: `Sessão "${id}" deletada permanentemente.` });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /sessions/:id/disconnect  (GAP-SE-007 Fase 4.3)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Desconecta uma sessão ativa sem deletá-la do disco. A sessão pode ser retomada depois via POST /sessions/:id/resume.
 * Diferente do DELETE, que remove permanentemente.
 */
router.post('/sessions/:id/disconnect', (req, res) => {
    void withErrorHandler(req, res, async () => {
        const { id } = req.params;

        const entry = getSdkSession(id);
        if (!entry) {
            res.status(404).json({
                ok: false,
                error: `Sessão "${id}" não está ativa no registry.`,
            });
            return;
        }

        await disconnectSdkSession(id);
        log('INFO', `[sdk-api] Sessão desconectada (preservada em disco): ${id}`);
        res.json({ ok: true, message: `Sessão "${id}" desconectada. Use POST /sessions/${id}/resume para retomar.` });
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
// GET /sessions/:id/compaction-history  (UPG-SE-003)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Retorna o histórico de compaction (start/complete) para uma sessão.
 */
router.get('/sessions/:id/compaction-history', (req, res) => {
    void withErrorHandler(req, res, async () => {
        const { id } = req.params;
        const history = getCompactionHistory(String(id));
        res.json({ ok: true, sessionId: id, entries: history, count: history.length });
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
router.post('/sessions/:id/send', rateLimitMiddleware(30, 'session_send'), (req, res) => {
    void withErrorHandler(req, res, async () => {
        const id = /** @type {string} */ (req.params['id']);
        const { prompt, waitForResponse = true, attachments } = req.body ?? {};
        const rawTimeoutMs = (req.body ?? {}).timeoutMs;
        // GAP-SE-001c: campo mode para steering/queueing (STREAMING-EVENTS-AUDIT Fase 2.3)
        const rawMode = (req.body ?? {}).mode;
        /** @type {'immediate' | 'enqueue' | undefined} */
        const mode = rawMode === 'immediate' || rawMode === 'enqueue' ? rawMode : undefined;
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

        // C14-04: limit máximo de bytes em prompt para evitar uso excessivo de tokens
        if (Buffer.byteLength(prompt, 'utf8') > MAX_PROMPT_BYTES) {
            res.status(400).json({ ok: false, error: `Prompt excede o limite de ${MAX_PROMPT_BYTES} bytes.` });
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
        const messageOptions = {
            prompt,
            ...(attachments ? { attachments } : {}),
            ...(mode !== undefined ? { mode } : {}),
        };

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

    // C14-03: limitar streams SSE simultâneos
    if (!_sessionsTracker.accept()) {
        res.status(503).json({ ok: false, error: 'Máximo de clientes SSE atingido' });
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

    // UPG-SE-004: buffer de replay por sessão
    if (!_sessionReplayBuffers.has(id)) {
        _sessionReplayBuffers.set(id, new SseReplayBuffer());
    }
    const replayBuffer = /** @type {SseReplayBuffer} */ (_sessionReplayBuffers.get(id));

    // GAP-EVARCH-01 (fix): usar createSseWriter para setup padronizado
    // FASE-11.4: max lifetime para evitar conexões órfãs
    const sse = createSseWriter(req, res, {
        heartbeatMs: 15_000,
        replayBuffer,
        tracker: _sessionsTracker,
        maxLifetimeMs: 24 * 60 * 60 * 1000,
    });

    sse.send('connected', { sessionId: id, timestamp: Date.now() });

    // GAP-SE-007 (STREAMING-EVENTS-AUDIT Fase 4.2): filtro de eventos via ?events= query param
    const eventFilter = createEventFilter(typeof req.query['events'] === 'string' ? req.query['events'] : undefined);

    // Registra handler no SDK para encaminhar eventos
    const unsubscribe = entry.session.on((event) => {
        const type = /** @type {string} */ (event?.type ?? '');
        if (!eventFilter || eventFilter(type)) sse.send('message', standardizeSsePayload(event));
    });

    // Limpeza quando cliente desconecta
    req.on('close', () => {
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
