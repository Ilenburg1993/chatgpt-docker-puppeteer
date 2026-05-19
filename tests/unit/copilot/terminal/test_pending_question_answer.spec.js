// @ts-check

import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtimeMocks = vi.hoisted(() => ({
    answerTerminalPendingQuestion: vi.fn(() => true),
    readTerminalRuntimeState: vi.fn(),
}));

const hookToolMocks = vi.hoisted(() => ({
    hasTerminalPendingStructuredUserInputRequests: vi.fn(() => false),
    listTerminalPendingStructuredUserInputs: vi.fn(() => []),
}));

vi.mock('../../../../src/copilot/terminal/frontend/gateways/agent-runtime.js', () => runtimeMocks);
vi.mock('../../../../src/copilot/terminal/frontend/gateways/sdk-session.js', async (importOriginal) => {
    const actual = /** @type {Record<string, unknown>} */ (await importOriginal());
    return {
        ...actual,
        ...hookToolMocks,
    };
});

import {
    shouldConsumeTerminalPendingAnswerInput,
    tryAnswerTerminalPendingQuestionInput,
} from '../../../../src/copilot/terminal/state/pending-question-answer.js';

describe('terminal/pending-question-answer', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        hookToolMocks.hasTerminalPendingStructuredUserInputRequests.mockReturnValue(false);
        hookToolMocks.listTerminalPendingStructuredUserInputs.mockReturnValue([]);
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
        expect(result.pendingQuestionChoices).toEqual(['dev', 'prod']);
        expect(shouldConsumeTerminalPendingAnswerInput(result)).toBe(true);
        expect(runtimeMocks.answerTerminalPendingQuestion).not.toHaveBeenCalled();
    });

    it('aceita choice com diferenca de caixa quando o match e inequivoco', () => {
        const result = tryAnswerTerminalPendingQuestionInput('PROD', null);

        expect(result).toMatchObject({ routed: true, ok: true, reason: 'answered', answer: 'prod' });
        expect(runtimeMocks.answerTerminalPendingQuestion).toHaveBeenCalledWith('prod', null);
    });

    it('roteia linha comum para request_user_input pendente quando não há ask_user vivo', () => {
        runtimeMocks.readTerminalRuntimeState.mockReturnValue({
            runtimeId: 'default',
            pendingQuestionKind: null,
            pendingQuestionShadowExpired: false,
            pendingQuestion: null,
        });
        hookToolMocks.hasTerminalPendingStructuredUserInputRequests.mockReturnValue(true);
        hookToolMocks.listTerminalPendingStructuredUserInputs.mockReturnValue([
            {
                requestId: 'rui-1',
                question: 'Escolha branch',
                choices: [],
                allowFreeform: true,
                createdAt: 1,
                sessionId: null,
                toolCallId: null,
                data: {},
            },
        ]);

        const result = tryAnswerTerminalPendingQuestionInput('seguir com main', null);

        expect(result).toMatchObject({ routed: true, ok: true, reason: 'answered', answer: 'seguir com main' });
        expect(runtimeMocks.answerTerminalPendingQuestion).toHaveBeenCalledWith('seguir com main', null);
    });

    it('normaliza choice obrigatoria de request_user_input pendente antes de responder', () => {
        runtimeMocks.readTerminalRuntimeState.mockReturnValue({
            runtimeId: 'default',
            pendingQuestionKind: null,
            pendingQuestionShadowExpired: false,
            pendingQuestion: null,
        });
        hookToolMocks.hasTerminalPendingStructuredUserInputRequests.mockReturnValue(true);
        hookToolMocks.listTerminalPendingStructuredUserInputs.mockReturnValue([
            {
                requestId: 'rui-1',
                question: 'Escolha cor',
                choices: ['azul', 'verde'],
                allowFreeform: false,
                createdAt: 1,
                sessionId: null,
                toolCallId: null,
                data: {},
            },
        ]);

        const result = tryAnswerTerminalPendingQuestionInput('2', null);

        expect(result).toMatchObject({
            routed: true,
            ok: true,
            reason: 'answered',
            answer: 'verde',
            pendingQuestionText: 'Escolha cor',
            pendingQuestionChoices: ['azul', 'verde'],
        });
        expect(runtimeMocks.answerTerminalPendingQuestion).toHaveBeenCalledWith('verde', null);
    });

    it('consome escolha invalida de request_user_input obrigatorio sem abrir turno novo', () => {
        runtimeMocks.readTerminalRuntimeState.mockReturnValue({
            runtimeId: 'default',
            pendingQuestionKind: null,
            pendingQuestionShadowExpired: false,
            pendingQuestion: null,
        });
        hookToolMocks.hasTerminalPendingStructuredUserInputRequests.mockReturnValue(true);
        hookToolMocks.listTerminalPendingStructuredUserInputs.mockReturnValue([
            {
                requestId: 'rui-1',
                question: 'Escolha cor',
                choices: ['azul', 'verde'],
                allowFreeform: false,
                createdAt: 1,
                sessionId: null,
                toolCallId: null,
                data: {},
            },
        ]);

        const result = tryAnswerTerminalPendingQuestionInput('vermelho', null);

        expect(result).toMatchObject({ routed: false, ok: false, reason: 'invalid_choice' });
        expect(shouldConsumeTerminalPendingAnswerInput(result)).toBe(true);
        expect(runtimeMocks.answerTerminalPendingQuestion).not.toHaveBeenCalled();
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
        expect(shouldConsumeTerminalPendingAnswerInput(result)).toBe(false);
        expect(runtimeMocks.answerTerminalPendingQuestion).not.toHaveBeenCalled();
    });
});
