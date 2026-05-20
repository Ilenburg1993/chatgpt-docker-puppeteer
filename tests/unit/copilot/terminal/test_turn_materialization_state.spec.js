// @ts-check

import { describe, expect, it } from 'vitest';

import {
    beginTerminalTurnMaterialization,
    clearTerminalTurnMaterialization,
    completeTerminalTurnMaterialization,
    readTerminalTurnMaterialization,
    recordTerminalTurnAssistantMessage,
    recordTerminalTurnDelta,
    shouldSuppressTerminalAssistantMessageAsMaterializedTurn,
    shouldSuppressTerminalTaskDeltaAsMaterializedDialog,
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

    it('preserva identidade causal dos deltas no snapshot do turno', () => {
        clearTerminalTurnMaterialization();
        beginTerminalTurnMaterialization({ turnId: '42', timestamp: 1000 });
        recordTerminalTurnDelta({
            chunk: 'abc',
            source: 'dialog/onDelta',
            sdkSource: 'sdk.assistant.message_delta',
            streamId: 's1',
            chunkSeq: 3,
            eventId: 'evt-1',
            causationId: 'evt-1',
            timestamp: 1001,
        });

        const snapshot = readTerminalTurnMaterialization();
        expect(snapshot?.deltaSlices.at(-1)).toEqual(
            expect.objectContaining({
                chunk: 'abc',
                source: 'dialog/onDelta',
                sdkSource: 'sdk.assistant.message_delta',
                streamId: 's1',
                chunkSeq: 3,
                eventId: 'evt-1',
                causationId: 'evt-1',
            }),
        );
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

    it('suprime assistant.message equivalente a deltas ainda ativos no turno', () => {
        clearTerminalTurnMaterialization();
        beginTerminalTurnMaterialization({ turnId: 'live-1', timestamp: 1000 });
        recordTerminalTurnDelta({ chunk: 'olá, ', timestamp: 1001 });
        recordTerminalTurnDelta({ chunk: 'mundo', timestamp: 1002 });

        expect(
            shouldSuppressTerminalAssistantMessageAsMaterializedTurn({
                content: 'olá, mundo',
                turnId: 'live-1',
                now: 1003,
            }),
        ).toBe(true);
        expect(
            shouldSuppressTerminalAssistantMessageAsMaterializedTurn({
                content: 'conteúdo diferente',
                turnId: 'live-1',
                now: 1003,
            }),
        ).toBe(false);
    });

    it('suprime turn_end parcial quando o delta canônico já contém o mesmo texto', () => {
        clearTerminalTurnMaterialization();
        beginTerminalTurnMaterialization({ turnId: 'live-prefix', timestamp: 1000 });
        recordTerminalTurnDelta({
            chunk: 'DELTA-CANONICAL-1: texto já exibido no terminal. DELTA-CANONICAL-2: continuação visível.',
            source: 'dialog/onDelta',
            timestamp: 1001,
        });

        expect(
            shouldSuppressTerminalAssistantMessageAsMaterializedTurn({
                content: 'DELTA-CANONICAL-1: texto já exibido no terminal.',
                turnId: 'live-prefix',
                now: 1002,
            }),
        ).toBe(true);
    });

    it('suprime assistant.message equivalente a turno recém-concluído', () => {
        clearTerminalTurnMaterialization();
        beginTerminalTurnMaterialization({ turnId: 'done-1', timestamp: 1000 });
        recordTerminalTurnDelta({ chunk: 'resposta final', timestamp: 1001 });
        completeTerminalTurnMaterialization({
            directReply: 'resposta final',
            directSource: 'runtime_return',
            timestamp: 1002,
        });

        expect(
            shouldSuppressTerminalAssistantMessageAsMaterializedTurn({
                content: ' resposta   final ',
                turnId: 'done-1',
                now: 1003,
            }),
        ).toBe(true);
        expect(
            shouldSuppressTerminalAssistantMessageAsMaterializedTurn({
                content: 'resposta final',
                turnId: 'outro-turno',
                now: 1003,
            }),
        ).toBe(false);
    });

    it('suprime task.delta tardio quando dialog.delta já materializou o mesmo trecho', () => {
        clearTerminalTurnMaterialization();
        beginTerminalTurnMaterialization({ turnId: 'live-task', timestamp: 1000 });
        recordTerminalTurnDelta({
            chunk: '✅ **Teste canônico validado**',
            source: 'dialog/onDelta',
            timestamp: 1001,
        });

        expect(shouldSuppressTerminalTaskDeltaAsMaterializedDialog({ chunk: 'Teste canônico' })).toBe(true);
        expect(shouldSuppressTerminalTaskDeltaAsMaterializedDialog({ chunk: 'conteúdo novo' })).toBe(false);
    });

    it('não suprime task.delta quando ele é a única fonte pública disponível', () => {
        clearTerminalTurnMaterialization();
        expect(shouldSuppressTerminalTaskDeltaAsMaterializedDialog({ chunk: 'fallback vivo' })).toBe(false);

        beginTerminalTurnMaterialization({ turnId: 'task-only', timestamp: 1000 });
        recordTerminalTurnDelta({
            chunk: 'fallback vivo',
            source: 'public-assistant-stream',
            timestamp: 1001,
        });

        expect(shouldSuppressTerminalTaskDeltaAsMaterializedDialog({ chunk: 'fallback vivo' })).toBe(false);
    });
});
