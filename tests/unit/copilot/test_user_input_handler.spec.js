// @ts-check

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    persistStateWithPolicy: vi.fn(async () => ({ ok: true, value: undefined })),
}));

vi.mock('../../../src/copilot/agent/lifecycle/state-io.js', () => ({
    persistStateWithPolicy: mocks.persistStateWithPolicy,
}));

import { handleUserInputRequest } from '../../../src/copilot/agent/dialog/user-input-handler.js';

function createCtx(/** @type {boolean} */ dialogLoopActive) {
    return {
        isDialogLoopActive: () => dialogLoopActive,
        shouldHandleProtocolInput: vi.fn((question) => dialogLoopActive || question.startsWith('READY:')),
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
        mocks.persistStateWithPolicy.mockClear();
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

        expect(mocks.persistStateWithPolicy).toHaveBeenCalledWith(
            expect.objectContaining({
                pendingQuestion: 'READY: aguardando próxima mensagem',
                pendingQuestionMeta: expect.objectContaining({ kind: 'ready', protocolControlled: true }),
            }),
            { label: 'question.persist.pending' },
        );

        pending.resolve('ok');
        await expect(promise).resolves.toEqual({ answer: 'ok', wasFreeform: true });
    });

    it('não persiste REPLY transitório do dialog loop e responde automaticamente ao SDK', async () => {
        const ctx = createCtx(true);
        const promise = handleUserInputRequest({ question: 'REPLY: resposta curta', allowFreeform: true }, ctx);

        expect(ctx.setPendingQuestion).not.toHaveBeenCalled();
        expect(mocks.persistStateWithPolicy).not.toHaveBeenCalled();
        await expect(promise).resolves.toEqual({
            answer: expect.stringContaining('CONTINUE_DIALOG_LOOP'),
            wasFreeform: false,
        });
    });

    it('trata READY tardio como protocolo quando shouldHandleProtocolInput autoriza recovery', async () => {
        const ctx = createCtx(false);
        const promise = handleUserInputRequest(
            { question: 'READY: recuperado após timeout', allowFreeform: true },
            ctx,
        );

        expect(ctx.shouldHandleProtocolInput).toHaveBeenCalledWith('READY: recuperado após timeout');
        expect(ctx.handleProtocolInput).toHaveBeenCalledWith({ question: 'READY: recuperado após timeout' });

        const pending = ctx.setPendingQuestion.mock.calls[0]?.[0];
        expect(pending.kind).toBe('ready');

        pending.resolve('ok');
        await expect(promise).resolves.toEqual({ answer: 'ok', wasFreeform: true });
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
        expect(mocks.persistStateWithPolicy).toHaveBeenCalledWith(
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
