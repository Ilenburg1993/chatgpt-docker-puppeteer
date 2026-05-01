// @ts-check

import { describe, expect, it } from 'vitest';

import { createTerminalMultilineInputState } from '../../../../src/copilot/terminal/repl-multiline.js';

describe('terminal/repl-multiline', () => {
    it('devolve linha simples imediatamente', () => {
        const state = createTerminalMultilineInputState();

        expect(state.acceptLine('ola')).toEqual({ complete: true, line: 'ola', wasBuffered: false });
        expect(state.hasPending()).toBe(false);
    });

    it('agrega linhas com continuação por barra invertida', () => {
        const state = createTerminalMultilineInputState();

        expect(state.acceptLine('linha 1\\')).toEqual({ complete: false, line: null, wasBuffered: true });
        expect(state.hasPending()).toBe(true);
        expect(state.acceptLine('linha 2')).toEqual({
            complete: true,
            line: 'linha 1\nlinha 2',
            wasBuffered: true,
        });
        expect(state.hasPending()).toBe(false);
    });

    it('reset limpa buffer pendente', () => {
        const state = createTerminalMultilineInputState();

        state.acceptLine('linha 1\\');
        state.reset();

        expect(state.hasPending()).toBe(false);
        expect(state.acceptLine('linha 2')).toEqual({ complete: true, line: 'linha 2', wasBuffered: false });
    });
});
