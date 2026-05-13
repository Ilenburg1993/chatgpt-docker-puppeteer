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

import { LLM_B_TURN_TIMEOUT_MS } from '#copilot/config';
import { log } from '#copilot/observability';
import { projectAgentHttpError } from '../../../presentation/agent/index.js';
import { resolveOptionalDialogTimeout } from '../../../presentation/dialog-timeout-policy.js';
import { readAgentRuntimeControlStateFromRoute } from '../../../presentation/runtime/index.js';
import {
    sendRuntimeDialogTurnOnActiveLoop,
    startRuntimeDialogLoop,
    stopRuntimeDialogLoopAuthorized,
} from '../../../presentation/runtime/index.js';
import { buildRuntimeRouteMetaPayload } from '../../../presentation/routing/index.js';
import { resolveCopilotApiRouteBinding } from '../../../presentation/routing/index.js';
import {
    clearDialogTurnInFlight,
    hasDialogTurnInFlight,
    markDialogTurnInFlight,
} from '../../runtime-state/copilot-api-dialog.js';

/**
 * @typedef {import('express').Request} Req
 *
 * @typedef {import('express').Response} Res
 *
 * @typedef {import('express').Router} BridgeRouter
 *
 * @typedef {import('../../../presentation/routing/index.js').CopilotApiRouteDeps} RuntimeRouteDeps
 *
 * @typedef {import('../../../presentation/routing/index.js').CopilotApiRouteBinding} RuntimeRouteBinding
 */

/**
 * Registra rotas do Dialog Loop no router fornecido.
 *
 * @param {BridgeRouter} bridge - Express Router onde as rotas serão registradas
 * @param {RuntimeRouteBinding} binding - Runtime fixo legado ou resolver por requisição
 * @returns {void}
 */
export function registerDialogRoutes(bridge, binding) {
    // ─── POST /dialog/start ───────────────────────────────────────────────────

    /**
     * Inicia o modo Dialog Loop — LLM-B entra em loop ask_user para comunicação direta.
     *
     * Body: { bootPrompt?: string } Returns: { ok: true, message: string }
     *
     * Padrão §15.8: todas as iterações usam o mesmo PR (sem custo por turno).
     */
    bridge.post('/dialog/start', async (/** @type {Req} */ req, /** @type {Res} */ res) => {
        const deps = resolveCopilotApiRouteBinding(binding, req);
        const { agent } = deps;
        const runtimeMeta = buildRuntimeRouteMetaPayload(deps);
        const { bootPrompt } = req.body ?? {};
        const controlState = readAgentRuntimeControlStateFromRoute(deps);

        if (controlState.status !== 'idle') {
            // G2-API-08: incluir dialogLoopActive para o cliente distinguir entre estados
            return res.status(409).json({
                ok: false,
                ...runtimeMeta,
                error: `Agente não está idle. Status: '${controlState.status}'.`,
                dialogLoopActive: controlState.dialogLoopActive,
            });
        }

        try {
            await startRuntimeDialogLoop(bootPrompt ?? undefined, agent);
            return res.json({
                ok: true,
                ...runtimeMeta,
                message: 'Modo diálogo ativo. Use POST /dialog/turn para interagir.',
            });
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            log('ERROR', `[copilot-api/dialog/start] falhou: ${msg}`);
            const projection = projectAgentHttpError(err);
            return res.status(projection.status).json({ ...runtimeMeta, ...projection.body });
        }
    });

    // ─── POST /dialog/turn ────────────────────────────────────────────────────

    /**
     * Envia um turno de diálogo para o modelo suspenso no dialog loop.
     *
     * Body: { message: string, timeout?: number } Returns: { ok: true, reply: string }
     *
     * `timeout=0` desabilita o timeout explícito da borda HTTP; o runtime interno continua responsável por detectar
     * inatividade/stall. Quando omitido, o timeout é adaptativo.
     */
    bridge.post('/dialog/turn', async (/** @type {Req} */ req, /** @type {Res} */ res) => {
        const deps = resolveCopilotApiRouteBinding(binding, req);
        const { agent } = deps;
        const runtimeMeta = buildRuntimeRouteMetaPayload(deps);
        const runtimeKey = deps.runtimeId ?? 'default';
        const { message, timeout: rawTimeout } = req.body ?? {};

        if (!message || typeof message !== 'string') {
            return res
                .status(400)
                .json({ ok: false, ...runtimeMeta, error: 'Campo "message" (string) é obrigatório.' });
        }
        if (
            rawTimeout !== undefined &&
            (typeof rawTimeout !== 'number' || !Number.isFinite(rawTimeout) || rawTimeout < 0)
        ) {
            return res.status(400).json({
                ok: false,
                ...runtimeMeta,
                error: '"timeout" deve ser número finito maior ou igual a 0.',
            });
        }

        const timeoutDecision = resolveOptionalDialogTimeout({
            explicitTimeoutMs: rawTimeout,
            defaultTimeoutMs: LLM_B_TURN_TIMEOUT_MS,
            payloadChars: message.length,
            phase: 'dialog',
            allowDisabled: true,
        });

        if (hasDialogTurnInFlight(runtimeKey)) {
            return res.status(409).json({
                ok: false,
                ...runtimeMeta,
                error: `Já existe um turno de diálogo em andamento para runtime '${runtimeKey}'.`,
                dialogLoopActive: readAgentRuntimeControlStateFromRoute(deps).dialogLoopActive,
            });
        }

        markDialogTurnInFlight(runtimeKey);
        try {
            const reply = await sendRuntimeDialogTurnOnActiveLoop(
                message,
                timeoutDecision.timeoutMs !== null ? { timeout: timeoutDecision.timeoutMs } : {},
                agent,
            );
            log(
                'INFO',
                `[copilot-api/dialog/turn] timeout=${timeoutDecision.timeoutMs ?? 'disabled'} strategy=${timeoutDecision.strategy} reasons=${timeoutDecision.reasons.join('+')}`,
            );
            return res.json({
                ok: true,
                ...runtimeMeta,
                reply,
                timeoutPolicy: {
                    timeoutMs: timeoutDecision.timeoutMs,
                    strategy: timeoutDecision.strategy,
                    reasons: timeoutDecision.reasons,
                },
            });
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            const projection = projectAgentHttpError(err, { timeoutStatus: 504 });
            log('WARN', `[copilot-api/dialog/turn] falhou (${projection.status}): ${msg}`);
            return res.status(projection.status).json({
                ...runtimeMeta,
                ...projection.body,
                dialogLoopActive: readAgentRuntimeControlStateFromRoute(deps).dialogLoopActive,
            });
        } finally {
            clearDialogTurnInFlight(runtimeKey);
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
        const deps = resolveCopilotApiRouteBinding(binding, req);
        const { agent } = deps;
        const runtimeMeta = buildRuntimeRouteMetaPayload(deps);
        const { force } = req.body ?? {};
        if (!force) {
            return res.status(403).json({
                ok: false,
                ...runtimeMeta,
                error: 'Dialog loop é permanente (DL-PERM). Use { force: true } apenas com autorização explícita do usuário.',
            });
        }
        try {
            await stopRuntimeDialogLoopAuthorized(agent);
            return res.json({
                ok: true,
                ...runtimeMeta,
                message: 'Modo diálogo encerrado por autorização do usuário.',
            });
        } catch (err) {
            const projection = projectAgentHttpError(err);
            return res.status(projection.status).json({ ...runtimeMeta, ...projection.body });
        }
    });
}
