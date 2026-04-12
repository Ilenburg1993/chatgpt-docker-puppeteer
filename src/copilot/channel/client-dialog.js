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
 * @returns {{ replyHandler: ((evt: { reply?: string }) => void) | null; cleanup: () => void }}
 */
export function registerDialogListeners(agent, opts) {
    const { onReady, onReply, onStopped } = opts;
    const replyHandler = onReply ? (/** @type {{ reply?: string }} */ evt) => onReply(evt.reply ?? '') : null;

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
        await agent.startDialogLoop(bootPrompt);
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
    const { timeout = 60_000, onDelta, onReasoning } = opts;

    const onDeltaTemp = onDelta
        ? (/** @type {{ chunk?: string }} */ evt) => {
              if (evt.chunk) onDelta(evt.chunk);
          }
        : null;
    if (onDeltaTemp) agent.on(EMITTER_TASK_DELTA, onDeltaTemp);

    const onReasoningTemp = onReasoning
        ? (/** @type {{ chunk?: string; reasoningId?: string | null }} */ evt) => {
              if (evt.chunk) onReasoning(evt.chunk, evt.reasoningId ?? null);
          }
        : null;
    if (onReasoningTemp) agent.on(EMITTER_TASK_REASONING, onReasoningTemp);

    try {
        return await agent.sendDialogTurn(message, { timeout });
    } finally {
        if (onDeltaTemp) agent.off('task.delta', onDeltaTemp);
        if (onReasoningTemp) agent.off('task.reasoning', onReasoningTemp);
    }
}

/**
 * Encerra o modo de diálogo direto.
 *
 * @param {BridgeAgentLike} agent
 * @param {string} [reason='watchdog_restart'] Default is `'watchdog_restart'`
 * @returns {Promise<void>}
 */
export async function stopDialogMode(agent, reason = 'watchdog_restart') {
    await agent.stopDialogLoop({ authorized: true, reason });
    log('INFO', `[LlmBridgeClient] Modo diálogo encerrado (reason=${reason}).`);
}
