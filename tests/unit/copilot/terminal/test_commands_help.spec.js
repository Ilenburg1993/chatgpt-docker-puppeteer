// @ts-check

import { describe, expect, it, vi } from 'vitest';

import { cmdHelp } from '../../../../src/copilot/terminal/commands/help.js';

function mockCtx() {
    const lines = /** @type {string[]} */ ([]);
    return {
        injectPort: 3009,
        println: vi.fn((line) => lines.push(line)),
        output: () => lines.join('\n'),
    };
}

describe('terminal/commands/help', () => {
    it('renderiza ajuda curta e humana por padrão', () => {
        const ctx = mockCtx();

        cmdHelp(ctx);

        expect(ctx.output()).toContain('Ajuda rápida');
        expect(ctx.output()).toContain('/help full');
        expect(ctx.output()).toContain('Esperas humanas');
        expect(ctx.output()).not.toContain('╔');
        expect(ctx.output()).not.toContain('binding/frescor');
        expect(ctx.output()).not.toContain('CommandDefinition');
    });

    it('preserva catálogo completo quando solicitado explicitamente', () => {
        const ctx = mockCtx();

        cmdHelp(ctx, 'full');

        expect(ctx.output()).toContain('Terminal LLM-B — Ajuda');
        expect(ctx.output()).toContain('/session sdk commands');
        expect(ctx.output()).toContain('POST /inject');
    });
});
