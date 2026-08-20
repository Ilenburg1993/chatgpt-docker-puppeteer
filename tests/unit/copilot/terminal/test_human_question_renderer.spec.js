// @ts-check

import { describe, expect, it } from 'vitest';

import { buildTerminalHumanQuestionCard } from '../../../../src/copilot/terminal/events/human-question-renderer.js';

const ANSI_RE = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

/** @param {string[]} lines */
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
        expect(output).toContain('2026-06-03T16:31:50.000-03:00 (há 0s)');
        expect(output).toMatch(/\[PERGUNTA\]\s+ASK-CANONICAL: responda SIM para fechar o teste/u);
        expect(output).toContain('[1] SIM');
        expect(output).toContain('[2] NAO');
        expect(output).toContain('Digite o número, o texto da opção ou qualquer texto livre.');
        expect(output).toContain('/answer <texto>');
        expect(output).not.toContain('request_user_input');
        expect(output).not.toContain('ask_user SDK');
        expect(output).not.toMatch(/chatcmpl-tool-[a-z0-9-]+/iu);
        expect(output.split('\n').every((/** @type {string} */ line) => line.length <= 120)).toBe(true);
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
        expect(output).toContain('ferramenta');
        expect(output).toContain('[1] seguir');
        expect(output).toContain('... +1');
        expect(output).not.toContain('Atalhos');
    });

    it('humaniza sources de pergunta que nascem técnicos', () => {
        const output = plain(
            [
                ...buildTerminalHumanQuestionCard({ question: 'Continuar?', source: 'runtime', compact: true }),
                ...buildTerminalHumanQuestionCard({ question: 'Continuar?', source: 'headless', compact: true }),
            ],
        );

        expect(output).toContain('conversa');
        expect(output).toContain('sem interface');
        expect(output).not.toContain('runtime');
        expect(output).not.toContain('headless');
    });

    it('exibe contexto operacional opcional sem trocar a ação principal', () => {
        const output = plain(
            buildTerminalHumanQuestionCard({
                question: 'ASK-CANONICAL: responda SIM para fechar o teste',
                choices: ['SIM'],
                source: 'sdk',
                state: 'aguardando resposta',
                note: 'A LLM-B pediu esta resposta antes de escrever uma síntese pública deste turno.',
                now: Date.parse('2026-06-03T16:31:50.000-03:00'),
            }),
        );

        expect(output).toContain('Contexto');
        expect(output).toContain('antes de escrever uma síntese pública');
        expect(output).toContain('Digite o número, o texto da opção ou qualquer texto livre.');
    });
});
