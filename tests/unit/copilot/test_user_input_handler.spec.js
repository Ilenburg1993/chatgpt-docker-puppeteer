// @ts-check

import { beforeEach, describe, expect, it, vi } from 'vitest';

const persistStateWithPolicy = vi.fn(async () => ({ ok: true, value: undefined }));

vi.mock('../../../src/copilot/agent/lifecycle/state-io.js', () => ({
    persistStateWithPolicy,
}));

import { handleUserInputRequest } from '../../../src/copilot/agent/dialog/user-input-handler.js';

function createCtx(/** @type {boolean} */ dialogLoopActive) {
    return {
        isDialogLoopActive: () => dialogLoopActive,
        handleProtocolInput: vi.fn(),
        setStatus: vi.fn(),
        setPendingQuestion: vi.fn(),
        trackBackgroundTask: vi.fn(async (task) => {
            await task;
        }),
        emit: vi.fn(() => true),
    };
}

describe('agent/dialog/user-input-handler', () => {
    beforeEach(() => {
        persistStateWithPolicy.mockClear();
    });

    it('classifica READY como ready e persiste metadados semânticos', async () => {
        const ctx = createCtx(true);
        const promise = handleUserInputRequest(
            { question: 'READY: aguardando próxima mensagem', allowFreeform: true },
            ctx,
        );

        expect(ctx.handleProtocolInput).toHaveBeenCalledWith({ question: 'READY: aguardando próxima mensagem' });

        const pending = ctx.setPendingQuestion.mock.calls[0]?.[0];
        expect(pending.kind).toBe('ready');
        expect(pending.protocolControlled).toBe(true);

        expect(persistStateWithPolicy).toHaveBeenCalledWith(
            expect.objectContaining({
                pendingQuestion: 'READY: aguardando próxima mensagem',
                pendingQuestionMeta: expect.objectContaining({ kind: 'ready', protocolControlled: true }),
            }),
            { label: 'question.persist.pending' },
        );

        pending.resolve('ok');
        await expect(promise).resolves.toEqual({ answer: 'ok', wasFreeform: true });
    });

    it('não persiste REPLY transitório do dialog loop', async () => {
        const ctx = createCtx(true);
        const promise = handleUserInputRequest({ question: 'REPLY: resposta curta', allowFreeform: true }, ctx);

        const pending = ctx.setPendingQuestion.mock.calls[0]?.[0];
        expect(pending.kind).toBe('reply');
        expect(persistStateWithPolicy).not.toHaveBeenCalled();

        pending.resolve('next');
        await expect(promise).resolves.toEqual({ answer: 'next', wasFreeform: true });
    });

    it('fora do dialog loop, trata ask_user como question e persiste metadados', async () => {
        const ctx = createCtx(false);
        const promise = handleUserInputRequest(
            { question: 'Qual o próximo passo?', allowFreeform: true, choices: ['A', 'B'] },
            ctx,
        );

        const pending = ctx.setPendingQuestion.mock.calls[0]?.[0];
        expect(pending.kind).toBe('question');
        expect(pending.protocolControlled).toBe(false);
        expect(persistStateWithPolicy).toHaveBeenCalledWith(
            expect.objectContaining({
                pendingQuestion: 'Qual o próximo passo?',
                pendingQuestionMeta: expect.objectContaining({
                    kind: 'question',
                    protocolControlled: false,
                    choices: ['A', 'B'],
                }),
            }),
            { label: 'question.persist.pending' },
        );

        pending.resolve('A');
        await expect(promise).resolves.toEqual({ answer: 'A', wasFreeform: true });
    });
});
