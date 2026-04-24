// @ts-check

import { beforeEach, describe, expect, it, vi } from 'vitest';

const getSdkSessionMode = vi.fn(() => 'interactive');
const readTerminalActivitySnapshot = vi.fn(() => ({
    phase: 'turn',
    label: 'Processando mensagem',
    detail: 'detalhe',
    source: 'dialog',
    severity: 'info',
    progress: null,
    toolName: null,
    startedAt: 1,
    updatedAt: 2,
    ageMs: 1000,
}));
const readTerminalRuntimeState = vi.fn(() => ({
    model: 'gpt-5-mini',
    reasoningEffort: 'high',
    status: 'idle',
    sessionId: 's1',
    dialogLoopActive: true,
    dialogPaused: false,
    queueSize: 0,
    pendingQuestion: null,
    pendingQuestionKind: null,
    pendingQuestionShadow: null,
    pendingQuestionShadowKind: null,
    pendingQuestionShadowState: null,
    pendingQuestionShadowExpired: false,
    pendingQuestionShadowAgeMs: null,
    pendingQuestionShadowExpiresAt: null,
    pendingQuestionShadowRemainingMs: null,
}));

vi.mock('../../../../src/copilot/terminal/frontend/llm-b-runtime.js', () => ({
    readTerminalRuntimeState,
    readTerminalDialogStreamMeta: vi.fn(() => ({ model: 'gpt-5-mini', reasoningEffort: 'high' })),
}));

vi.mock('../../../../src/copilot/terminal/activity-state.js', () => ({
    readTerminalActivitySnapshot,
}));

vi.mock('../../../../src/copilot/presentation/runtime-ui-state-store.js', () => ({
    getSdkSessionMode,
}));

describe('terminal/dialog/output buildUserPrompt', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('inclui modelo e reasoning no prompt', async () => {
        const { buildUserPrompt } = await import('../../../../src/copilot/terminal/dialog/output.js');
        const prompt = buildUserPrompt();

        expect(prompt).toContain('gpt-5-mini');
        expect(prompt).toContain('high');
    });

    it('inclui marcador MODE quando o SDK reporta plan mode', async () => {
        getSdkSessionMode.mockReturnValue('plan');
        const { buildUserPrompt } = await import('../../../../src/copilot/terminal/dialog/output.js');
        const prompt = buildUserPrompt();

        expect(prompt).toContain('[MODE:PLAN]');
    });

    it('inclui marcador ASK quando há pergunta viva', async () => {
        readTerminalRuntimeState.mockReturnValueOnce(
            /** @type {any} */ ({
                ...readTerminalRuntimeState(),
                pendingQuestion: { question: 'Q', kind: 'question' },
                pendingQuestionKind: 'question',
            }),
        );
        const { buildUserPrompt } = await import('../../../../src/copilot/terminal/dialog/output.js');
        const prompt = buildUserPrompt();

        expect(prompt).toContain('[ASK:QUESTION]');
    });

    it('não mostra READY como ASK no prompt normal', async () => {
        readTerminalRuntimeState.mockReturnValueOnce(
            /** @type {any} */ ({
                ...readTerminalRuntimeState(),
                pendingQuestion: { question: 'READY: aguardando próxima mensagem', kind: 'ready' },
                pendingQuestionKind: 'ready',
            }),
        );
        const { buildUserPrompt } = await import('../../../../src/copilot/terminal/dialog/output.js');
        const prompt = buildUserPrompt();

        expect(prompt).not.toContain('[ASK:READY]');
        expect(prompt).toContain('gpt-5-mini');
        expect(prompt).toContain('high');
    });

    it('inclui marcador SHADOW quando só há shadow expirada', async () => {
        readTerminalRuntimeState.mockReturnValueOnce(
            /** @type {any} */ ({
                ...readTerminalRuntimeState(),
                reasoningEffort: 'off',
                pendingQuestionShadow: { question: 'READY' },
                pendingQuestionShadowState: 'expired',
                pendingQuestionShadowExpired: true,
            }),
        );
        const { buildUserPrompt } = await import('../../../../src/copilot/terminal/dialog/output.js');
        const prompt = buildUserPrompt();

        expect(prompt).toContain('[SHADOW:EXPIRED]');
        expect(prompt).toContain('off');
    });

    it('inclui marcador PAUSED quando dialog loop está pausado', async () => {
        readTerminalRuntimeState.mockReturnValueOnce({
            ...readTerminalRuntimeState(),
            dialogPaused: true,
        });
        const { buildUserPrompt } = await import('../../../../src/copilot/terminal/dialog/output.js');
        const prompt = buildUserPrompt();

        expect(prompt).toContain('[PAUSED]');
    });

    it('inclui marcador NOLOOP e fila quando aplicável', async () => {
        readTerminalRuntimeState.mockReturnValueOnce({
            ...readTerminalRuntimeState(),
            dialogLoopActive: false,
            queueSize: 2,
        });
        const { buildUserPrompt } = await import('../../../../src/copilot/terminal/dialog/output.js');
        const prompt = buildUserPrompt();

        expect(prompt).toContain('[NOLOOP]');
        expect(prompt).toContain('[Q:2]');
    });

    it('exporta prompt de espera com fase/label/modelo', async () => {
        const { buildWaitingPrompt } = await import('../../../../src/copilot/terminal/dialog/output.js');
        const prompt = buildWaitingPrompt();

        expect(prompt).toContain('TURN');
        expect(prompt).toContain('Processando');
        expect(prompt).toContain('gpt-5-mini');
        expect(prompt).toContain('high');
    });
});
