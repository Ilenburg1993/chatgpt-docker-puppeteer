// @ts-check

import { describe, expect, it } from 'vitest';

import { buildTerminalHumanQuestionCard } from '../../../../src/copilot/terminal/events/human-question-renderer.js';

const ANSI_RE = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

function plain(lines) {
    return lines.join('\n').replace(ANSI_RE, '');
}

describe('terminal/human-question-renderer', () => {
    it('renderiza pergunta humana como card estável, sem nomes crus de tool ou ids internos', () => {
        const output = plain(
            buildTerminalHumanQuestionCard({
                title: 'Pergunta humana estruturada',
                question: 'ASK-CANONICAL: responda SIM para fechar o teste',
                choices: ['SIM', 'NAO'],
                allowFreeform: false,
                source: 'sdk',
                state: 'aguardando resposta',
                now: Date.parse('2026-06-03T16:31:50.000-03:00'),
            }),
        );

        expect(output).toContain('Pergunta humana estruturada');
        expect(output).toContain('aguardando resposta');
        expect(output).toContain('SDK');
        expect(output).toContain('2026-06-03T16:31:50-03:00 (há 0s)');
        expect(output).toMatch(/\[PERGUNTA\]\s+ASK-CANONICAL: responda SIM para fechar o teste/u);
        expect(output).toContain('[1] SIM');
        expect(output).toContain('[2] NAO');
        expect(output).toContain('Escolha uma opção digitando o número ou o texto.');
        expect(output).toContain('/answer <texto>');
        expect(output).not.toContain('request_user_input');
        expect(output).not.toContain('ask_user SDK');
        expect(output).not.toMatch(/chatcmpl-tool-[a-z0-9-]+/iu);
    });

    it('compacta perguntas longas sem remover o marcador humano canônico', () => {
        const output = plain(
            buildTerminalHumanQuestionCard({
                question: 'Pergunta longa '.repeat(30),
                choices: ['seguir', 'pausar', 'cancelar', 'auditar', 'detalhar'],
                compact: true,
                source: 'tool',
                now: Date.parse('2026-06-03T16:31:50.000-03:00'),
            }),
        );

        expect(output).toContain('[PERGUNTA]');
        expect(output).toContain('[1] seguir');
        expect(output).toContain('... +1');
        expect(output).not.toContain('Atalhos');
    });
});
