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

import { log } from '#copilot/observability';
import { randomUUID } from 'node:crypto';
import { toError } from '../../../core/error-handlers.js';
import { projectAgentHttpError } from '../../../presentation/agent-http-errors.js';
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
 * @property {number} [timeoutMs] - Timeout em ms ao aguardar resposta (default: 30000)
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
        const { agent } = resolveCopilotApiRouteBinding(binding, req);
        const { message, waitForResponse = false, timeoutMs = 30000, attachments } = req.body ?? {};

        if (!message || typeof message !== 'string') {
            return res.status(400).json({ ok: false, error: 'Campo "message" (string) é obrigatório.' });
        }

        if (agent.status === 'stopped') {
            return res
                .status(503)
                .json({ ok: false, error: 'Agente não está ativo. Use POST /api/copilot/start primeiro.' });
        }

        try {
            if (waitForResponse) {
                // G2-API-06: usar AbortController para cancelar a tarefa quando timeout vencer
                const controller = new AbortController();
                const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
                try {
                    const raceResult = await agent.sendMessage(message, {
                        ...(attachments !== undefined ? { attachments } : {}),
                        signal: controller.signal,
                    });
                    clearTimeout(timeoutHandle);
                    return res.json({ ok: true, response: raceResult });
                } catch (e) {
                    clearTimeout(timeoutHandle);
                    const projection = projectAgentHttpError(e, {
                        fallbackStatus: 500,
                        timeoutStatus: 504,
                        timeoutMessage: `Timeout após ${timeoutMs}ms`,
                    });
                    return res.status(projection.status).json(projection.body);
                }
            }

            // GAP-03 (fix): verificar se a fila está cheia antes de retornar ok:true
            const queueSize = /** @type {{ queueSize?: number }} */ (agent).queueSize ?? null;
            const maxQueueSize =
                /** @type {{ constructor?: { MAX_QUEUE_SIZE?: number } }} */ (agent).constructor?.MAX_QUEUE_SIZE ??
                null;
            if (queueSize !== null && maxQueueSize !== null && queueSize >= maxQueueSize) {
                return res.status(429).json({
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
                return res.status(projection.status).json(projection.body);
            }
            // Erros tardios apenas logados
            sendPromise.catch((/** @type {unknown} */ e) => {
                log('WARN', `[copilot-api/tasks/send] Tarefa assíncrona falhou: ${toError(e).message}`);
            });
            return res.json({ ok: true, taskId, message: 'Mensagem enfileirada.', status: agent.status });
        } catch (e) {
            log('ERROR', `[copilot-api/tasks/send] ${toError(e).message}`);
            const projection = projectAgentHttpError(e);
            return res.status(projection.status).json(projection.body);
        }
    });

    // ─── POST /answer ─────────────────────────────────────────────────────────

    /**
     * Responde à pergunta pendente do modelo.
     *
     * Body: { answer: string }
     */
    bridge.post('/answer', (/** @type {Req} */ req, /** @type {Res} */ res) => {
        const { agent } = resolveCopilotApiRouteBinding(binding, req);
        const { answer } = req.body ?? {};

        if (!answer || typeof answer !== 'string') {
            return res.status(400).json({ ok: false, error: 'Campo "answer" (string) é obrigatório.' });
        }

        const answered = agent.answerPendingQuestion(answer);
        if (!answered) {
            return res.status(409).json({ ok: false, error: 'Não há pergunta pendente do modelo no momento.' });
        }
        return res.json({ ok: true, message: 'Resposta enviada ao modelo.' });
    });

    // ─── POST /answer/clear-shadow ───────────────────────────────────────────

    /**
     * Limpa explicitamente a shadow persistida de `ask_user` restaurada do disco.
     */
    bridge.post('/answer/clear-shadow', (_req, /** @type {Res} */ res) => {
        const { agent } = resolveCopilotApiRouteBinding(binding, /** @type {Req} */ (_req));
        if (typeof agent.clearPendingQuestionShadow !== 'function') {
            return res.status(501).json({
                ok: false,
                error: 'Esta instância do agente não suporta limpeza explícita de shadow ask_user.',
            });
        }

        const cleared = agent.clearPendingQuestionShadow();
        if (!cleared) {
            return res.status(409).json({ ok: false, error: 'Não há shadow persistida do modelo no momento.' });
        }
        return res.json({ ok: true, message: 'Shadow persistida de ask_user limpa.' });
    });
}
