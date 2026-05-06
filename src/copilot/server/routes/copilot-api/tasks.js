// @ts-check
/**
 * src/copilot/server/routes/copilot-api/tasks.js
 *
 * Rotas de tarefas do AlwaysAliveAgent: send (enfileirar mensagem) e answer (responder pergunta).
 *
 * Onda 4.8 — migrado de `api/bridge/tasks.js` para `server/routes/copilot-api/`.
 *
 * @module copilot/server/routes/copilot-api/tasks
 */

import { LLM_B_TURN_TIMEOUT_MS } from '#copilot/config';
import { log } from '#copilot/observability';
import { normalizeElicitationResult } from '#copilot/sdk';
import { randomUUID } from 'node:crypto';
import { toError } from '../../../core/error-handlers.js';
import { projectAgentHttpError } from '../../../presentation/agent-http-errors.js';
import { resolveOptionalDialogTimeout } from '../../../presentation/dialog-timeout-policy.js';
import { readAgentRuntimeControlStateFromRoute } from '../../../presentation/runtime-controls.js';
import { buildRuntimeRouteMetaPayload } from '../../../presentation/runtime-meta.js';
import { resolveCopilotApiRouteBinding } from '../../../presentation/runtime-request.js';

/**
 * @typedef {import('express').Request} Req
 *
 * @typedef {import('express').Response} Res
 *
 * @typedef {import('express').Router} BridgeRouter
 *
 * @typedef {import('../../../presentation/runtime-route-deps.js').CopilotApiRouteDeps} RuntimeRouteDeps
 *
 * @typedef {import('../../../presentation/runtime-request.js').CopilotApiRouteBinding} RuntimeRouteBinding
 *
 * @typedef {Object} SendRequestBody
 * @property {string} message - Texto da mensagem a enviar ao agente
 * @property {boolean} [waitForResponse] - Aguardar resposta síncrona (default: false)
 * @property {number} [timeoutMs] - Timeout em ms ao aguardar resposta (`0` desabilita; omitido = adaptativo)
 * @property {unknown[]} [attachments] - Arquivos/contexto extras já validados pela borda chamadora
 */

/**
 * Registra rotas de tarefas do agente no router fornecido.
 *
 * @param {BridgeRouter} bridge - Express Router onde as rotas serão registradas
 * @param {RuntimeRouteBinding} binding - Runtime fixo legado ou resolver por requisição
 * @returns {void}
 */
