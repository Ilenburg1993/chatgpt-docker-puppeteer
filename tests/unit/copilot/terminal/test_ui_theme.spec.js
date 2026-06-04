// @ts-check

import { describe, expect, it } from 'vitest';

import { setTerminalThemeName, terminalThemeRow } from '../../../../src/copilot/terminal/state/ui-theme.js';

describe('terminal/state/ui-theme', () => {
    it('mantém coluna estável quando truncamento de label é solicitado', () => {
        setTerminalThemeName('mono');

        const row = terminalThemeRow('Tarefa em segundo plano concluída', 'valor humano', {
            width: 12,
            truncateLabel: true,
        });

        expect(row).toBe('  Tarefa em s…  valor humano');
        expect(row).not.toContain('Tarefa em segundo plano concluída  valor humano');
    });

    it('preserva labels longos por padrão para superfícies não tabulares', () => {
        setTerminalThemeName('mono');

        const row = terminalThemeRow('Tarefa em segundo plano concluída', 'valor humano', { width: 12 });

        expect(row).toBe('  Tarefa em segundo plano concluída  valor humano');
    });
});
