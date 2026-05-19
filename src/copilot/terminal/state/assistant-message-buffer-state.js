// @ts-check
/**
 * Buffer transitório de mensagens `assistant.message` recebidas durante um turno explícito.
 *
 * O renderer visual não pode descartar mensagens só porque `busy=true`: em algumas versões/rotas do SDK, o retorno
 * síncrono do turno pode vir vazio enquanto o evento `assistant.message` contém a resposta textual real.
 *
 * @module copilot/terminal/state/assistant-message-buffer-state
 */

const MAX_BUFFERED_ASSISTANT_MESSAGES = 8;

/**
 * @typedef {{
 *     content: string;
 *     kind: string;
 *     source: string;
 *     timestamp: number;
 * }} BufferedAssistantMessage
 */

/** @type {BufferedAssistantMessage[]} */
let _bufferedAssistantMessages = [];

/**
 * @returns {void}
 */
export function clearTerminalBufferedAssistantMessages() {
    _bufferedAssistantMessages = [];
}

/**
 * @param {{ content: string; kind?: string; source?: string; timestamp?: number }} input
 * @returns {BufferedAssistantMessage | null}
 */
export function recordTerminalBufferedAssistantMessage(input) {
    const content = input.content.trim();
    if (!content) return null;
    const entry = {
        content,
        kind: input.kind ?? 'message',
        source: input.source ?? 'sdk/assistant.message',
        timestamp: input.timestamp ?? Date.now(),
    };
    _bufferedAssistantMessages.push(entry);
    if (_bufferedAssistantMessages.length > MAX_BUFFERED_ASSISTANT_MESSAGES) {
        _bufferedAssistantMessages = _bufferedAssistantMessages.slice(-MAX_BUFFERED_ASSISTANT_MESSAGES);
    }
    return { ...entry };
}

/**
 * @returns {BufferedAssistantMessage[]}
 */
export function readTerminalBufferedAssistantMessages() {
    return _bufferedAssistantMessages.map((entry) => ({ ...entry }));
}

/**
 * Retorna a última mensagem textual capturada e limpa o buffer.
 *
 * @returns {BufferedAssistantMessage | null}
 */
export function takeLatestTerminalBufferedAssistantMessage() {
    const latest = _bufferedAssistantMessages.at(-1) ?? null;
    clearTerminalBufferedAssistantMessages();
    return latest ? { ...latest } : null;
}

