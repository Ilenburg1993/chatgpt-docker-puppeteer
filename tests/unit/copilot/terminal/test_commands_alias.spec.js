// @ts-check

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resetAliases } from '../../../../src/copilot/terminal/stores/alias-store.js';

const { cmdAlias } = await import('../../../../src/copilot/terminal/commands/alias.js');

function mockCtx() {
    /** @type {string[]} */
    const lines = [];
    return {
        println: vi.fn((/** @type {string} */ line) => lines.push(line)),
        output: () => lines.join('\n'),
    };
}

describe('terminal/commands/alias', () => {
    beforeEach(() => {
        resetAliases();
    });

    it('lista aliases sem ANSI manual', () => {
        const ctx = mockCtx();

        cmdAlias({ println: ctx.println }, ['list']);

        expect(ctx.output()).toContain('Aliases');
        expect(ctx.output()).toContain('[builtin]');
        expect(ctx.output()).not.toContain('\x1b[');
    });

    it('define e remove alias com tema central', () => {
        const set = mockCtx();
        const remove = mockCtx();

        cmdAlias({ println: set.println }, ['set', 'mine', '/status']);
        cmdAlias({ println: remove.println }, ['remove', 'mine']);

        expect(set.output()).toContain('definido');
        expect(set.output()).toContain('mine -> /status');
        expect(remove.output()).toContain('removido');
        expect(`${set.output()}\n${remove.output()}`).not.toContain('\x1b[');
    });

    it('mostra uso sem linha ANSI solta', () => {
        const ctx = mockCtx();

        cmdAlias({ println: ctx.println }, ['set']);

        expect(ctx.output()).toContain('/alias set <nome> <comando>');
        expect(ctx.output()).not.toContain('  Uso:');
        expect(ctx.output()).not.toContain('\x1b[');
    });
});
