// @ts-check

import { describe, expect, it, vi } from 'vitest';

import { runTerminalExternalPicker } from '../../../../src/copilot/terminal/capabilities/index.js';

const ITEMS = [
    { id: 'status', label: 'Status', description: 'visão operacional' },
    { id: 'help', label: 'Ajuda', description: 'comandos principais' },
];

describe('terminal/capabilities/picker-runner', () => {
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
