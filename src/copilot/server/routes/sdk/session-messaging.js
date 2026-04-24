// @ts-check
/**
 * src/copilot/server/routes/sdk/session-messaging.js
 *
 * Rotas de messaging e streaming de sessões SDK: send, stream, model, abort, messages.
 *
 * @module copilot/server/routes/sdk/session-messaging
 * @see EventBus
 */

import { LLM_B_TURN_TIMEOUT_MS } from '#copilot/config';
import { Router } from 'express';
import { SseReplayBuffer } from '../../../infra/sse/replay-buffer.js';
import { SseClientPool } from '../../../infra/sse/stream-hub.js';
import {
    createEventFilter,
    createSseWriter,
    SseConnectionTracker,
    standardizeSsePayload,
} from '../../../infra/sse/utils.js';
import { resolveOptionalDialogTimeout } from '../../../presentation/dialog-timeout-policy.js';
import { resolveSdkRouteSharedDeps } from './deps.js';
import {
    LogMessageBodySchema,
    rateLimitMiddleware,
    SendMessageBodySchema,
    SetModelBodySchema,
    validateBody,
    validateModel,
    withErrorHandler,
} from './session-middleware.js';

/**
 * @typedef {import('express').Request} Req
 *
 * @typedef {import('express').Response} Res
 *
 * @typedef {ReturnType<typeof resolveSdkRouteSharedDeps>} SdkRouteDeps
 */

const router = Router();

// C14-03: limite de SSE streams simultâneos por /sessions/:id/stream
const _sessionsTracker = new SseConnectionTracker('sessions/stream');

/**
 * @typedef {{
 *     sessionId: string;
 *     sessionRef: NonNullable<ReturnType<SdkRouteDeps['sdkSession']['getClientSession']>>['session'];
 *     pool: SseClientPool;
 *     unsubscribe: () => void;
 * }} SessionStreamState
 */

/** @type {Map<string, SessionStreamState>} */
const _sessionStreamStates = new Map();

// C14-04: limite máximo de bytes aceitos em prompt para evitar uso excessivo de tokens
const MAX_PROMPT_BYTES = 512_000;

/**
 * @param {SdkRouteDeps} routeDeps
 * @param {string} id
 * @param {ReturnType<SdkRouteDeps['sdkSession']['getClientSession']>} entry
 * @returns {SessionStreamState}
 */
function ensureSessionStreamState(routeDeps, id, entry) {
    if (!entry) {
        throw new Error(`Sessão "${id}" não está ativa para stream SSE.`);
    }
    const existing = _sessionStreamStates.get(id);
    if (existing && existing.sessionRef === entry.session) return existing;

    if (existing) {
        existing.pool.closeAll();
        existing.unsubscribe();
        _sessionStreamStates.delete(id);
    }

    const pool = new SseClientPool(new SseReplayBuffer(), {
        name: `sdk.session.stream.${id}`,
        metrics: routeDeps.metrics,
    });

    const unsubscribe = entry.session.on((/** @type {import('@github/copilot-sdk').SessionEvent} */ event) => {
        const type = /** @type {string} */ (event?.type ?? 'message');
        const payload = standardizeSsePayload(event);
        pool.broadcast('message', payload, { replayEvent: 'message', filterEvent: type });
    });

    const state = { sessionId: id, sessionRef: entry.session, pool, unsubscribe };
    _sessionStreamStates.set(id, state);
    return state;
}

/**
 * @param {SdkRouteDeps} routeDeps
 * @param {SessionStreamState} state
 * @returns {void}
 */
function maybeDisposeSessionStreamState(routeDeps, state) {
    if (state.pool.size > 0) return;
    state.unsubscribe();
    _sessionStreamStates.delete(state.sessionId);
    routeDeps.sdkObservability.log('INFO', `[sdk-api] SSE stream encerrado: sessão ${state.sessionId}`);
}

/**
 * @param {NonNullable<ReturnType<SdkRouteDeps['sdkSession']['getClientSession']>>['session']} session
 * @param {import('#copilot/sdk/types').MessageOptions} messageOptions
 * @returns {Promise<import('@github/copilot-sdk').AssistantMessageEvent | undefined>}
 */
