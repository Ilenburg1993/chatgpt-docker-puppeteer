// @ts-check
/**
 * Facade legado do buffer de `assistant.message`.
 *
 * A materialização canônica do turno vive em `turn-materialization-state.js` e também captura deltas incrementais. Este
 * módulo permanece para compatibilidade com testes/callers antigos enquanto todo fluxo novo usa a API de
 * materialização.
 *
 * @module copilot/terminal/state/assistant-message-buffer-state
 */

import {
    clearTerminalTurnMaterialization,
    readTerminalTurnAssistantMessages,
    recordTerminalTurnAssistantMessage,
    takeLatestTerminalTurnAssistantMessage,
} from './turn-materialization-state.js';

/**
 * @typedef {{
 *     content: string;
 *     kind: string;
 *     source: string;
 *     timestamp: number;
 * }} BufferedAssistantMessage
 */

/**
 * @returns {void}
 */
export function clearTerminalBufferedAssistantMessages() {
    clearTerminalTurnMaterialization();
}

/**
 * @param {{ content: string; kind?: string; source?: string; timestamp?: number }} input
 * @returns {BufferedAssistantMessage | null}
 */
export function recordTerminalBufferedAssistantMessage(input) {
    return recordTerminalTurnAssistantMessage(input);
}

/**
 * @returns {BufferedAssistantMessage[]}
 */
export function readTerminalBufferedAssistantMessages() {
    return readTerminalTurnAssistantMessages();
}

/**
 * Retorna a última mensagem textual capturada e limpa o buffer.
 *
 * @returns {BufferedAssistantMessage | null}
 */
export function takeLatestTerminalBufferedAssistantMessage() {
    return takeLatestTerminalTurnAssistantMessage();
}
