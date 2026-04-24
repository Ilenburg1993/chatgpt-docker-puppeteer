// @ts-check
/**
 * src/copilot/channel/client-dialog.js
 *
 * Funções de dialog mode extraídas de LlmBridgeClient para reduzir o God Module. Cada função opera sobre a interface
 * BridgeAgentLike e retorna dados puros.
 *
 * @module copilot/channel/client-dialog
 * @see EventBus
 */

import { sendAgentDialogTurn, startAgentDialogLoop, stopAgentDialogLoopAuthorized } from '#copilot/agent';
import { LLM_B_TURN_TIMEOUT_MS } from '#copilot/config';
import {
    EMITTER_DIALOG_READY,
    EMITTER_DIALOG_REPLY,
    EMITTER_DIALOG_STOPPED,
    EMITTER_TASK_DELTA,
    EMITTER_TASK_REASONING,
} from '#copilot/events';
import { log } from '#copilot/observability';

/**
 * Interface mínima do AlwaysAliveAgent usada pelas funções de dialog.
 *
 * @typedef {import('./client.js').BridgeAgentLike} BridgeAgentLike
 */

/**
 * Registra os event listeners de diálogo e retorna uma função de cleanup simétrica.
 *
 * @param {BridgeAgentLike} agent
 * @param {{ onReady?: () => void; onReply?: (reply: string) => void; onStopped?: () => void }} opts
 * @returns {{ replyHandler: ((evt: unknown) => void) | null; cleanup: () => void }}
 */
export function registerDialogListeners(agent, opts) {
    const { onReady, onReply, onStopped } = opts;
    const replyHandler = onReply
        ? (/** @type {unknown} */ rawEvt) => {
              const evt = /** @type {{ reply?: string }} */ (rawEvt);
              onReply(evt.reply ?? '');
          }
        : null;

    if (onReady) agent.once(EMITTER_DIALOG_READY, onReady);
    if (replyHandler) agent.on(EMITTER_DIALOG_REPLY, replyHandler);
    if (onStopped) agent.once(EMITTER_DIALOG_STOPPED, onStopped);

    const cleanup = () => {
        if (onReady) agent.off('dialog.ready', onReady);
        if (replyHandler) agent.off('dialog.reply', replyHandler);
        if (onStopped) agent.off('dialog.stopped', onStopped);
    };

    return { replyHandler, cleanup };
}

/**
 * Inicia a LLM-B em modo de "diálogo direto" (Dialog Loop).
 *
 * @param {BridgeAgentLike} agent
 * @param {string} [bootPrompt]
 * @param {{
 *     onReady?: () => void;
 *     onReply?: (reply: string) => void;
 *     onStopped?: () => void;
 * }} [opts]
 * @returns {Promise<void>}
 */
export async function startDialogMode(agent, bootPrompt, opts = {}) {
    const { cleanup } = registerDialogListeners(agent, opts);

    try {
        await startAgentDialogLoop(agent, bootPrompt);
        log('INFO', '[LlmBridgeClient] Modo diálogo ativo — LLM-B sinalizou READY.');
    } catch (err) {
        cleanup();
        throw err;
    }
}

/**
 * Envia um turno de diálogo para a LLM-B no dialog loop.
 *
 * @param {BridgeAgentLike} agent
 * @param {string} message
 * @param {{
 *     timeout?: number;
 *     onDelta?: (chunk: string) => void;
 *     onReasoning?: (chunk: string, reasoningId: string | null) => void;
 * }} [opts]
 * @returns {Promise<string>}
 */
export async function dialogTurn(agent, message, opts = {}) {
    const { timeout = LLM_B_TURN_TIMEOUT_MS, onDelta, onReasoning } = opts;

    const onDeltaTemp = onDelta
        ? (/** @type {unknown} */ rawEvt) => {
              const evt = /** @type {{ chunk?: string }} */ (rawEvt);
              if (evt.chunk) onDelta(evt.chunk);
          }
        : null;
    if (onDeltaTemp) agent.on(EMITTER_TASK_DELTA, onDeltaTemp);

    const onReasoningTemp = onReasoning
        ? (/** @type {unknown} */ rawEvt) => {
              const evt = /** @type {{ chunk?: string; reasoningId?: string | null }} */ (rawEvt);
              if (evt.chunk) onReasoning(evt.chunk, evt.reasoningId ?? null);
          }
        : null;
    if (onReasoningTemp) agent.on(EMITTER_TASK_REASONING, onReasoningTemp);

    try {
        const reply = await sendAgentDialogTurn(agent, message, { timeout });
        if (reply === null) {
            throw new Error('[LlmBridgeClient] sendDialogTurn retornou null.');
        }
        return reply;
    } finally {
        if (onDeltaTemp) agent.off('task.delta', onDeltaTemp);
        if (onReasoningTemp) agent.off('task.reasoning', onReasoningTemp);
    }
}

/**
 * Encerra o modo de diálogo direto.
 *
 * @param {BridgeAgentLike} agent
 * @param {'watchdog_restart' | 'authorized_stop' | 'recovery_restart'} [reason='watchdog_restart'] Default is
 *   `'watchdog_restart'`
 * @returns {Promise<void>}
 */
export async function stopDialogMode(agent, reason = 'watchdog_restart') {
    await stopAgentDialogLoopAuthorized(agent, reason);
    log('INFO', `[LlmBridgeClient] Modo diálogo encerrado (reason=${reason}).`);
}
