// @ts-check
/**
 * @file Gateway: dialog.
 *
 *   Wraps bridge LLM-A ↔ LLM-B dialog operations: history feed, turn count, dialog mode start/stop, and single turn
 *   execution. Isolates `#copilot/channel` (llmBridgeClient).
 */

import { llmBridgeClient } from '#copilot/channel';
import { clearTerminalTranscriptTurns, readTerminalTranscriptTurns } from '../../state/events/index.js';

// ---------------------------------------------------------------------------
// History feed
// ---------------------------------------------------------------------------

/**
 * Histórico em memória do transporte LLM-A ↔ LLM-B.
 *
 * @returns {{ role: string; content: string; timestamp?: number }[]}
 */
export function readTerminalHistoryFeed() {
    return /** @type {{ role: string; content: string; timestamp?: number }[]} */ (llmBridgeClient.history ?? []);
}

/**
 * Limpa o histórico em memória do transporte.
 *
 * @returns {void}
 */
export function clearTerminalHistoryFeed() {
    llmBridgeClient.clearHistory();
}

/**
 * Histórico local de transcripts do terminal fora do bridge.
 *
 * @returns {import('../../state/transcript-state.js').TerminalTranscriptTurn[]}
 */
export function readTerminalTranscriptFeed() {
    return readTerminalTranscriptTurns();
}

/**
 * Limpa o histórico local de transcripts do terminal fora do bridge.
 *
 * @returns {void}
 */
export function clearTerminalTranscriptFeed() {
    clearTerminalTranscriptTurns();
}

/**
 * Injeta uma seed no histórico do transporte quando a implementação suportar isso.
 *
 * @param {'assistant' | 'user'} role
 * @param {string} content
 * @returns {void}
 */
export function seedTerminalHistoryFeed(role, content) {
    if (typeof llmBridgeClient.seedHistory === 'function') {
        llmBridgeClient.seedHistory(role, content);
    }
}

/**
 * Contagem de turnos do transporte.
 *
 * @returns {number}
 */
export function readTerminalTurnCount() {
    return Number(llmBridgeClient.turnCount ?? 0);
}

// ---------------------------------------------------------------------------
// Dialog mode
// ---------------------------------------------------------------------------

/**
 * Inicia o dialog mode do bridge.
 *
 * @param {string | undefined} bootPrompt
 * @param {{ onReady?: () => void; resumeSessionAttach?: boolean }} [opts]
 * @returns {Promise<void>}
 */
export async function startTerminalDialogMode(bootPrompt, opts = {}) {
    await llmBridgeClient.startDialogMode(bootPrompt, opts);
}

/**
 * Para o dialog mode do bridge.
 *
 * @returns {Promise<void>}
 */
export async function stopTerminalDialogMode() {
    await llmBridgeClient.stopDialogMode();
}

/**
 * Envia um turno ao bridge de diálogo.
 *
 * @param {string} enrichedMessage
 * @param {{
 *     timeout: number | null;
 *     onDelta: (chunk: string) => void;
 *     onReasoning?: (chunk: string, reasoningId: string | null) => void;
 *     requestHeaders?: Record<string, string>;
 * }} opts
 * @returns {Promise<string>}
 */
export async function runTerminalDialogTurn(enrichedMessage, opts) {
    const requestHeaders = opts.requestHeaders || {};
    if (Object.keys(requestHeaders).length > 0) {
        const agentStatus =
            typeof llmBridgeClient.getAgentStatus === 'function' ? llmBridgeClient.getAgentStatus() : null;
        const hadDialogLoop = Boolean(agentStatus?.dialogLoopActive || agentStatus?.dialogPaused);
        if (hadDialogLoop) {
            await llmBridgeClient.stopDialogMode('authorized_stop');
        }
        try {
            const onReasoningCb = opts.onReasoning;
            const onDelta = opts.onDelta
                ? /** @type {(chunk: string, taskId: string) => void} */ ((chunk) => opts.onDelta(chunk))
                : undefined;
            const onReasoning = onReasoningCb
                ? /** @type {(chunk: string, reasoningId: string | null, taskId: string) => void} */ (
                      (chunk, reasoningId) => onReasoningCb(chunk, reasoningId)
                  )
                : undefined;
            const chatOpts = {
                timeoutMs: opts.timeout,
                ...(onDelta ? { onDelta } : {}),
                ...(onReasoning ? { onReasoning } : {}),
                requestHeaders,
            };
            const result = await llmBridgeClient.chat(enrichedMessage, chatOpts);
            return result.response;
        } finally {
            if (hadDialogLoop) {
                try {
                    await llmBridgeClient.startDialogMode(undefined, { resumeSessionAttach: true });
                } catch {
                    // A reanexação é best-effort aqui; o watchdog/controle local podem recuperar a seguir.
                }
            }
        }
    }
    return llmBridgeClient.dialogTurn(enrichedMessage, opts);
}
