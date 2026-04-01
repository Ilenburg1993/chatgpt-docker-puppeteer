// @ts-check
/**
 * src/copilot/api/bridge-dialog.js
 *
 * Rotas do Dialog Loop do AlwaysAliveAgent: dialog/start, dialog/turn, dialog/stop.
 *
 * Exporta `registerDialogRoutes(bridge, agent)` para ser montado pelo http-bridge.js.
 *
 * Padrão §15.8 — Dialog Loop: todas as iterações usam o mesmo PR (sem custo por turno).
 *
 * @module copilot/api/bridge-dialog
 */

import { log } from '#core/logger';

/**
 * @typedef {import('express').Request} Req
 *
 * @typedef {import('express').Response} Res
 *
 * @typedef {import('express').Router} BridgeRouter
 *
 * @typedef {import('./bridge-control.js').AlwaysAliveAgentLike} AlwaysAliveAgentLike
 */

/**
 * Registra rotas do Dialog Loop no router fornecido.
 *
 * @param {BridgeRouter} bridge - Express Router onde as rotas serão registradas
 * @param {AlwaysAliveAgentLike} agent - Instância do AlwaysAliveAgent
 * @returns {void}
 */
export function registerDialogRoutes(bridge, agent) {
    // ─── POST /dialog/start ───────────────────────────────────────────────────

    /**
     * Inicia o modo Dialog Loop — LLM-B entra em loop ask_user para comunicação direta.
     *
     * Body: { bootPrompt?: string } Returns: { ok: true, message: string }
     *
     * Padrão §15.8: todas as iterações usam o mesmo PR (sem custo por turno).
     */
    bridge.post('/dialog/start', async (/** @type {Req} */ req, /** @type {Res} */ res) => {
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
            await agent.startDialogLoop(bootPrompt ?? undefined);
            return res.json({ ok: true, message: 'Modo diálogo ativo. Use POST /dialog/turn para interagir.' });
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            log('ERROR', `[bridge-dialog/start] falhou: ${msg}`);
            return res.status(500).json({ ok: false, error: msg });
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

        try {
            const reply = await agent.sendDialogTurn(message, { timeout });
            return res.json({ ok: true, reply });
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            // FLOW-UPG-04: diferenciar 409 (loop inativo) de outros erros para melhor diagnóstico
            const isLoopInactive =
                msg.includes('não está ativo') ||
                (err instanceof Error && /** @type {any} */ (err).code === 'DIALOG_NOT_ACTIVE');
            const isQueueFull = /** @type {any} */ (err)?.code === 'DIALOG_QUEUE_FULL';
            const status = isLoopInactive ? 409 : isQueueFull ? 429 : msg.includes('timeout') ? 504 : 500;
            log('WARN', `[bridge-dialog/turn] falhou (${status}): ${msg}`);
            return res.status(status).json({
                ok: false,
                error: msg,
                // FLOW-UPG-04: incluir estado do loop para facilitar diagnóstico pelo cliente
                dialogLoopActive: agent.dialogLoopActive ?? false,
            });
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
        const { force } = req.body ?? {};
        if (!force) {
            return res.status(403).json({
                ok: false,
                error: 'Dialog loop é permanente (DL-PERM). Use { force: true } apenas com autorização explícita do usuário.',
            });
        }
        try {
            await agent.stopDialogLoop({ authorized: true });
            return res.json({ ok: true, message: 'Modo diálogo encerrado por autorização do usuário.' });
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return res.status(500).json({ ok: false, error: msg });
        }
    });
}