export function registerTaskRoutes(bridge, binding) {
    // ─── POST /send ───────────────────────────────────────────────────────────

    /**
     * Enfileira uma mensagem para o agente processar. Retorna imediatamente com o taskId (processamento é assíncrono).
     *
     * Body: { message: string, waitForResponse?: boolean, timeoutMs?: number, attachments?: Array }
     */
    bridge.post('/send', async (/** @type {Req} */ req, /** @type {Res} */ res) => {
        const deps = resolveCopilotApiRouteBinding(binding, req);
        const { agent } = deps;
        const runtimeMeta = buildRuntimeRouteMetaPayload(deps);
        const { message, waitForResponse = false, timeoutMs: rawTimeoutMs, attachments } = req.body ?? {};
        const controlState = readAgentRuntimeControlStateFromRoute(deps);

        if (!message || typeof message !== 'string') {
            return res
                .status(400)
                .json({ ...runtimeMeta, ok: false, error: 'Campo "message" (string) é obrigatório.' });
        }

        if (
            rawTimeoutMs !== undefined &&
            (typeof rawTimeoutMs !== 'number' || !Number.isFinite(rawTimeoutMs) || rawTimeoutMs < 0)
        ) {
            return res.status(400).json({
                ...runtimeMeta,
                ok: false,
                error: 'Campo "timeoutMs" deve ser um número finito maior ou igual a zero.',
            });
        }

        const timeoutDecision = resolveOptionalDialogTimeout({
            explicitTimeoutMs: rawTimeoutMs,
            defaultTimeoutMs: LLM_B_TURN_TIMEOUT_MS,
            payloadChars: message.length,
            phase: 'dialog',
            allowDisabled: true,
        });

        if (controlState.status === 'stopped') {
            return res.status(503).json({
                ...runtimeMeta,
                ok: false,
                error: 'Agente não está ativo. Use POST /api/copilot/start primeiro.',
            });
        }

        try {
            if (waitForResponse) {
                // Para turnos longos, o caller pode desabilitar o timeout explícito (timeoutMs=0).
                // Caso contrário, usamos timeout adaptativo alinhado ao runtime do dialog loop.
                const controller = timeoutDecision.timeoutMs !== null ? new AbortController() : null;
                const timeoutHandle =
                    controller !== null && typeof timeoutDecision.timeoutMs === 'number'
                        ? setTimeout(() => controller.abort(), timeoutDecision.timeoutMs)
                        : null;
                try {
                    const raceResult = await agent.sendMessage(message, {
                        ...(attachments !== undefined ? { attachments } : {}),
                        ...(controller !== null ? { signal: controller.signal } : {}),
                    });
                    if (timeoutHandle) clearTimeout(timeoutHandle);
                    log(
                        'INFO',
                        `[copilot-api/tasks/send] waitForResponse timeout=${timeoutDecision.timeoutMs ?? 'disabled'} strategy=${timeoutDecision.strategy} reasons=${timeoutDecision.reasons.join('+')}`,
                    );
                    return res.json({
                        ...runtimeMeta,
                        ok: true,
                        response: raceResult,
                        timeoutPolicy: {
                            timeoutMs: timeoutDecision.timeoutMs,
                            strategy: timeoutDecision.strategy,
                            reasons: timeoutDecision.reasons,
                        },
                    });
                } catch (e) {
                    if (timeoutHandle) clearTimeout(timeoutHandle);
                    const projection = projectAgentHttpError(e, {
                        fallbackStatus: 500,
                        timeoutStatus: 504,
                        timeoutMessage:
                            timeoutDecision.timeoutMs !== null
                                ? `Timeout após ${timeoutDecision.timeoutMs}ms`
                                : 'Operação abortada aguardando resposta do agente',
                    });
                    return res.status(projection.status).json({ ...runtimeMeta, ...projection.body });
                }
            }

            // GAP-03 (fix): verificar se a fila está cheia antes de retornar ok:true
            const queueSize = controlState.queueSize;
            const maxQueueSize =
                /** @type {{ constructor?: { MAX_QUEUE_SIZE?: number } }} */ (agent).constructor?.MAX_QUEUE_SIZE ??
                null;
            if (maxQueueSize !== null && queueSize >= maxQueueSize) {
                return res.status(429).json({
                    ...runtimeMeta,
                    ok: false,
                    error: `Fila cheia (${queueSize}/${maxQueueSize} tarefas). Tente novamente mais tarde.`,
                });
            }

            // Enfileira sem aguardar — G2-API-07: retornar taskId para rastreabilidade no SSE
            const taskId = randomUUID();
            const sendOptions =
                /** @type {Parameters<RuntimeRouteDeps['agent']['sendMessage']>[1] & { taskId: string }} */ ({
                    ...(attachments !== undefined ? { attachments } : {}),
                    taskId,
                });
            const sendPromise = agent.sendMessage(message, sendOptions);
            // Aguarda exatamente uma microtask para capturar rejeição imediata (ex.: QUEUE_FULL)
            // sem transformar o endpoint assíncrono em wait-for-response completo.
            /** @type {unknown} */
            let earlyCatch = null;
            let settled = false;
            sendPromise.then(
                () => {
                    settled = true;
                },
                (/** @type {unknown} */ e) => {
                    settled = true;
                    earlyCatch = e;
                    return null;
                },
            );
            await new Promise((resolve) => queueMicrotask(() => resolve(undefined)));
            if (settled && earlyCatch !== null) {
                const projection = projectAgentHttpError(earlyCatch);
                return res.status(projection.status).json({ ...runtimeMeta, ...projection.body });
            }
            // Erros tardios apenas logados
            sendPromise.catch((/** @type {unknown} */ e) => {
                log('WARN', `[copilot-api/tasks/send] Tarefa assíncrona falhou: ${toError(e).message}`);
            });
            return res.json({
                ...runtimeMeta,
                ok: true,
                taskId,
                message: 'Mensagem enfileirada.',
                status: readAgentRuntimeControlStateFromRoute(deps).status,
            });
        } catch (e) {
            log('ERROR', `[copilot-api/tasks/send] ${toError(e).message}`);
            const projection = projectAgentHttpError(e);
            return res.status(projection.status).json({ ...runtimeMeta, ...projection.body });
        }
    });

    // ─── POST /answer ─────────────────────────────────────────────────────────

    /**
     * Responde à pergunta pendente do modelo.
     *
     * Body: { answer: string }
     */
    bridge.post('/answer', (/** @type {Req} */ req, /** @type {Res} */ res) => {
        const deps = resolveCopilotApiRouteBinding(binding, req);
        const { agent } = deps;
        const runtimeMeta = buildRuntimeRouteMetaPayload(deps);
        const { answer } = req.body ?? {};

        if (!answer || typeof answer !== 'string') {
            return res.status(400).json({ ...runtimeMeta, ok: false, error: 'Campo "answer" (string) é obrigatório.' });
        }

        const answered = agent.answerPendingQuestion(answer);
        if (!answered) {
            return res
                .status(409)
                .json({ ...runtimeMeta, ok: false, error: 'Não há pergunta pendente do modelo no momento.' });
        }
        return res.json({ ...runtimeMeta, ok: true, message: 'Resposta enviada ao modelo.' });
    });

    // ─── POST /answer/clear-shadow ───────────────────────────────────────────

    /**
     * Limpa explicitamente a shadow persistida de `ask_user` restaurada do disco.
     */
    bridge.post('/answer/clear-shadow', (_req, /** @type {Res} */ res) => {
        const deps = resolveCopilotApiRouteBinding(binding, /** @type {Req} */ (_req));
        const { agent } = deps;
        const runtimeMeta = buildRuntimeRouteMetaPayload(deps);
        if (typeof agent.clearPendingQuestionShadow !== 'function') {
            return res.status(501).json({
                ...runtimeMeta,
                ok: false,
                error: 'Esta instância do agente não suporta limpeza explícita de shadow ask_user.',
            });
        }

        const cleared = agent.clearPendingQuestionShadow();
        if (!cleared) {
            return res
                .status(409)
                .json({ ...runtimeMeta, ok: false, error: 'Não há shadow persistida do modelo no momento.' });
        }
        return res.json({ ...runtimeMeta, ok: true, message: 'Shadow persistida de ask_user limpa.' });
    });

    // ─── GET /elicitation ───────────────────────────────────────────────────

    bridge.get('/elicitation', (/** @type {Req} */ req, /** @type {Res} */ res) => {
        const deps = resolveCopilotApiRouteBinding(binding, req);
        const { agent } = deps;
        const runtimeMeta = buildRuntimeRouteMetaPayload(deps);
        if (typeof agent.listPendingSdkElicitations !== 'function') {
            return res
                .status(501)
                .json({ ...runtimeMeta, ok: false, error: 'Esta instância não suporta provider-side elicitation.' });
        }
        return res.json({ ...runtimeMeta, ok: true, entries: agent.listPendingSdkElicitations() });
    });

    // ─── GET /elicitation/:id ───────────────────────────────────────────────

    bridge.get('/elicitation/:id', (/** @type {Req} */ req, /** @type {Res} */ res) => {
        const deps = resolveCopilotApiRouteBinding(binding, req);
        const { agent } = deps;
        const runtimeMeta = buildRuntimeRouteMetaPayload(deps);
        if (typeof agent.getPendingSdkElicitation !== 'function') {
            return res
                .status(501)
                .json({ ...runtimeMeta, ok: false, error: 'Esta instância não suporta provider-side elicitation.' });
        }
        const id = /** @type {string} */ (req.params['id']);
        const entry = agent.getPendingSdkElicitation(id);
        if (!entry) {
            return res.status(404).json({ ...runtimeMeta, ok: false, error: 'Elicitation pendente não encontrada.' });
        }
        return res.json({ ...runtimeMeta, ok: true, entry });
    });

    // ─── POST /elicitation/:id/respond ──────────────────────────────────────

    bridge.post('/elicitation/:id/respond', (/** @type {Req} */ req, /** @type {Res} */ res) => {
        const deps = resolveCopilotApiRouteBinding(binding, req);
        const { agent } = deps;
        const runtimeMeta = buildRuntimeRouteMetaPayload(deps);
        if (typeof agent.resolvePendingSdkElicitation !== 'function') {
            return res
                .status(501)
                .json({ ...runtimeMeta, ok: false, error: 'Esta instância não suporta provider-side elicitation.' });
        }

        const id = /** @type {string} */ (req.params['id']);
        const { action, content } = req.body ?? {};
        if (typeof agent.getPendingSdkElicitation === 'function') {
            const entry = agent.getPendingSdkElicitation(id);
            if (!entry) {
                return res
                    .status(404)
                    .json({ ...runtimeMeta, ok: false, error: 'Elicitation pendente não encontrada.' });
            }
            try {
                const result = normalizeElicitationResult(
                    {
                        action,
                        ...(content !== undefined ? { content } : {}),
                    },
                    entry.requestedSchema,
                    { context: '[copilot-api/tasks]' },
                );
                const ok = agent.resolvePendingSdkElicitation(id, result);
                if (!ok) {
                    return res
                        .status(409)
                        .json({ ...runtimeMeta, ok: false, error: 'Elicitation não está mais pendente.' });
                }
                return res.json({ ...runtimeMeta, ok: true, message: 'Resposta de elicitation enviada ao SDK.' });
            } catch (error) {
                return res.status(400).json({ ...runtimeMeta, ok: false, error: toError(error).message });
            }
        }
        if (action !== 'accept' && action !== 'decline' && action !== 'cancel') {
            return res
                .status(400)
                .json({ ...runtimeMeta, ok: false, error: 'Campo "action" deve ser accept | decline | cancel.' });
        }
        if (content !== undefined && (typeof content !== 'object' || content === null || Array.isArray(content))) {
            return res.status(400).json({
                ...runtimeMeta,
                ok: false,
                error: 'Campo "content" deve ser um objeto quando fornecido.',
            });
        }

        const ok = agent.resolvePendingSdkElicitation(id, {
            action,
            ...(content !== undefined ? { content } : {}),
        });
        if (!ok) {
            return res.status(409).json({ ...runtimeMeta, ok: false, error: 'Elicitation não está mais pendente.' });
        }
        return res.json({ ...runtimeMeta, ok: true, message: 'Resposta de elicitation enviada ao SDK.' });
    });
}
