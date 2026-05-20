// @ts-check

import { beforeEach, describe, expect, it } from 'vitest';
import {
    clearTerminalElicitation,
    clearTerminalPermissions,
    clearTerminalUserInputs,
    getTerminalElicitation,
    listTerminalElicitations,
    pruneTerminalSdkInteractions,
    recordTerminalElicitationCompleted,
    recordTerminalElicitationPending,
    recordTerminalUserInputCompleted,
    recordTerminalUserInputRequested,
    shouldSuppressTerminalAssistantMessageAsUserInputEcho,
} from '../../../../src/copilot/terminal/state/sdk-interactions.js';

describe('terminal/sdk-interactions', () => {
    beforeEach(() => {
        clearTerminalElicitation('all');
        clearTerminalPermissions();
        clearTerminalUserInputs();
    });

    it('preserva pendências vivas e limita histórico concluído em sessões longas', () => {
        const base = Date.now();

        for (let idx = 0; idx < 105; idx += 1) {
            const requestId = `el-${idx}`;
            recordTerminalElicitationPending({
                requestId,
                message: `Pergunta ${idx}`,
                mode: 'form',
                timestamp: base + idx,
            });
            recordTerminalElicitationCompleted({
                requestId,
                action: 'accept',
                content: { ok: true },
                timestamp: base + idx + 1,
            });
        }

        recordTerminalElicitationPending({
            requestId: 'el-pending',
            message: 'Ainda pendente',
            mode: 'form',
            timestamp: base + 200,
        });
        pruneTerminalSdkInteractions(base + 200);

        expect(listTerminalElicitations({ includeCompleted: true })).toHaveLength(101);
        expect(getTerminalElicitation('el-0')).toBeNull();
        expect(getTerminalElicitation('el-104')?.status).toBe('completed');
        expect(getTerminalElicitation('el-pending')?.status).toBe('pending');
    });

    it('gera IDs sintéticos únicos quando o SDK não envia requestId', () => {
        const first = recordTerminalElicitationPending({ message: 'A', mode: 'form' });
        const second = recordTerminalElicitationPending({ message: 'B', mode: 'form' });

        expect(first.id).not.toBe(second.id);
        expect(listTerminalElicitations()).toHaveLength(2);
    });

    it('identifica eco imediato de resposta humana de ask_user em assistant.message', () => {
        const base = Date.now();
        recordTerminalUserInputRequested({
            requestId: 'ask-1',
            question: 'ASK-CANONICAL: responda SIM',
            timestamp: base,
        });
        recordTerminalUserInputCompleted({
            requestId: 'ask-1',
            answer: 'SIM',
            timestamp: base + 100,
        });

        expect(
            shouldSuppressTerminalAssistantMessageAsUserInputEcho({
                content: ' SIM ',
                now: base + 500,
            }),
        ).toBe(true);
        expect(
            shouldSuppressTerminalAssistantMessageAsUserInputEcho({
                content: 'SIM',
                now: base + 20_000,
            }),
        ).toBe(false);
        expect(
            shouldSuppressTerminalAssistantMessageAsUserInputEcho({
                content: 'SIM, recebido.',
                now: base + 500,
            }),
        ).toBe(false);
    });
});
