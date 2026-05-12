// @ts-check

import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtimeMocks = vi.hoisted(() => ({
    answerTerminalPendingQuestion: vi.fn(() => true),
    readTerminalRuntimeState: vi.fn(),
}));

const hookToolMocks = vi.hoisted(() => ({
    hasPendingStructuredUserInputRequests: vi.fn(() => false),
}));

vi.mock('../../../../src/copilot/terminal/frontend/gateways/agent-runtime.js', () => runtimeMocks);
vi.mock('#copilot/sdk', async (importOriginal) => {
    const actual = /** @type {Record<string, unknown>} */ (await importOriginal());
    return {
        ...actual,
        ...hookToolMocks,
    };
});

import { tryAnswerTerminalPendingQuestionInput } from '../../../../src/copilot/terminal/state/pending-question-answer.js';

describe('terminal/pending-question-answer', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        hookToolMocks.hasPendingStructuredUserInputRequests.mockReturnValue(false);
        runtimeMocks.readTerminalRuntimeState.mockReturnValue({
            runtimeId: 'default',
            pendingQuestionKind: 'question',
            pendingQuestionShadowExpired: false,
            pendingQuestion: {
                question: 'Escolha ambiente',
                kind: 'question',
                choices: ['dev', 'prod'],
                askedAt: 1,
                allowFreeform: false,
                protocolControlled: false,
            },
        });
    });

    it('mapeia índice 1-based para choice antes de responder o SDK ask_user', () => {
        const result = tryAnswerTerminalPendingQuestionInput('2', null);

        expect(result).toMatchObject({ routed: true, ok: true, reason: 'answered', answer: 'prod' });
        expect(runtimeMocks.answerTerminalPendingQuestion).toHaveBeenCalledWith('prod', null);
    });

    it('bloqueia resposta livre quando allowFreeform=false', () => {
        const result = tryAnswerTerminalPendingQuestionInput('stage', null);

        expect(result).toMatchObject({ routed: false, ok: false, reason: 'invalid_choice' });
        expect(runtimeMocks.answerTerminalPendingQuestion).not.toHaveBeenCalled();
    });

    it('roteia linha comum para request_user_input pendente quando não há ask_user vivo', () => {
        runtimeMocks.readTerminalRuntimeState.mockReturnValue({
            runtimeId: 'default',
            pendingQuestionKind: null,
            pendingQuestionShadowExpired: false,
            pendingQuestion: null,
        });
        hookToolMocks.hasPendingStructuredUserInputRequests.mockReturnValue(true);

        const result = tryAnswerTerminalPendingQuestionInput('seguir com main', null);

        expect(result).toMatchObject({ routed: true, ok: true, reason: 'answered', answer: 'seguir com main' });
        expect(runtimeMocks.answerTerminalPendingQuestion).toHaveBeenCalledWith('seguir com main', null);
    });

    it('mantém mensagem como turno normal quando não há ask_user nem request_user_input pendentes', () => {
        runtimeMocks.readTerminalRuntimeState.mockReturnValue({
            runtimeId: 'default',
            pendingQuestionKind: null,
            pendingQuestionShadowExpired: false,
            pendingQuestion: null,
        });

        const result = tryAnswerTerminalPendingQuestionInput('nova tarefa', null);

        expect(result).toMatchObject({ routed: false, ok: false, reason: 'no_pending' });
        expect(runtimeMocks.answerTerminalPendingQuestion).not.toHaveBeenCalled();
    });
});
