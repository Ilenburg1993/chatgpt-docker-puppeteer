// @ts-check
/**
 * src/copilot/server/routes/sdk/session-messaging.js
 *
 * Rotas de messaging e streaming de sessões SDK: send, stream, model, abort, messages.
 *
 * @module copilot/server/routes/sdk/session-messaging
 * @see EventBus
 */

import { Router } from 'express';
import { createEventFilter, createSseWriter } from '../../../infra/sse/utils.js';
import {
    abortSession,
    getSessionMessages,
    sendSession,
    sendSessionAndWait,
    setSessionModel,
} from '../../../sdk/session/wrapper.js';
import { resolveSdkRouteSharedDeps } from './deps.js';
import { rateLimitMiddleware, validateBody, validateModel, withErrorHandler } from './session-middleware.js';
import { getActiveSessionEntryOrReply, withRuntimeMeta, withSessionRuntimeMeta } from './session-route-helpers.js';
import {
    ElicitationBodySchema,
    HandlePendingCommandBodySchema,
    HandlePendingToolCallBodySchema,
    LogMessageBodySchema,
    PermissionDecisionBodySchema,
    SendMessageBodySchema,
    SetModelBodySchema,
    ShellExecBodySchema,
    ShellKillBodySchema,
    UiConfirmBodySchema,
    UiInputBodySchema,
    UiSelectBodySchema,
    WorkspaceCreateFileBodySchema,
} from './session-schemas.js';
import { MAX_PROMPT_BYTES, sendAndWaitWithoutTimeout } from './session-send-helpers.js';
import { ensureSessionStreamState, maybeDisposeSessionStreamState, sessionsTracker } from './session-stream-state.js';
import { validateWorkspacePath } from './session-workspace-helpers.js';

/**
 * @typedef {import('express').Request} Req
 *
 * @typedef {import('express').Response} Res
 *
 * @typedef {ReturnType<typeof resolveSdkRouteSharedDeps>} SdkRouteDeps
 *
 * @typedef {{ prompt: string; attachments?: unknown; mode?: unknown; [key: string]: unknown }} RouteMessageOptions
 */

