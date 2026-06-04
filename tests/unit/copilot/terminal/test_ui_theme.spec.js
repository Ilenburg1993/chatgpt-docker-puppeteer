// @ts-check

import { describe, expect, it } from 'vitest';

import {
    setTerminalThemeName,
    terminalThemeRow,
    terminalThemeWrappedRow,
} from '../../../../src/copilot/terminal/state/ui-theme.js';

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

    it('quebra valores longos mantendo a coluna de label estável', () => {
        setTerminalThemeName('mono');

        const row = terminalThemeWrappedRow(
            'Uso',
            '/workspace sync <sdkPath> [--to <localPath>] [--overwrite] · /workspace mirror [--to <localDir>] [--overwrite]',
            { width: 8, columns: 68, role: 'command' },
        );

        expect(row).toBe(
            [
                '  Uso       /workspace sync <sdkPath> [--to <localPath>]',
                '            [--overwrite] · /workspace mirror [--to <localDir>]',
                '            [--overwrite]',
            ].join('\n'),
        );
        expect(row.split('\n').every((line) => line.length <= 68)).toBe(true);
    });
});
