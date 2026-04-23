// @ts-check
/**
 * src/copilot/server/routes/copilot-api/dialog.js
 *
 * Rotas do Dialog Loop do AlwaysAliveAgent: dialog/start, dialog/turn, dialog/stop.
 *
 * Onda 4.8 — migrado de `api/bridge/dialog.js` para `server/routes/copilot-api/`.
 *
 * Padrão §15.8 — Dialog Loop: todas as iterações usam o mesmo PR (sem custo por turno).
 *
 * @module copilot/server/routes/copilot-api/dialog
 */

import { log } from '#copilot/observability';
import { projectAgentHttpError } from '../../../presentation/agent-http-errors.js';
import {
    sendRuntimeDialogTurnOnActiveLoop,
    startRuntimeDialogLoop,
    stopRuntimeDialogLoopAuthorized,
} from '../../../presentation/runtime-dialog.js';
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
 */

/**
 * Registra rotas do Dialog Loop no router fornecido.
 *
 * @param {BridgeRouter} bridge - Express Router onde as rotas serão registradas
 * @param {RuntimeRouteBinding} binding - Runtime fixo legado ou resolver por requisição
 * @returns {void}
 */
export function registerDialogRoutes(bridge, binding) {
    // G2-API-09: flag de rate limiting — impede turnos concorrentes na camada HTTP
    let _turnInFlight = false;

    // ─── POST /dialog/start ───────────────────────────────────────────────────

    /**
     * Inicia o modo Dialog Loop — LLM-B entra em loop ask_user para comunicação direta.
     *
     * Body: { bootPrompt?: string } Returns: { ok: true, message: string }
     *
     * Padrão §15.8: todas as iterações usam o mesmo PR (sem custo por turno).
     */
    bridge.post('/dialog/start', async (/** @type {Req} */ req, /** @type {Res} */ res) => {
        const { agent } = resolveCopilotApiRouteBinding(binding, req);
        const { bootPrompt } = req.body ?? {};

        if (agent.status !== 'idle') {
            // G2-API-08: incluir dialogLoopActive para o cliente distinguir entre estados
            return res.status(409).json({
                ok: false,
                error: `Agente não está idle. Status: '${agent.status}'.`,
                dialogLoopActive: agent.dialogLoopActive ?? false,
            });
        }

        try {
            await startRuntimeDialogLoop(bootPrompt ?? undefined, agent);
            return res.json({ ok: true, message: 'Modo diálogo ativo. Use POST /dialog/turn para interagir.' });
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            log('ERROR', `[copilot-api/dialog/start] falhou: ${msg}`);
            const projection = projectAgentHttpError(err);
            return res.status(projection.status).json(projection.body);
        }
    });

    // ─── POST /dialog/turn ────────────────────────────────────────────────────

    /**
     * Envia um turno de diálogo para o modelo suspenso no dialog loop.
     *
     * Body: { message: string, timeout?: number } Returns: { ok: true, reply: string }
     *
     * A LLM-B está suspensa em ask_user aguardando input; esta rota fornece o input, aguarda a resposta REPLY: e a
     * retorna.
     */
    bridge.post('/dialog/turn', async (/** @type {Req} */ req, /** @type {Res} */ res) => {
        const { agent } = resolveCopilotApiRouteBinding(binding, req);
        // G2-API-09: rate limiting — rejeitar imediatamente se já há turno HTTP em andamento
        if (_turnInFlight) {
            return res.status(429).json({
                ok: false,
                error: 'Turno já em andamento. Aguarde a resposta antes de enviar outro.',
            });
        }

        const MIN_DIALOG_TIMEOUT_MS = 1_000;
        const MAX_DIALOG_TIMEOUT_MS = 300_000;
        const { message, timeout = 60_000 } = req.body ?? {};

        if (!message || typeof message !== 'string') {
            return res.status(400).json({ ok: false, error: 'Campo "message" (string) é obrigatório.' });
        }
        if (typeof timeout !== 'number' || timeout < MIN_DIALOG_TIMEOUT_MS || timeout > MAX_DIALOG_TIMEOUT_MS) {
            return res.status(400).json({
                ok: false,
                error: `"timeout" deve ser número entre ${MIN_DIALOG_TIMEOUT_MS} e ${MAX_DIALOG_TIMEOUT_MS}.`,
            });
        }

        _turnInFlight = true;
        try {
            const reply = await sendRuntimeDialogTurnOnActiveLoop(message, { timeout }, agent);
            return res.json({ ok: true, reply });
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            const projection = projectAgentHttpError(err, { timeoutStatus: 504 });
            log('WARN', `[copilot-api/dialog/turn] falhou (${projection.status}): ${msg}`);
            return res.status(projection.status).json({
                ...projection.body,
                dialogLoopActive: agent.dialogLoopActive ?? false,
            });
        } finally {
            _turnInFlight = false;
        }
    });

    // ─── POST /dialog/stop ────────────────────────────────────────────────────

    /**
     * Encerra o Dialog Loop, exigindo autorização explícita do usuário (DL-PERM).
     *
     * Body: `{ force: boolean }` — deve ser `true` para realmente encerrar o loop. Sem `force: true`, retorna 403 com
     * explicação da política de dialog loop permanente.
     *
     * Returns: { ok: true, message: string }
     */
    bridge.post('/dialog/stop', async (/** @type {Req} */ req, /** @type {Res} */ res) => {
        const { agent } = resolveCopilotApiRouteBinding(binding, req);
        const { force } = req.body ?? {};
        if (!force) {
            return res.status(403).json({
                ok: false,
                error: 'Dialog loop é permanente (DL-PERM). Use { force: true } apenas com autorização explícita do usuário.',
            });
        }
        try {
            await stopRuntimeDialogLoopAuthorized(agent);
            return res.json({ ok: true, message: 'Modo diálogo encerrado por autorização do usuário.' });
        } catch (err) {
            const projection = projectAgentHttpError(err);
            return res.status(projection.status).json(projection.body);
        }
    });
}
