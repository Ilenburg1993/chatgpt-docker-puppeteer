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
    terminalPermissionModeSkipsSdkPrompts,
} from '../../../../src/copilot/terminal/state/sdk-interactions.js';

describe('terminal/sdk-interactions', () => {
    beforeEach(() => {
        clearTerminalElicitation('all');
        clearTerminalPermissions();
        clearTerminalUserInputs();
    });

    it('deriva quando o modo de permissão pula prompts SDK', () => {
        expect(terminalPermissionModeSkipsSdkPrompts('approve_all')).toBe(true);
        expect(terminalPermissionModeSkipsSdkPrompts('audit_only')).toBe(true);
        expect(terminalPermissionModeSkipsSdkPrompts('selective')).toBe(false);
        expect(terminalPermissionModeSkipsSdkPrompts('unknown')).toBe(true);
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

    it('limita pendências abandonadas e remove pendências expiradas', () => {
        const base = Date.now();
        for (let idx = 0; idx < 140; idx += 1) {
            recordTerminalElicitationPending({
                requestId: `pending-${idx}`,
                message: `Pergunta ${idx}`,
                mode: 'form',
                timestamp: base + idx,
            });
        }

        expect(listTerminalElicitations()).toHaveLength(128);
        expect(getTerminalElicitation('pending-0')).toBeNull();

        pruneTerminalSdkInteractions(base + 25 * 60 * 60_000);
        expect(listTerminalElicitations()).toHaveLength(0);
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
