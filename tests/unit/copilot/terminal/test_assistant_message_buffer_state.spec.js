// @ts-check

import { describe, expect, it } from 'vitest';

import {
    clearTerminalBufferedAssistantMessages,
    readTerminalBufferedAssistantMessages,
    recordTerminalBufferedAssistantMessage,
    takeLatestTerminalBufferedAssistantMessage,
} from '../../../../src/copilot/terminal/state/assistant-message-buffer-state.js';

describe('terminal/state/assistant-message-buffer-state', () => {
    it('preserva a ultima assistant.message recebida durante turno ativo', () => {
        clearTerminalBufferedAssistantMessages();

        recordTerminalBufferedAssistantMessage({ content: ' primeira ', kind: 'message' });
        recordTerminalBufferedAssistantMessage({ content: 'segunda', kind: 'reply', source: 'sdk/test' });

        expect(readTerminalBufferedAssistantMessages()).toHaveLength(2);
        expect(takeLatestTerminalBufferedAssistantMessage()).toEqual(
            expect.objectContaining({
                content: 'segunda',
                kind: 'reply',
                source: 'sdk/test',
            }),
        );
        expect(readTerminalBufferedAssistantMessages()).toHaveLength(0);
    });

    it('ignora conteudo vazio para evitar falso fallback visual', () => {
        clearTerminalBufferedAssistantMessages();

        expect(recordTerminalBufferedAssistantMessage({ content: '   ' })).toBeNull();
        expect(takeLatestTerminalBufferedAssistantMessage()).toBeNull();
    });
});

