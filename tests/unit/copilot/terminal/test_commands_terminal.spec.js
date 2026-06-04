// @ts-check

import { describe, expect, it, vi } from 'vitest';

const capabilityMocks = vi.hoisted(() => ({
    readTerminalExternalToolCapabilitySummary: vi.fn(() => ({
        total: 3,
        available: 2,
        acceptedAvailable: 1,
        guardedAvailable: 1,
        deferredAvailable: 0,
        tools: [
            {
                id: 'fzf',
                label: 'fzf',
                command: 'fzf',
                path: '/usr/bin/fzf',
                available: true,
                version: 'fzf 0.66.0',
                decision: 'accepted',
                defaultEnabled: false,
                uses: ['picker'],
                recommendedFor: 'seleção explícita',
                fallback: 'listas numeradas',
                risk: 'TUI interativa',
                officialDocs: 'https://junegunn.github.io/fzf/',
                executionPolicy: 'seleção explícita',
                exampleCommands: ['/menu picker --interactive'],
            },
            {
                id: 'gum',
                label: 'Gum',
                command: 'gum',
                path: '/usr/bin/gum',
                available: true,
                version: 'gum 0.16.0',
                decision: 'accepted_guarded',
                defaultEnabled: false,
                uses: ['picker'],
                recommendedFor: 'menus explícitos',
                fallback: 'menus textuais',
                risk: 'pode tomar o TTY',
                officialDocs: 'https://github.com/charmbracelet/gum',
                executionPolicy: 'somente com TTY exclusivo',
                exampleCommands: ['/menu picker --interactive'],
            },
            {
                id: 'atuin',
                label: 'Atuin',
                command: null,
                path: null,
                available: false,
                version: null,
                decision: 'deferred',
                defaultEnabled: false,
                uses: ['history'],
                recommendedFor: 'histórico pessoal',
                fallback: 'ConversationHub',
                risk: 'histórico sensível',
                officialDocs: 'https://docs.atuin.sh/',
                executionPolicy: 'adiado; não ler histórico externo',
                exampleCommands: ['/terminal libs detail'],
            },
        ],
    })),
}));

vi.mock('../../../../src/copilot/terminal/capabilities/index.js', () => ({
    readTerminalExternalToolCapabilitySummary: capabilityMocks.readTerminalExternalToolCapabilitySummary,
}));

const { cmdTerminal, cmdTerminalLibs } = await import('../../../../src/copilot/terminal/commands/terminal.js');

function mockCtx() {
    /** @type {string[]} */
    const lines = [];
    const println = vi.fn((/** @type {string} */ text) => lines.push(text));
    return { println, output: () => lines.join('\n') };
}

describe('terminal/commands/terminal', () => {
    it('mostra libs auxiliares em superfície humana compacta', () => {
        const ctx = mockCtx();

        cmdTerminal(ctx, 'libs');

        expect(ctx.output()).toContain('Libs auxiliares do terminal');
        expect(ctx.output()).toContain('2/3 disponíveis');
        expect(ctx.output()).toContain('fzf');
        expect(ctx.output()).toContain('aceita como opcional');
        expect(ctx.output()).toContain('Gum');
        expect(ctx.output()).toContain('aceita com guardas');
        expect(ctx.output()).toContain('/terminal libs detail');
        expect(ctx.output()).toContain('terminal:aux-libs:smoke');
    });

    it('mostra detail com path, docs, risco e fallback', () => {
        const ctx = mockCtx();

        cmdTerminal(ctx, 'libs detail refresh');

        expect(capabilityMocks.readTerminalExternalToolCapabilitySummary).toHaveBeenCalledWith({ refresh: true });
        expect(ctx.output()).toContain('/usr/bin/fzf');
        expect(ctx.output()).toContain('https://junegunn.github.io/fzf/');
        expect(ctx.output()).toContain('TUI interativa');
        expect(ctx.output()).toContain('Política');
        expect(ctx.output()).toContain('seleção explícita');
        expect(ctx.output()).toContain('Exemplo 1');
        expect(ctx.output()).toContain('/menu picker --interactive');
        expect(ctx.output()).toContain('ConversationHub');
        expect(ctx.output()).toContain('adiado; não ler histórico externo');
        expect(ctx.output()).toContain('JSON limpo');
    });

    it('emite JSON estruturado para LLMs e scripts', () => {
        const ctx = mockCtx();

        cmdTerminal(ctx, 'libs json');

        const parsed = JSON.parse(ctx.output());
        expect(parsed.available).toBe(2);
        expect(parsed.tools[0].id).toBe('fzf');
    });

    it('atalho /libs encaminha para /terminal libs', () => {
        const ctx = mockCtx();

        cmdTerminalLibs(ctx, 'detail');

        expect(ctx.output()).toContain('Libs auxiliares do terminal');
        expect(ctx.output()).toContain('/usr/bin/fzf');
    });

    it('sem subcomando mostra uso canônico', () => {
        const ctx = mockCtx();

        cmdTerminal(ctx, '');

        expect(ctx.output()).toContain('/terminal libs [detail|json|refresh]');
        expect(ctx.output()).toContain('/libs [detail|json|refresh]');
    });
});
