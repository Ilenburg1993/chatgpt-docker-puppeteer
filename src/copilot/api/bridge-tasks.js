// @ts-check
/**
 * src/copilot/api/bridge-tasks.js
 *
 * Rotas de tarefas do AlwaysAliveAgent: send (enfileirar mensagem) e answer (responder pergunta).
 *
 * Exporta `registerTaskRoutes(bridge, agent)` para ser montado pelo http-bridge.js.
 *
 * @module copilot/api/bridge-tasks
 */

import { log } from '#copilot/observability/logger';
import { randomUUID } from 'node:crypto';

/**
 * @typedef {import('express').Request} Req
 *
 * @typedef {import('express').Response} Res
 *
 * @typedef {import('express').Router} BridgeRouter
 *
 * @typedef {import('./bridge-control.js').AlwaysAliveAgentLike} AlwaysAliveAgentLike
 *
 * @typedef {Object} SendRequestBody
 * @property {string} message - Texto da mensagem a enviar ao agente
 * @property {boolean} [waitForResponse] - Aguardar resposta síncrona (default: false)
 * @property {number} [timeoutMs] - Timeout em ms ao aguardar resposta (default: 30000)
 * @property {import('@github/copilot-sdk').MessageOptions['attachments']} [attachments] - Arquivos/contexto extras
 */

/**
 * Registra rotas de tarefas do agente no router fornecido.
 *
 * @param {BridgeRouter} bridge - Express Router onde as rotas serão registradas
 * @param {AlwaysAliveAgentLike} agent - Instância do AlwaysAliveAgent
 * @returns {void}
 */
export function registerTaskRoutes(bridge, agent) {
    // ─── POST /send ───────────────────────────────────────────────────────────

    /**
     * Enfileira uma mensagem para o agente processar. Retorna imediatamente com o taskId (processamento é assíncrono).
     *
     * Body: { message: string, waitForResponse?: boolean, timeoutMs?: number, attachments?: Array }
     */
    bridge.post('/send', async (/** @type {Req} */ req, /** @type {Res} */ res) => {
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
                } catch (/** @type {any} */ e) {
                    clearTimeout(timeoutHandle);
                    if (e?.name === 'AbortError' || e?.code === 'ABORT_ERR') {
                        return res.status(504).json({ ok: false, error: `Timeout após ${timeoutMs}ms` });
                    }
                    throw e;
                }
            }

            // GAP-03 (fix): verificar se a fila está cheia antes de retornar ok:true
            // agent.sendMessage rejeita imediatamente com QUEUE_FULL, mas só após a promise ser criada
            // Verificar proativamente via MAX_QUEUE_SIZE evita estado inconsistente
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
            agent
                .sendMessage(message, { ...(attachments !== undefined ? { attachments } : {}), taskId })
                .catch((/** @type {any} */ e) => {
                    log('WARN', `[bridge-tasks/send] Tarefa assíncrona falhou: ${e.message}`);
                });
            return res.json({ ok: true, taskId, message: 'Mensagem enfileirada.', status: agent.status });
        } catch (/** @type {any} */ e) {
            log('ERROR', `[bridge-tasks/send] ${e.message}`);
            return res.status(500).json({ ok: false, error: e.message });
        }
    });

    // ─── POST /answer ─────────────────────────────────────────────────────────

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

        const answered = agent.answerPendingQuestion(answer);
        if (!answered) {
            return res.status(409).json({ ok: false, error: 'Não há pergunta pendente do modelo no momento.' });
        }
        return res.json({ ok: true, message: 'Resposta enviada ao modelo.' });
    });
}
