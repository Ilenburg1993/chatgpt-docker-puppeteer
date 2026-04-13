// @ts-check
/**
 * src/copilot/api/express/session-messaging.js
 *
 * Rotas de messaging e streaming de sessões SDK: send, stream, model, abort, messages.
 *
 * @module copilot/api/express/session-messaging
 * @see EventBus
 */

import { log } from '#copilot/observability';
import { createSessionService } from '#copilot/services';
import { Router } from 'express';
import { SseReplayBuffer } from '../../server/sse/replay-buffer.js';
import {
    createEventFilter,
    createSseWriter,
    SseConnectionTracker,
    standardizeSsePayload,
} from '../../server/sse/utils.js';
import {
    rateLimitMiddleware,
    SendMessageBodySchema,
    SetModelBodySchema,
    validateBody,
    validateModel,
    withErrorHandler,
} from './session-middleware.js';

const sessionService = createSessionService();

/**
 * @typedef {import('express').Request} Req
 *
 * @typedef {import('express').Response} Res
 */

const router = Router();

// C14-03: limite de SSE streams simultâneos por /sessions/:id/stream
const _sessionsTracker = new SseConnectionTracker('sessions/stream');

// UPG-SE-004: buffers de replay SSE por sessão
/** @type {Map<string, SseReplayBuffer>} */
const _sessionReplayBuffers = new Map();

// C14-04: limite máximo de bytes aceitos em prompt para evitar uso excessivo de tokens
const MAX_PROMPT_BYTES = 512_000;

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
router.post(
    '/sessions/:id/send',
    rateLimitMiddleware(30, 'session_send'),
    validateBody(SendMessageBodySchema),
    (req, res) => {
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

            const entry = sessionService.getSession(id);
            if (!entry) {
                res.status(404).json({
                    ok: false,
                    error: `Sessão "${id}" não está ativa. Use POST /api/sdk/sessions/${id}/resume primeiro.`,
                });
                return;
            }

            sessionService.incrementMessageCount(id);

            /** @type {import('#copilot/sdk/types').MessageOptions} */
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
                const assistantEvent = /** @type {import('#copilot/sdk/types').AssistantMessageEvent | undefined} */ (
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
    },
);

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

    const entry = sessionService.getSession(id);
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
    const unsubscribe = entry.session.on((/** @type {any} */ event) => {
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
router.post('/sessions/:id/model', validateBody(SetModelBodySchema), (req, res) => {
    void withErrorHandler(req, res, async () => {
        const id = /** @type {string} */ (req.params.id);
        const { model } = req.body ?? {};
        const modelValidation = validateModel(model);
        if (!modelValidation.ok) {
            res.status(400).json({ ok: false, error: modelValidation.error });
            return;
        }
        const safeModel = modelValidation.model;
        const entry = sessionService.getSession(id);
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
 * Aborta o processamento em andamento de uma sessão ativa.
 */
router.post('/sessions/:id/abort', (req, res) => {
    void withErrorHandler(req, res, async () => {
        const { id } = req.params;
        const entry = sessionService.getSession(id);
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
 */
router.get('/sessions/:id/messages', (req, res) => {
    void withErrorHandler(req, res, async () => {
        const { id } = req.params;
        const entry = sessionService.getSession(id);
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
