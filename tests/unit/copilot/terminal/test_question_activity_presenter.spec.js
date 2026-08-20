// @ts-check

import { describe, expect, it } from 'vitest';

import {
    classifyTerminalQuestionActivity,
    renderTerminalQuestionActivityLiveLabel,
    renderTerminalQuestionActivityPhaseLabel,
} from '../../../../src/copilot/terminal/events/question-activity-presenter.js';

describe('terminal/question-activity-presenter', () => {
    it.each([
        [
            'response',
            { label: 'Resposta registrada', detail: 'resposta registrada; aguardando resposta final da LLM-B' },
            'continuando',
            'continuação',
        ],
        [
            'response',
            { label: 'Pergunta respondida', detail: 'resposta do operador SIM encaminhada' },
            'continuando',
            'continuação',
        ],
        [
            'intervention',
            { label: 'Nova mensagem na caixa de entrada', detail: 'intervenção aguardando próxima ask_user' },
            'intervenção',
            'intervenção',
        ],
        ['decision', { label: 'Permissão SDK solicitada', detail: 'editar arquivo src/app.js' }, 'decisão', 'decisão'],
        ['decision', { label: 'Formulário SDK solicitado', detail: 'choices=sim/não' }, 'decisão', 'decisão'],
        [
            'integration',
            { label: 'OAuth SDK solicitado', detail: 'autorização externa pendente' },
            'integração',
            'integração',
        ],
        [
            'integration',
            { label: 'Sampling MCP solicitado', detail: 'aguardando modelo auxiliar' },
            'integração',
            'integração',
        ],
        ['prompt', { label: 'Pergunta ao operador', detail: 'ask_user aguardando resposta' }, 'pergunta', 'pergunta'],
        ['interaction', { label: 'Interação SDK', detail: 'estado não classificado' }, 'interação', 'interação'],
    ])('classifica %s com rótulos canônicos para linha viva e activity', (kind, entry, liveLabel, phaseLabel) => {
        expect(classifyTerminalQuestionActivity(entry)).toBe(kind);
        expect(renderTerminalQuestionActivityLiveLabel(entry)).toBe(liveLabel);
        expect(renderTerminalQuestionActivityPhaseLabel(entry)).toBe(phaseLabel);
    });
});
