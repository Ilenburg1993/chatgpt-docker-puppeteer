// @ts-check

import { describe, expect, it } from 'vitest';

import { buildTerminalPickerPlan } from '../../../../src/copilot/terminal/capabilities/index.js';

const FZF_TOOL = /** @type {const} */ ({
    id: 'fzf',
    label: 'fzf',
    available: true,
    command: 'fzf',
    path: '/bin/fzf',
    version: 'fzf 0.66.0',
    decision: 'accepted',
    defaultEnabled: false,
    recommendedFor: 'picker',
    fallback: 'textual',
    risk: 'tty',
    officialDocs: 'https://junegunn.github.io/fzf/',
});

describe('terminal/capabilities/picker-plan', () => {
    it('bloqueia picker externo quando runtime não entregou controle exclusivo do TTY', () => {
        const plan = buildTerminalPickerPlan({ tools: [FZF_TOOL] });

        expect(plan.mode).toBe('textual');
        expect(plan.toolId).toBeNull();
        expect(plan.reasons).toContain('runtime ainda não entregou controle exclusivo do TTY');
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
});