const router = Router();

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
                res.status(400).json(
                    withRuntimeMeta(routeDeps, {
                        ok: false,
                        error: 'Campo "timeoutMs" deve ser um número finito maior ou igual a zero.',
                    }),
                );
                return;
            }

            if (!prompt || typeof prompt !== 'string') {
                res.status(400).json(
                    withRuntimeMeta(routeDeps, { ok: false, error: 'Campo "prompt" (string) é obrigatório.' }),
                );
                return;
            }

            // C14-04: limit máximo de bytes em prompt para evitar uso excessivo de tokens
            if (Buffer.byteLength(prompt, 'utf8') > MAX_PROMPT_BYTES) {
                res.status(400).json(
                    withRuntimeMeta(routeDeps, {
                        ok: false,
                        error: `Prompt excede o limite de ${MAX_PROMPT_BYTES} bytes.`,
                    }),
                );
                return;
            }

            const timeoutDecision = routeDeps.sdkSessionPolicy.resolveOptionalDialogTimeout({
                explicitTimeoutMs: rawTimeoutMs,
                defaultTimeoutMs: routeDeps.sdkSessionPolicy.defaultDialogTimeoutMs,
                payloadChars: prompt.length,
                phase: 'dialog',
                allowDisabled: true,
            });

            const entry = getActiveSessionEntryOrReply(routeDeps, id, res);
            if (!entry) return;

            routeDeps.sdkSession.incrementSessionMessageCount(id);

            /** @type {RouteMessageOptions} */
            const messageOptions = {
                prompt,
                ...(attachments ? { attachments } : {}),
                ...(mode !== undefined ? { mode } : {}),
            };

            if (waitForResponse) {
                const event =
                    timeoutDecision.timeoutMs !== null
                        ? await sendSessionAndWait(
                              entry.session,
                              /** @type {never} */ (messageOptions),
                              timeoutDecision.timeoutMs,
                          )
                        : await sendAndWaitWithoutTimeout(routeDeps, entry.session, messageOptions);
                routeDeps.sdkObservability.log(
                    'INFO',
                    `[sdk-api] session.send timeout=${timeoutDecision.timeoutMs ?? 'disabled'} strategy=${timeoutDecision.strategy} reasons=${timeoutDecision.reasons.join('+')} session=${id}`,
                );
                const assistantEvent = /** @type {{ data?: { content?: string; messageId?: string } } | undefined} */ (
                    event
                );
                res.json(
                    withSessionRuntimeMeta(
                        routeDeps,
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
                const messageId = await sendSession(entry.session, /** @type {never} */ (messageOptions));
                res.json(withSessionRuntimeMeta(routeDeps, { ok: true, sessionId: id, messageId, enqueued: true }, id));
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
    if (!sessionsTracker.accept()) {
        res.status(503).json(withRuntimeMeta(routeDeps, { ok: false, error: 'Máximo de clientes SSE atingido' }));
        return;
    }

    const entry = getActiveSessionEntryOrReply(routeDeps, id, res);
    if (!entry) return;

    const state = ensureSessionStreamState(routeDeps, id, entry);

    // GAP-EVARCH-01 (fix): usar createSseWriter para setup padronizado
    // FASE-11.4: max lifetime para evitar conexões órfãs
    const sse = createSseWriter(req, res, {
        heartbeatMs: 15_000,
        replayBuffer: state.pool.replayBuffer,
        tracker: sessionsTracker,
        maxLifetimeMs: 24 * 60 * 60 * 1000,
    });

    sse.send('connected', withSessionRuntimeMeta(routeDeps, { sessionId: id, timestamp: Date.now() }, id), {
        skipBuffer: true,
    });

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
 * Muda o modelo de uma sessão ativa em tempo real via wrapper canônico setSessionModel().
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
            res.status(400).json(withRuntimeMeta(routeDeps, { ok: false, error: modelValidation.error }));
            return;
        }
        const safeModel = modelValidation.model;
        const entry = getActiveSessionEntryOrReply(routeDeps, id, res);
        if (!entry) return;
        await setSessionModel(entry.session, safeModel, routeDeps.sdkSession.pickDefined({ reasoningEffort }));
        routeDeps.sdkObservability.log('INFO', `[sdk-api] modelo alterado: sessão ${id} → ${safeModel}`);
        res.json(
            withSessionRuntimeMeta(
                routeDeps,
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
        const entry = getActiveSessionEntryOrReply(routeDeps, id, res);
        if (!entry) return;
        await entry.session.log(message, routeDeps.sdkSession.pickDefined({ level, ephemeral }));
        res.json(
            withSessionRuntimeMeta(
                routeDeps,
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
        const entry = getActiveSessionEntryOrReply(routeDeps, id, res);
        if (!entry) return;
        await abortSession(entry.session);
        routeDeps.sdkObservability.log('INFO', `[sdk-api] abort solicitado: sessão ${id}`);
        res.json(
            withSessionRuntimeMeta(routeDeps, { ok: true, sessionId: id, message: 'Processamento abortado.' }, id),
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
        const entry = getActiveSessionEntryOrReply(routeDeps, id, res);
        if (!entry) return;
        const messages = await getSessionMessages(entry.session);
        res.json(withSessionRuntimeMeta(routeDeps, { ok: true, sessionId: id, count: messages.length, messages }, id));
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /sessions/:id/workspace/files
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lista arquivos do workspace virtual da sessão SDK.
 */
router.get('/sessions/:id/workspace/files', (req, res) => {
    void withErrorHandler(req, res, async () => {
        const routeDeps = resolveSdkRouteSharedDeps(req);
        const id = /** @type {string} */ (req.params['id']);
        const entry = getActiveSessionEntryOrReply(routeDeps, id, res);
        if (!entry) return;
        const result = await routeDeps.sdkSessionRpc.workspaceListFiles(entry.session);
        res.json(withSessionRuntimeMeta(routeDeps, { ok: true, sessionId: id, result }, id));
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /sessions/:id/workspace/file?path=...
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lê um arquivo do workspace virtual da sessão SDK.
 */
router.get('/sessions/:id/workspace/file', (req, res) => {
    void withErrorHandler(req, res, async () => {
        const routeDeps = resolveSdkRouteSharedDeps(req);
        const id = /** @type {string} */ (req.params['id']);
        const validation = validateWorkspacePath(req.query['path']);
        if (!validation.ok) {
            res.status(400).json(withRuntimeMeta(routeDeps, { ok: false, error: validation.error }));
            return;
        }
        const entry = getActiveSessionEntryOrReply(routeDeps, id, res);
        if (!entry) return;
        const result = await routeDeps.sdkSessionRpc.workspaceReadFile(entry.session, validation.path);
        res.json(withSessionRuntimeMeta(routeDeps, { ok: true, sessionId: id, result }, id));
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /sessions/:id/workspace/file
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cria ou sobrescreve um arquivo no workspace virtual da sessão SDK.
 */
router.post('/sessions/:id/workspace/file', validateBody(WorkspaceCreateFileBodySchema), (req, res) => {
    void withErrorHandler(req, res, async () => {
        const routeDeps = resolveSdkRouteSharedDeps(req);
        const id = /** @type {string} */ (req.params['id']);
        const { path, content } = req.body ?? {};
        const validation = validateWorkspacePath(path);
        if (!validation.ok) {
            res.status(400).json(withRuntimeMeta(routeDeps, { ok: false, error: validation.error }));
            return;
        }
        const entry = getActiveSessionEntryOrReply(routeDeps, id, res);
        if (!entry) return;
        const result = await routeDeps.sdkSessionRpc.workspaceCreateFile(entry.session, validation.path, content);
        res.json(withSessionRuntimeMeta(routeDeps, { ok: true, sessionId: id, result }, id));
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /sessions/:id/ui/elicitation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Expõe as capabilities atuais de `session.ui` para o caller HTTP.
 */
router.get('/sessions/:id/ui/capabilities', (req, res) => {
    void withErrorHandler(req, res, async () => {
        const routeDeps = resolveSdkRouteSharedDeps(req);
        const id = /** @type {string} */ (req.params['id']);
        const entry = getActiveSessionEntryOrReply(routeDeps, id, res);
        if (!entry) return;
        const capabilities = routeDeps.sdkSessionUi.getSessionCapabilities(entry.session);
        const available = routeDeps.sdkSessionUi.isSessionUiElicitationAvailable(entry.session);
        res.json(
            withSessionRuntimeMeta(
                routeDeps,
                { ok: true, sessionId: id, capabilities, elicitationAvailable: available },
                id,
            ),
        );
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /sessions/:id/ui/elicitation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Aciona a operação de UI elicitation via façade `session.ui` para formulários estruturados.
 */
router.post('/sessions/:id/ui/elicitation', validateBody(ElicitationBodySchema), (req, res) => {
    void withErrorHandler(req, res, async () => {
        const routeDeps = resolveSdkRouteSharedDeps(req);
        const id = /** @type {string} */ (req.params['id']);
        const { message, requestedSchema } = req.body ?? {};
        const entry = getActiveSessionEntryOrReply(routeDeps, id, res);
        if (!entry) return;
        const result = await routeDeps.sdkSessionUi.sessionUiElicitation(entry.session, { message, requestedSchema });
        res.json(withSessionRuntimeMeta(routeDeps, { ok: true, sessionId: id, result }, id));
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /sessions/:id/ui/confirm
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Executa `session.ui.confirm()` ou fallback compatível.
 */
router.post('/sessions/:id/ui/confirm', validateBody(UiConfirmBodySchema), (req, res) => {
    void withErrorHandler(req, res, async () => {
        const routeDeps = resolveSdkRouteSharedDeps(req);
        const id = /** @type {string} */ (req.params['id']);
        const { message } = req.body ?? {};
        const entry = getActiveSessionEntryOrReply(routeDeps, id, res);
        if (!entry) return;
        const result = await routeDeps.sdkSessionUi.sessionUiConfirm(entry.session, message);
        res.json(withSessionRuntimeMeta(routeDeps, { ok: true, sessionId: id, result }, id));
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /sessions/:id/ui/select
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Executa `session.ui.select()` ou fallback compatível.
 */
router.post('/sessions/:id/ui/select', validateBody(UiSelectBodySchema), (req, res) => {
    void withErrorHandler(req, res, async () => {
        const routeDeps = resolveSdkRouteSharedDeps(req);
        const id = /** @type {string} */ (req.params['id']);
        const { message, options } = req.body ?? {};
        const entry = getActiveSessionEntryOrReply(routeDeps, id, res);
        if (!entry) return;
        const result = await routeDeps.sdkSessionUi.sessionUiSelect(entry.session, message, options);
        res.json(withSessionRuntimeMeta(routeDeps, { ok: true, sessionId: id, result }, id));
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /sessions/:id/ui/input
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Executa `session.ui.input()` ou fallback compatível.
 */
router.post('/sessions/:id/ui/input', validateBody(UiInputBodySchema), (req, res) => {
    void withErrorHandler(req, res, async () => {
        const routeDeps = resolveSdkRouteSharedDeps(req);
        const id = /** @type {string} */ (req.params['id']);
        const { message, options } = req.body ?? {};
        const entry = getActiveSessionEntryOrReply(routeDeps, id, res);
        if (!entry) return;
        const result = await routeDeps.sdkSessionUi.sessionUiInput(entry.session, message, options);
        res.json(withSessionRuntimeMeta(routeDeps, { ok: true, sessionId: id, result }, id));
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /sessions/:id/permissions/:requestId
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve uma permissão pendente usando o contrato SDK `permissions.handlePendingPermissionRequest`.
 */
router.post('/sessions/:id/permissions/:requestId', validateBody(PermissionDecisionBodySchema), (req, res) => {
    void withErrorHandler(req, res, async () => {
        const routeDeps = resolveSdkRouteSharedDeps(req);
        const id = /** @type {string} */ (req.params['id']);
        const requestId = /** @type {string} */ (req.params['requestId']);
        const entry = getActiveSessionEntryOrReply(routeDeps, id, res);
        if (!entry) return;
        const result = await routeDeps.sdkSessionRpc.permissionsHandlePending(
            entry.session,
            requestId,
            req.body.result,
        );
        res.json(withSessionRuntimeMeta(routeDeps, { ok: true, sessionId: id, result }, id));
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /sessions/:id/tools/:requestId
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve uma chamada externa de tool pendente.
 */
router.post('/sessions/:id/tools/:requestId', validateBody(HandlePendingToolCallBodySchema), (req, res) => {
    void withErrorHandler(req, res, async () => {
        const routeDeps = resolveSdkRouteSharedDeps(req);
        const id = /** @type {string} */ (req.params['id']);
        const requestId = /** @type {string} */ (req.params['requestId']);
        const entry = getActiveSessionEntryOrReply(routeDeps, id, res);
        if (!entry) return;
        const result = await routeDeps.sdkSessionRpc.toolsHandlePendingCall(entry.session, requestId, req.body);
        res.json(withSessionRuntimeMeta(routeDeps, { ok: true, sessionId: id, result }, id));
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /sessions/:id/commands/:requestId
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve um comando SDK pendente.
 */
router.post('/sessions/:id/commands/:requestId', validateBody(HandlePendingCommandBodySchema), (req, res) => {
    void withErrorHandler(req, res, async () => {
        const routeDeps = resolveSdkRouteSharedDeps(req);
        const id = /** @type {string} */ (req.params['id']);
        const requestId = /** @type {string} */ (req.params['requestId']);
        const entry = getActiveSessionEntryOrReply(routeDeps, id, res);
        if (!entry) return;
        const result = await routeDeps.sdkSessionRpc.commandsHandlePending(entry.session, requestId, req.body);
        res.json(withSessionRuntimeMeta(routeDeps, { ok: true, sessionId: id, result }, id));
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /sessions/:id/compaction/compact
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Aciona compaction manual da sessão infinita via RPC SDK.
 */
router.post('/sessions/:id/compaction/compact', (req, res) => {
    void withErrorHandler(req, res, async () => {
        const routeDeps = resolveSdkRouteSharedDeps(req);
        const id = /** @type {string} */ (req.params['id']);
        const entry = getActiveSessionEntryOrReply(routeDeps, id, res);
        if (!entry) return;
        const result = await routeDeps.sdkSessionRpc.compactionCompact(entry.session);
        res.json(withSessionRuntimeMeta(routeDeps, { ok: true, sessionId: id, result }, id));
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /sessions/:id/shell/exec
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Executa shell remoto pelo runtime SDK e retorna `processId`.
 */
router.post('/sessions/:id/shell/exec', validateBody(ShellExecBodySchema), (req, res) => {
    void withErrorHandler(req, res, async () => {
        const routeDeps = resolveSdkRouteSharedDeps(req);
        const id = /** @type {string} */ (req.params['id']);
        const { command, cwd, timeout } = req.body ?? {};
        const entry = getActiveSessionEntryOrReply(routeDeps, id, res);
        if (!entry) return;
        const result = await routeDeps.sdkSessionRpc.shellExec(
            entry.session,
            command,
            routeDeps.sdkSession.pickDefined({ cwd, timeout }),
        );
        res.json(withSessionRuntimeMeta(routeDeps, { ok: true, sessionId: id, result }, id));
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /sessions/:id/shell/:processId/kill
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Envia sinal para processo iniciado por `shell.exec`.
 */
router.post('/sessions/:id/shell/:processId/kill', validateBody(ShellKillBodySchema), (req, res) => {
    void withErrorHandler(req, res, async () => {
        const routeDeps = resolveSdkRouteSharedDeps(req);
        const id = /** @type {string} */ (req.params['id']);
        const processId = /** @type {string} */ (req.params['processId']);
        const entry = getActiveSessionEntryOrReply(routeDeps, id, res);
        if (!entry) return;
        const result = await routeDeps.sdkSessionRpc.shellKill(entry.session, processId, req.body?.signal);
        res.json(withSessionRuntimeMeta(routeDeps, { ok: true, sessionId: id, result }, id));
    });
});

export default router;
