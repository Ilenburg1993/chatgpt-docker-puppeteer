// @ts-check

import { describe, expect, it } from 'vitest';

import { __test__, cmdGh } from '../../../../src/copilot/terminal/commands/gh.js';

function mockCtx() {
    /** @type {string[]} */
    const lines = [];
    const println = (/** @type {string} */ line) => lines.push(line);
    return { println, output: () => lines.join('\n') };
}

describe('terminal/commands/gh', () => {
    it('normaliza ANSI legado e rótulo draft antes de renderizar no terminal', () => {
        const output = __test__.normalizeGhTerminalOutput(
            '\x1b[36m#42\x1b[0m \x1b[33m[DRAFT]\x1b[0m \x1b[1mAjustar UX\x1b[0m  \x1b[90m[open]\x1b[0m',
        );

        expect(output).toBe('#42 Rascunho Ajustar UX  [open]');
        expect(output).not.toContain('\x1b[');
        expect(output).not.toContain('[DRAFT]');
    });

    it('renderiza ajuda principal com tema humano, sem bloco ANSI legado', async () => {
        const ctx = mockCtx();

        await cmdGh({ println: ctx.println }, []);

        expect(ctx.output()).toContain('GitHub operacional');
        expect(ctx.output()).toContain('/gh issue list');
        expect(ctx.output()).toContain('/gh pr list');
        expect(ctx.output()).not.toContain('GitHub CLI');
        expect(ctx.output()).not.toContain('\x1b[36m/gh');
    });

    it('renderiza uso de subcomando sem "Uso:" solto', async () => {
        const ctx = mockCtx();

        await cmdGh({ println: ctx.println }, ['issue', 'create']);

        expect(ctx.output()).toContain('/gh issue create <título>');
        expect(ctx.output()).not.toContain('Uso:');
        expect(ctx.output()).not.toContain('\x1b[90m  Uso:');
    });
});
