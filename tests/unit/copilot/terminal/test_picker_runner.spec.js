// @ts-check

import { afterEach, describe, expect, it, vi } from 'vitest';

import { runTerminalExternalPicker } from '../../../../src/copilot/terminal/capabilities/index.js';

const ITEMS = [
    { id: 'status', label: 'Status', description: 'visão operacional' },
    { id: 'help', label: 'Ajuda', description: 'comandos principais' },
];

describe('terminal/capabilities/picker-runner', () => {
    afterEach(() => {
        delete process.env['COPILOT_TERMINAL_PICKER_FILTER'];
    });

    it('mapeia seleção do fzf para item conhecido sem shell livre', () => {
        const execute = vi.fn(() => ({ status: 0, stdout: '01 Status · visão operacional\n' }));

        const result = runTerminalExternalPicker(ITEMS, {
            command: 'fzf',
            renderer: 'fzf',
            execute,
        });

        expect(result.status).toBe('selected');
        expect(result.item?.id).toBe('status');
        expect(execute).toHaveBeenCalledWith(
            'fzf',
            expect.arrayContaining(['--height=40%', '--prompt', 'menu> ']),
            expect.objectContaining({ input: expect.stringContaining('02 Ajuda') }),
        );
    });

    it('trata cancelamento de picker sem transformar em erro visual', () => {
        const result = runTerminalExternalPicker(ITEMS, {
            command: 'fzf',
            renderer: 'fzf',
            execute: () => ({ status: 130, stdout: '' }),
        });

        expect(result.status).toBe('cancelled');
        expect(result.item).toBeNull();
        expect(result.reason).toBe('seleção cancelada');
    });

    it('permite modo filtrado para harness automatizado sem abrir TUI completa', () => {
        process.env['COPILOT_TERMINAL_PICKER_FILTER'] = 'Status';
        const execute = vi.fn(() => ({ status: 0, stdout: '01 Status · visão operacional\n' }));

        const result = runTerminalExternalPicker(ITEMS, {
            command: 'fzf',
            renderer: 'fzf',
            execute,
        });

        expect(result.status).toBe('selected');
        expect(execute).toHaveBeenCalledWith(
            'fzf',
            expect.arrayContaining(['--filter', 'Status']),
            expect.objectContaining({ input: expect.stringContaining('01 Status') }),
        );
    });


    it('falha fechado quando stdout não corresponde a item conhecido', () => {
        const result = runTerminalExternalPicker(ITEMS, {
            command: 'gum',
            renderer: 'gum',
            execute: () => ({ status: 0, stdout: '03 Desconhecido\n' }),
        });

        expect(result.status).toBe('failed');
        expect(result.reason).toBe('seleção não corresponde a item conhecido');
    });
});
