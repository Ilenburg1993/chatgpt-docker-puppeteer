// @ts-check
/**
 * @file Gateway: dialog.
 *
 *   Wraps bridge LLM-A ↔ LLM-B dialog operations: history feed, turn count, dialog mode start/stop, and single turn
 *   execution. Isolates `#copilot/channel` (llmBridgeClient).
 */

import { llmBridgeClient } from '#copilot/channel';

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
 * }} opts
 * @returns {Promise<string>}
 */
export async function runTerminalDialogTurn(enrichedMessage, opts) {
    return llmBridgeClient.dialogTurn(enrichedMessage, opts);
}