async function sendAndWaitWithoutTimeout(session, messageOptions) {
    /** @type {import('@github/copilot-sdk').AssistantMessageEvent | undefined} */
    let lastAssistantMessage;

    /** @type {() => void} */
    let resolveIdle = () => {};
    /** @type {(error: Error) => void} */
    let rejectIdle = () => {};

    const idlePromise = new Promise((resolve, reject) => {
        resolveIdle = () => resolve(undefined);
        rejectIdle = (error) => reject(error);
    });

    const unsubscribe = session.on((/** @type {import('@github/copilot-sdk').SessionEvent} */ event) => {
        if (event.type === 'assistant.message') {
            lastAssistantMessage = event;
        } else if (event.type === 'session.idle') {
            resolveIdle();
        } else if (event.type === 'session.error') {
            const error = new Error(event.data.message);
            if (event.data.stack) error.stack = event.data.stack;
            rejectIdle(error);
        }
    });

    try {
        await session.send(messageOptions);
        await idlePromise;
        return lastAssistantMessage;
    } finally {
        unsubscribe();
    }
}

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
 *     "timeoutMs": 0, // 0 = sem timeout; omitido = adaptativo
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
            const routeDeps = resolveSdkRouteSharedDeps(req);
            const id = /** @type {string} */ (req.params['id']);
            const { prompt, waitForResponse = true, attachments } = req.body ?? {};
            const rawTimeoutMs = (req.body ?? {}).timeoutMs;
            // GAP-SE-001c: campo mode para steering/queueing (STREAMING-EVENTS-AUDIT Fase 2.3)
            const rawMode = (req.body ?? {}).mode;
            /** @type {'immediate' | 'enqueue' | undefined} */
            const mode = rawMode === 'immediate' || rawMode === 'enqueue' ? rawMode : undefined;

            if (
                rawTimeoutMs !== undefined &&
                (typeof rawTimeoutMs !== 'number' || !Number.isFinite(rawTimeoutMs) || rawTimeoutMs < 0)
            ) {
                res.status(400).json({
                    ok: false,
                    error: 'Campo "timeoutMs" deve ser um número finito maior ou igual a zero.',
                });
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

            const timeoutDecision = resolveOptionalDialogTimeout({
                explicitTimeoutMs: rawTimeoutMs,
                defaultTimeoutMs: LLM_B_TURN_TIMEOUT_MS,
                payloadChars: prompt.length,
                phase: 'dialog',
                allowDisabled: true,
            });

            const entry = routeDeps.sdkSession.getClientSession(id);
            if (!entry) {
                res.status(404).json({
                    ok: false,
                    error: `Sessão "${id}" não está ativa. Use POST /api/sdk/sessions/${id}/resume primeiro.`,
                });
                return;
            }

            routeDeps.sdkSession.incrementSessionMessageCount(id);

            /** @type {import('#copilot/sdk/types').MessageOptions} */
            const messageOptions = {
                prompt,
                ...(attachments ? { attachments } : {}),
                ...(mode !== undefined ? { mode } : {}),
            };

            if (waitForResponse) {
                const event =
                    timeoutDecision.timeoutMs !== null
                        ? await entry.session.sendAndWait(messageOptions, timeoutDecision.timeoutMs)
                        : await sendAndWaitWithoutTimeout(entry.session, messageOptions);
                routeDeps.sdkObservability.log(
                    'INFO',
                    `[sdk-api] session.send timeout=${timeoutDecision.timeoutMs ?? 'disabled'} strategy=${timeoutDecision.strategy} reasons=${timeoutDecision.reasons.join('+')} session=${id}`,
                );
                const assistantEvent = /** @type {{ data?: { content?: string; messageId?: string } } | undefined} */ (
                    event
                );
                res.json(
                    routeDeps.sdkSessionOwnership.attachSdkSessionOwnership(
                        {
                            ok: true,
                            sessionId: id,
                            content: assistantEvent?.data?.content ?? null,
                            messageId: assistantEvent?.data?.messageId ?? null,
                            timeoutPolicy: {
                                timeoutMs: timeoutDecision.timeoutMs,
                                strategy: timeoutDecision.strategy,
                                reasons: timeoutDecision.reasons,
                            },
                        },
                        id,
                    ),
                );
            } else {
                const messageId = await entry.session.send(messageOptions);
                res.json(
                    routeDeps.sdkSessionOwnership.attachSdkSessionOwnership(
                        { ok: true, sessionId: id, messageId, enqueued: true },
                        id,
                    ),
                );
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
    const routeDeps = resolveSdkRouteSharedDeps(req);
    const { id } = req.params;

    // C14-03: limitar streams SSE simultâneos
    if (!_sessionsTracker.accept()) {
        res.status(503).json({ ok: false, error: 'Máximo de clientes SSE atingido' });
        return;
    }

    const entry = routeDeps.sdkSession.getClientSession(id);
    if (!entry) {
        res.status(404).json({
            ok: false,
            error: `Sessão "${id}" não está ativa. Use POST /api/sdk/sessions/${id}/resume primeiro.`,
        });
        return;
    }

    const state = ensureSessionStreamState(routeDeps, id, entry);

    // GAP-EVARCH-01 (fix): usar createSseWriter para setup padronizado
    // FASE-11.4: max lifetime para evitar conexões órfãs
    const sse = createSseWriter(req, res, {
        heartbeatMs: 15_000,
        replayBuffer: state.pool.replayBuffer,
        tracker: _sessionsTracker,
        maxLifetimeMs: 24 * 60 * 60 * 1000,
    });

    sse.send(
        'connected',
        routeDeps.sdkSessionOwnership.attachSdkSessionOwnership({ sessionId: id, timestamp: Date.now() }, id),
        { skipBuffer: true },
    );

    // GAP-SE-007 (STREAMING-EVENTS-AUDIT Fase 4.2): filtro de eventos via ?events= query param
    const eventFilter = createEventFilter(typeof req.query['events'] === 'string' ? req.query['events'] : undefined);

    const sseClient = state.pool.addClient(sse, { filter: eventFilter });

    // Limpeza quando cliente desconecta
    req.on('close', () => {
        state.pool.removeClient(sseClient);
        maybeDisposeSessionStreamState(routeDeps, state);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /sessions/:id/model
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Muda o modelo de uma sessão ativa em tempo real via CopilotSession.setModel().
 *
 * Body: { "model": "claude-sonnet-4-5", "reasoningEffort": "high" }
 */
router.post('/sessions/:id/model', validateBody(SetModelBodySchema), (req, res) => {
    void withErrorHandler(req, res, async () => {
        const routeDeps = resolveSdkRouteSharedDeps(req);
        const id = /** @type {string} */ (req.params['id']);
        const { model, reasoningEffort } = req.body ?? {};
        const modelValidation = validateModel(model);
        if (!modelValidation.ok) {
            res.status(400).json({ ok: false, error: modelValidation.error });
            return;
        }
        const safeModel = modelValidation.model;
        const entry = routeDeps.sdkSession.getClientSession(id);
        if (!entry) {
            res.status(404).json({
                ok: false,
                error: `Sessão "${id}" não está ativa. Use POST /api/sdk/sessions/${id}/resume primeiro.`,
            });
            return;
        }
        await entry.session.setModel(safeModel, routeDeps.sdkSession.pickDefined({ reasoningEffort }));
        routeDeps.sdkObservability.log('INFO', `[sdk-api] modelo alterado: sessão ${id} → ${safeModel}`);
        res.json(
            routeDeps.sdkSessionOwnership.attachSdkSessionOwnership(
                { ok: true, sessionId: id, model: safeModel, reasoningEffort: reasoningEffort ?? null },
                id,
            ),
        );
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /sessions/:id/log
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Emite uma mensagem no timeline da sessão via CopilotSession.log().
 */
router.post('/sessions/:id/log', validateBody(LogMessageBodySchema), (req, res) => {
    void withErrorHandler(req, res, async () => {
        const routeDeps = resolveSdkRouteSharedDeps(req);
        const id = /** @type {string} */ (req.params['id']);
        const { message, level, ephemeral } = req.body ?? {};
        const entry = routeDeps.sdkSession.getClientSession(id);
        if (!entry) {
            res.status(404).json({
                ok: false,
                error: `Sessão "${id}" não está ativa. Use POST /api/sdk/sessions/${id}/resume primeiro.`,
            });
            return;
        }
        await entry.session.log(message, routeDeps.sdkSession.pickDefined({ level, ephemeral }));
        res.json(
            routeDeps.sdkSessionOwnership.attachSdkSessionOwnership(
                { ok: true, sessionId: id, message: 'Log emitido na timeline da sessão.' },
                id,
            ),
        );
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
        const routeDeps = resolveSdkRouteSharedDeps(req);
        const { id } = req.params;
        const entry = routeDeps.sdkSession.getClientSession(id);
        if (!entry) {
            res.status(404).json({
                ok: false,
                error: `Sessão "${id}" não está ativa. Use POST /api/sdk/sessions/${id}/resume primeiro.`,
            });
            return;
        }
        await entry.session.abort();
        routeDeps.sdkObservability.log('INFO', `[sdk-api] abort solicitado: sessão ${id}`);
        res.json(
            routeDeps.sdkSessionOwnership.attachSdkSessionOwnership(
                { ok: true, sessionId: id, message: 'Processamento abortado.' },
                id,
            ),
        );
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
        const routeDeps = resolveSdkRouteSharedDeps(req);
        const { id } = req.params;
        const entry = routeDeps.sdkSession.getClientSession(id);
        if (!entry) {
            res.status(404).json({
                ok: false,
                error: `Sessão "${id}" não está ativa. Use POST /api/sdk/sessions/${id}/resume primeiro.`,
            });
            return;
        }
        const messages = await entry.session.getMessages();
        res.json(
            routeDeps.sdkSessionOwnership.attachSdkSessionOwnership(
                { ok: true, sessionId: id, count: messages.length, messages },
                id,
            ),
        );
    });
});

export default router;
