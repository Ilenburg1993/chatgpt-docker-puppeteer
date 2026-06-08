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
        expect(ctx.output()).toContain('Esperas');
        expect(ctx.output()).toContain('/sdk waits');
        expect(ctx.output()).toContain('/help libs');
        expect(ctx.output()).not.toContain('╔');
        expect(ctx.output()).not.toContain('binding/frescor');
        expect(ctx.output()).not.toContain('CommandDefinition');
        expect(ctx.output()).not.toContain('\x1b[36mAjuda rápida');
        expect(ctx.output()).not.toContain('\x1b[33m/status');
    });

    it('renderiza ajuda temática de libs sem abrir catálogo completo', () => {
        const ctx = mockCtx();

        cmdHelp(ctx, 'libs');

        expect(ctx.output()).toContain('Ajuda de libs auxiliares');
        expect(ctx.output()).toContain('/terminal libs detail [filtro]');
        expect(ctx.output()).toContain('/terminal libs json [filtro]');
        expect(ctx.output()).toContain('/libs deferred|available|missing|fzf');
        expect(ctx.output()).toContain('npm run terminal:aux-libs:smoke');
        expect(ctx.output()).toContain('atuin/zoxide');
        expect(ctx.output()).not.toContain('Sessão SDK persistente');
        expect(ctx.output()).not.toContain('HTTP local');
    });

    it('preserva catálogo completo quando solicitado explicitamente', () => {
        const ctx = mockCtx();

        cmdHelp(ctx, 'full');

        expect(ctx.output()).toContain('Terminal LLM-B - Ajuda completa');
        expect(ctx.output()).toContain('/session sdk commands');
        expect(ctx.output()).toContain('comandos registrados no SDK');
        expect(ctx.output()).toContain('ciclo de vida e comandos SDK pelo arquivo SSE canônico');
        expect(ctx.output()).toContain('histórico de perguntas, formulários e permissões no arquivo SSE');
        expect(ctx.output()).toContain('arquivo SSE, JSON compacto e mapa de fontes canônicas');
        expect(ctx.output()).toContain('pendências humanas vivas agora');
        expect(ctx.output()).toContain('POST /inject');
        expect(ctx.output()).toContain('Sessão e observação');
        expect(ctx.output()).toContain('Previews e libs auxiliares');
        expect(ctx.output()).toContain('/terminal libs detail [filtro]');
        expect(ctx.output()).toContain('/terminal libs deferred|fzf|bat|jq');
        expect(ctx.output()).toContain('/fs preview <path> --markdown');
        expect(ctx.output()).toContain('/fs preview <path> --json [--query .x]');
        expect(ctx.output()).toContain('/menu picker --interactive');
        expect(ctx.output()).toContain('atuin/zoxide');
        expect(ctx.output()).not.toContain('histórico/archive');
        expect(ctx.output()).not.toContain('archive SSE');
        expect(ctx.output()).not.toContain('lifecycle e comandos');
        expect(ctx.output()).not.toContain('CommandDefinition[]');
        expect(ctx.output()).not.toContain('╚');
        expect(ctx.output()).not.toContain('\x1b[33m/status');
    });
});
