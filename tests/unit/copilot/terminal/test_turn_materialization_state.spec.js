// @ts-check

import { describe, expect, it } from 'vitest';

import {
    beginTerminalTurnMaterialization,
    clearTerminalTurnMaterialization,
    completeTerminalTurnMaterialization,
    readTerminalTurnMaterialization,
    recordTerminalTurnAssistantMessage,
    recordTerminalTurnDelta,
} from '../../../../src/copilot/terminal/state/turn-materialization-state.js';

describe('terminal/state/turn-materialization-state', () => {
    it('prioriza reply direto acima de assistant.message e delta', () => {
        clearTerminalTurnMaterialization();
        beginTerminalTurnMaterialization({ turnId: '42', timestamp: 1000 });
        recordTerminalTurnDelta({ chunk: 'delta parcial', timestamp: 1001 });
        recordTerminalTurnAssistantMessage({ content: 'mensagem sdk', kind: 'reply', timestamp: 1002 });

        const materialized = completeTerminalTurnMaterialization({
            directReply: 'reply direto',
            directSource: 'transport_mirror',
            timestamp: 1003,
        });

        expect(materialized.reply).toBe('reply direto');
        expect(materialized.source).toBe('direct_reply');
        expect(materialized.sourceDetail).toBe('transport_mirror');
        expect(materialized.diagnostics.assistantMessageCount).toBe(1);
        expect(materialized.diagnostics.deltaChars).toBe('delta parcial'.length);
        expect(readTerminalTurnMaterialization()).toBeNull();
    });

    it('usa assistant.message quando o transporte direto vem vazio', () => {
        clearTerminalTurnMaterialization();
        beginTerminalTurnMaterialization();
        recordTerminalTurnDelta({ chunk: 'delta parcial' });
        recordTerminalTurnAssistantMessage({ content: ' resposta via evento ', source: 'sdk/assistant.message' });

        const materialized = completeTerminalTurnMaterialization({ directReply: '   ', directSource: 'empty' });

        expect(materialized.reply).toBe('resposta via evento');
        expect(materialized.source).toBe('assistant_message');
        expect(materialized.sourceDetail).toBe('sdk/assistant.message');
    });

    it('promove deltas incrementais para resposta final quando não há mensagem final', () => {
        clearTerminalTurnMaterialization();
        beginTerminalTurnMaterialization();
        recordTerminalTurnDelta({ chunk: 'olá, ' });
        recordTerminalTurnDelta({ chunk: 'mundo\n' });

        const materialized = completeTerminalTurnMaterialization({ directReply: null, directSource: 'empty' });

        expect(materialized.reply).toBe('olá, mundo');
        expect(materialized.source).toBe('stream_delta');
        expect(materialized.diagnostics.deltaSlices).toBe(2);
    });

    it('anexa turnId do SDK ao turno explícito sem apagar deltas já recebidos', () => {
        clearTerminalTurnMaterialization();
        beginTerminalTurnMaterialization({ timestamp: 1000, source: 'terminal/explicit-turn' });
        recordTerminalTurnDelta({ chunk: 'antes do id', timestamp: 1001 });
        const snapshot = beginTerminalTurnMaterialization({
            turnId: 'sdk-turn',
            timestamp: 1002,
            source: 'sdk/assistant.turn_start',
        });

        expect(snapshot.turnId).toBe('sdk-turn');
        expect(snapshot.deltaChars).toBe('antes do id'.length);
    });
});
