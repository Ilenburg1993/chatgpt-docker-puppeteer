// @ts-check
import { describe, expect, it } from 'vitest';

import {
    buildTerminalPendingQuestionReplayKey,
    createTerminalPendingQuestionReplayState,
} from '../../../../src/copilot/terminal/state/pending-question-replay.js';

describe('terminal/state/pending-question-replay', () => {
    it('deduplica a mesma pergunta por uma janela durável da sessão', () => {
        const replay = createTerminalPendingQuestionReplayState();

        expect(replay.shouldRender({ question: 'Continuar?', choices: ['Sim'], now: 1_000 })).toEqual({
            render: true,
            reason: null,
            key: buildTerminalPendingQuestionReplayKey('Continuar?', ['Sim']),
        });

        expect(replay.shouldRender({ question: 'Continuar?', choices: ['Sim'], now: 1_000 + 120_000 })).toEqual({
            render: false,
            reason: 'duplicate',
            key: buildTerminalPendingQuestionReplayKey('Continuar?', ['Sim']),
        });

        expect(replay.shouldRender({ question: 'Executar agora?', choices: ['Sim'], now: 1_000 + 121_000 })).toEqual({
            render: true,
            reason: null,
            key: buildTerminalPendingQuestionReplayKey('Executar agora?', ['Sim']),
        });
    });

    it('mantém opção de TTL curto explícito para testes e diagnósticos', () => {
        const replay = createTerminalPendingQuestionReplayState({ ttlMs: 100 });

        expect(replay.shouldRender({ question: 'Continuar?', now: 1_000 }).render).toBe(true);
        expect(replay.shouldRender({ question: 'Continuar?', now: 1_050 }).render).toBe(false);
        expect(replay.shouldRender({ question: 'Continuar?', now: 1_101 }).render).toBe(true);
    });
});
