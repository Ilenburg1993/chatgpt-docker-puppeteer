// @ts-check

import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtimeMocks = vi.hoisted(() => ({
    answerTerminalPendingQuestion: vi.fn(() => true),
    readTerminalRuntimeState: vi.fn(),
}));

vi.mock('../../../../src/copilot/terminal/frontend/llm-b-runtime.js', () => runtimeMocks);

import { tryAnswerTerminalPendingQuestionInput } from '../../../../src/copilot/terminal/pending-question-answer.js';

describe('terminal/pending-question-answer', () => {
    beforeEach(() => {
        vi.clearAllMocks();
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
});
