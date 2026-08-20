// @ts-check

import { describe, expect, it } from 'vitest';

import {
    buildTerminalPickerPlan,
    TERMINAL_EXTERNAL_TOOL_DEFINITIONS,
} from '../../../../src/copilot/terminal/capabilities/index.js';

const FZF_DEFINITION = TERMINAL_EXTERNAL_TOOL_DEFINITIONS.find((definition) => definition.id === 'fzf');
if (!FZF_DEFINITION) throw new Error('A definição canônica da ferramenta fzf deve existir');

const FZF_TOOL = Object.freeze({
    ...FZF_DEFINITION,
    available: true,
    command: 'fzf',
    path: '/bin/fzf',
    version: 'fzf 0.66.0',
});

describe('terminal/capabilities/picker-plan', () => {
    it('bloqueia picker externo quando a sessão não liberou controle exclusivo do TTY', () => {
        const plan = buildTerminalPickerPlan({ tools: [FZF_TOOL] });

        expect(plan.mode).toBe('textual');
        expect(plan.toolId).toBeNull();
        expect(plan.reasons).toContain('sessão ainda não liberou controle exclusivo do TTY');
        expect(plan.fallbackCommand).toBe('/menu <n>');
    });

    it('autoriza picker externo somente com ferramenta disponível e controle interativo explícito', () => {
        const plan = buildTerminalPickerPlan({ allowInteractive: true, tools: [FZF_TOOL] });

        expect(plan.mode).toBe('external');
        expect(plan.toolId).toBe('fzf');
        expect(plan.command).toBe('fzf');
        expect(plan.reasons).toEqual([]);
    });

    it('bloqueia picker externo quando há pergunta humana pendente', () => {
        const plan = buildTerminalPickerPlan({ allowInteractive: true, pendingQuestion: true, tools: [FZF_TOOL] });

        expect(plan.mode).toBe('textual');
        expect(plan.reasons).toContain('pergunta humana pendente');
    });

    it('preserva razões de bloqueio vindas do contrato de TTY exclusivo', () => {
        const plan = buildTerminalPickerPlan({
            allowInteractive: false,
            blockReasons: ['turno em execução', 'input humano parcialmente digitado'],
            tools: [FZF_TOOL],
        });

        expect(plan.mode).toBe('textual');
        expect(plan.reasons).toContain('turno em execução');
        expect(plan.reasons).toContain('input humano parcialmente digitado');
    });
});
