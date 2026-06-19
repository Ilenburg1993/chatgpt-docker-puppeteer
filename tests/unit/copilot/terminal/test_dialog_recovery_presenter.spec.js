// @ts-check

import { describe, expect, it } from 'vitest';

import {
    AFTER_USER_INPUT_CONTINUATION_DIAGNOSTIC_COMMANDS,
    EMPTY_AFTER_USER_INPUT_DIAGNOSTIC_COMMANDS,
    EMPTY_AFTER_USER_INPUT_RESUME_COMMAND,
    EMPTY_AFTER_USER_INPUT_RESUME_MESSAGE,
    buildEmptyAfterUserInputAutoRecoveryRows,
    buildEmptyAfterUserInputRecoveryRows,
    buildEmptyAfterUserInputResumeMessage,
    summarizeAfterUserInputContinuation,
    summarizeEmptyAfterUserInputRecovery,
} from '../../../../src/copilot/terminal/events/dialog-recovery-presenter.js';

describe('terminal/events/dialog-recovery-presenter', () => {
    it('renderiza recuperação após resposta humana como estado acionável sem IDs crus no default', () => {
        const rows = buildEmptyAfterUserInputRecoveryRows({
            detail: 'continuação após resposta humana sem texto público · turno 2 · resposta SIM',
            answerPreview: 'SIM',
            turnId: '2',
            includeModelSwitch: true,
        });

        const text = rows.map((row) => `${row.label}: ${row.value}`).join('\n');

        expect(text).toContain('Estado: resposta humana registrada; a LLM-B encerrou sem texto público');
        expect(text).toContain('Resposta: SIM');
        expect(EMPTY_AFTER_USER_INPUT_RESUME_COMMAND).toBe(`/turn ${EMPTY_AFTER_USER_INPUT_RESUME_MESSAGE}`);
        expect(text).toContain(`Retomar: ${EMPTY_AFTER_USER_INPUT_RESUME_COMMAND}`);
        expect(text).toContain(`Diagnóstico: ${EMPTY_AFTER_USER_INPUT_DIAGNOSTIC_COMMANDS}`);
        expect(text).toContain('Alternativa: /byok model para trocar modelo');
        expect(text).not.toContain('requestId=');
        expect(text).not.toContain('chatcmpl-tool');
    });

    it('resume evento para /events com comando de retomada e IDs só quando solicitado', () => {
        const defaultText = summarizeEmptyAfterUserInputRecovery({
            detail: 'continuação após resposta humana sem texto público · resposta SIM',
            requestId: 'ask-request-1234567890',
        });
        const detailText = summarizeEmptyAfterUserInputRecovery({
            detail: 'continuação após resposta humana sem texto público · resposta SIM',
            requestId: 'ask-request-1234567890',
            showIds: true,
        });

        expect(defaultText).toContain('resposta SIM');
        expect(defaultText).toContain(`retomar ${EMPTY_AFTER_USER_INPUT_RESUME_COMMAND}`);
        expect(defaultText).toContain(`diagnóstico ${EMPTY_AFTER_USER_INPUT_DIAGNOSTIC_COMMANDS}`);
        expect(defaultText).not.toContain('ask-request');
        expect(detailText).toContain('req ask-request-1…');
    });

    it('resume continuação pós-resposta humana sem virar jargão técnico', () => {
        const text = summarizeAfterUserInputContinuation({
            answerPreview: 'SIM',
            wasFreeform: false,
        });

        expect(text).toContain('resposta registrada; aguardando resposta final da LLM-B');
        expect(text).toContain('opção/entrada aceita');
        expect(text).toContain('resposta SIM');
        expect(text).toContain(`acompanhar ${AFTER_USER_INPUT_CONTINUATION_DIAGNOSTIC_COMMANDS}`);
        expect(text).not.toContain('user_input.completed');
    });

    it('renderiza recuperação automática após resposta humana com linhas completas de ação', () => {
        const rows = buildEmptyAfterUserInputAutoRecoveryRows({
            detail: 'continuação após resposta humana sem texto público · resposta SIM',
            answerPreview: 'SIM',
            turnId: '3',
        });
        const text = rows.map((row) => `${row.label}: ${row.value}`).join('\n');

        expect(text).toContain('Estado: resposta humana registrada; a continuação voltou sem texto público');
        expect(text).toContain('Ação: continuação automática enviada uma vez');
        expect(text).toContain(`Retomar: ${EMPTY_AFTER_USER_INPUT_RESUME_COMMAND}`);
        expect(text).toContain('Resposta: SIM');
        expect(text).toContain('Turno: turno 3');
        expect(text).toContain(`Diagnóstico: ${EMPTY_AFTER_USER_INPUT_DIAGNOSTIC_COMMANDS}`);
        expect(text).toContain('Se repetir: /byok model para trocar modelo');
    });

    it('monta prompt de recuperação pós-ask com pergunta e resposta para preservar marcador final', () => {
        const message = buildEmptyAfterUserInputResumeMessage({
            question: 'ASK-MODEL-GATEWAY-ROUTE-APPLY: responda SIM depois do route_switch mínimo',
            answer: 'SIM',
        });

        expect(message).toContain('RECUPERACAO POS-ASK_USER DO TERMINAL');
        expect(message).toContain(EMPTY_AFTER_USER_INPUT_RESUME_MESSAGE);
        expect(message).toContain(
            'Pergunta humana respondida: "ASK-MODEL-GATEWAY-ROUTE-APPLY: responda SIM depois do route_switch mínimo".',
        );
        expect(message).toContain('Resposta humana registrada: "SIM".');
        expect(message).toContain('Nao repita ask_user');
        expect(message).toContain('marcador ou frase final pos-resposta');
    });

    it('mantém prompt legado quando não há contexto de pergunta humana', () => {
        expect(buildEmptyAfterUserInputResumeMessage()).toBe(EMPTY_AFTER_USER_INPUT_RESUME_MESSAGE);
    });
});
