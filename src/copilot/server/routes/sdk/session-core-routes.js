// @ts-check
/**
 * Rotas core de sessão SDK: send, stream, model, log, abort e messages.
 */

import { createEventFilter, createSseWriter } from '../../../infra/sse/utils.js';
import {
    abortSession,
    getSessionMessages,
    sendSession,
    sendSessionAndWait,
    setSessionModel,
} from '../../../sdk/session/wrapper.js';
import { resolveSdkRouteSharedDeps } from './deps.js';
import { validateBody, validateModel, withErrorHandler } from './session-middleware.js';
import { getActiveSessionEntryOrReply, withRuntimeMeta, withSessionRuntimeMeta } from './session-route-helpers.js';
import { LogMessageBodySchema, SendMessageBodySchema, SetModelBodySchema } from './session-schemas.js';
import { sendAndWaitWithoutTimeout } from './session-send-helpers.js';
import { ensureSessionStreamState, maybeDisposeSessionStreamState, sessionsTracker } from './session-stream-state.js';

/**
 * @typedef {import('express').Router} Router
 *
 * @typedef {{ prompt: string; attachments?: unknown; mode?: unknown; [key: string]: unknown }} RouteMessageOptions
 */

/**
 * @param {Router} router
 * @returns {void}
 */
export function registerSessionCoreRoutes(router) {
    router.post('/sessions/:id/send', validateBody(SendMessageBodySchema), (req, res) => {
        void withErrorHandler(req, res, async () => {
            const routeDeps = resolveSdkRouteSharedDeps(req);
            const id = /** @type {string} */ (req.params['id']);
            const { prompt, waitForResponse = true, attachments } = req.body ?? {};
            const rawTimeoutMs = (req.body ?? {}).timeoutMs;
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
    });

    router.get('/sessions/:id/stream', (req, res) => {
        const routeDeps = resolveSdkRouteSharedDeps(req);
        const { id } = req.params;

        if (!sessionsTracker.accept()) {
            res.status(503).json(withRuntimeMeta(routeDeps, { ok: false, error: 'Máximo de clientes SSE atingido' }));
            return;
        }

        const entry = getActiveSessionEntryOrReply(routeDeps, id, res);
        if (!entry) return;

        const state = ensureSessionStreamState(routeDeps, id, entry);

        const sse = createSseWriter(req, res, {
            heartbeatMs: 15_000,
            replayBuffer: state.pool.replayBuffer,
            tracker: sessionsTracker,
            maxLifetimeMs: 24 * 60 * 60 * 1000,
        });

        sse.send('connected', withSessionRuntimeMeta(routeDeps, { sessionId: id, timestamp: Date.now() }, id), {
            skipBuffer: true,
        });

        const eventFilter = createEventFilter(
            typeof req.query['events'] === 'string' ? req.query['events'] : undefined,
        );
        const sseClient = state.pool.addClient(sse, { filter: eventFilter });

        req.on('close', () => {
            state.pool.removeClient(sseClient);
            maybeDisposeSessionStreamState(routeDeps, state);
        });
    });

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
            const verification = await setSessionModel(
                entry.session,
                safeModel,
                routeDeps.sdkSession.pickDefined({ reasoningEffort }),
            );

            const effectiveModel = verification.effectiveModel ?? safeModel;
            const modelMismatch =
                verification.effectiveModel !== null && verification.effectiveModel !== verification.requestedModel;

            const runtimeSnapshot = routeDeps.sdkRuntimeProjection.readAgentStatusSnapshotForRuntime(
                routeDeps.runtimeId,
            );
            const runtimeSessionId =
                typeof runtimeSnapshot?.['sessionId'] === 'string' ? runtimeSnapshot['sessionId'] : null;
            if (runtimeSessionId === id && verification.verifiedSwitch) {
                routeDeps.sdkRuntimeProjection.setRuntimeModelProjection(effectiveModel, routeDeps.runtimeId);
                if (reasoningEffort !== undefined) {
                    routeDeps.sdkRuntimeProjection.setRuntimeReasoningProjection(reasoningEffort, routeDeps.runtimeId);
                }
            }

            routeDeps.sdkObservability.log(
                verification.verifiedSwitch ? 'INFO' : 'WARN',
                `[sdk-api] modelo solicitado: sessão ${id} → ${verification.requestedModel} (effective=${effectiveModel}, verified=${verification.verifiedSwitch}${verification.usedRpcFallback ? ', rpc-fallback=true' : ''})`,
            );
            res.json(
                withSessionRuntimeMeta(
                    routeDeps,
                    {
                        ok: true,
                        sessionId: id,
                        model: effectiveModel,
                        requestedModel: verification.requestedModel,
                        effectiveModel: verification.effectiveModel,
                        verifiedSwitch: verification.verifiedSwitch,
                        usedRpcFallback: verification.usedRpcFallback,
                        modelMismatch,
                        reasoningEffort: reasoningEffort ?? null,
                    },
                    id,
                ),
            );
        });
    });

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

    router.get('/sessions/:id/messages', (req, res) => {
        void withErrorHandler(req, res, async () => {
            const routeDeps = resolveSdkRouteSharedDeps(req);
            const { id } = req.params;
            const entry = getActiveSessionEntryOrReply(routeDeps, id, res);
            if (!entry) return;
            const messages = await getSessionMessages(entry.session);
            res.json(
                withSessionRuntimeMeta(routeDeps, { ok: true, sessionId: id, count: messages.length, messages }, id),
            );
        });
    });
}
